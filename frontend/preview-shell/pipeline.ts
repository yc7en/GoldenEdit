/**
 * 渲染管线（L3 主线程）：块级 morphdom + 分片 + mount 调度。
 * 三个体验指标由它负责：不闪、不跳滚动、不丢折叠状态。
 */
import morphdom from 'morphdom';

import type { Block } from './blocks';
import type { RuntimeRegistry } from './context';
import { withTimeout } from './context';

export type RenderMode = 'full' | 'shard' | 'viewport';

export interface PipelineHooks {
  onJump(line: number): void;
  onOpenExternal(url: string): void;
  onLog(level: 'info' | 'warn' | 'error', message: string): void;
}

const MOUNT_TIMEOUT = 3000;
const FIRST_SCREEN_BLOCKS = 200;
/**
 * 视口模式下主线程最多先建这么多占位节点。
 * 8MB 文档有 5 万多块，一次性建出来光 DOM 就要 4 秒——比解析还贵。
 * 其余部分用一个「尾部间隔器」占高度，滚到哪儿再按批物化（§6.4）。
 */
const VIEWPORT_DOM_BLOCKS = 600;
/** 一次物化的块数：太多会卡一帧，太少会频繁触发 */
const TAIL_BATCH = 400;

export class Pipeline {
  private article: HTMLElement;
  private blocks = new Map<string, Block>();
  private hooks: PipelineHooks;
  private registry: RuntimeRegistry | null = null;
  private observer: IntersectionObserver | null = null;
  private idleQueue: string[] = [];
  private idleScheduled = false;
  /** 已完成的 mount，避免重复执行（§6.3：key 相同则节点保留） */
  private mounted = new WeakSet<Element>();
  private loadBlocks: ((keys: string[]) => Promise<{ key: string; html: string; plugins: string[] }[]>) | null =
    null;
  private filling = new Set<string>();
  /** 按顺序保留块，尾部物化要用 */
  private ordered: Block[] = [];
  private tailObserver: IntersectionObserver | null = null;
  stats = { blocks: 0, lazy: 0 };

  constructor(root: HTMLElement, hooks: PipelineHooks) {
    this.hooks = hooks;
    this.article = document.createElement('article');
    this.article.className = 'ge-doc';
    this.article.id = 'ge-doc';
    root.appendChild(this.article);
    this.bindEvents(root);
  }

  attachRegistry(registry: RuntimeRegistry): void {
    this.registry = registry;
  }

  setTheme(tokens: Record<string, string>): void {
    const style = document.documentElement.style;
    for (const [k, v] of Object.entries(tokens)) style.setProperty(k, v);
  }

  setWidth(width: number): void {
    this.article.style.maxWidth = width > 0 ? `${width}px` : '';
  }

  /** 打印 / 导出前把懒加载块补齐，避免打印出空白页 */
  expandAll(): void {
    void (async () => {
      // 先把尾部间隔器逐批物化，再多轮补渲染，直到没有遗留占位（打印不能有空白页）
      let tail = this.article.querySelector<HTMLElement>('[data-tail]');
      while (tail) {
        await this.materializeTail();
        tail = this.article.querySelector<HTMLElement>('[data-tail]');
      }
      for (let round = 0; round < 50; round++) {
        const lazy = Array.from(this.article.querySelectorAll<HTMLElement>('.ge-block--lazy'));
        if (lazy.length === 0) return;
        await Promise.all(lazy.map((el) => this.fill(el.dataset.key ?? '')));
      }
    })();
  }

  /**
   * 视口模式下尾块的 HTML 由 Worker 按需补渲染（§6.4 第 2 层）。
   * 不给 loader 就退化为「占位永远空着」，但不会抛错。
   */
  setBlockLoader(loader: (keys: string[]) => Promise<{ key: string; html: string; plugins: string[] }[]>): void {
    this.loadBlocks = loader;
  }

  private bindEvents(root: HTMLElement): void {
    root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const badge = target.closest('.ge-line') as HTMLElement | null;
      if (badge) {
        e.preventDefault();
        this.hooks.onJump(Number(badge.dataset.line ?? '1'));
        return;
      }
      const link = target.closest('a[data-ge-external]') as HTMLAnchorElement | null;
      if (link) {
        e.preventDefault();
        this.hooks.onOpenExternal(link.getAttribute('data-ge-external') ?? '');
      }
    });

    // 视口渲染模式：滚动时补齐可见区域
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          this.observer?.unobserve(el);
          this.fill(el.getAttribute('data-key') ?? '');
        }
      },
      { rootMargin: '200% 0px 200% 0px' }
    );
  }

  async render(blocks: Block[], mode: RenderMode): Promise<{ mounted: number; lazy: number }> {
    this.blocks = new Map(blocks.map((b) => [b.key, b]));
    this.stats = { blocks: blocks.length, lazy: 0 };
    // 新一批内容作废上一批的懒填充队列：否则切到大文档时，旧文档的上万个填充任务
    // 还在空闲队列里排队，会把这次渲染的首屏拖后几秒（实测 2MB → 8MB 拖了 2.1s）
    this.idleQueue.length = 0;
    this.tailObserver?.disconnect();
    this.tailObserver = null;

    const previous = new Map<string, Element>();
    for (const el of Array.from(this.article.children)) {
      if (el instanceof HTMLElement) previous.set(el.dataset.key ?? '', el);
    }

    this.ordered = blocks;
    const limit =
      mode === 'full' ? blocks.length : mode === 'shard' ? Math.min(FIRST_SCREEN_BLOCKS, blocks.length) : 0;
    const headCount = mode === 'viewport' ? Math.min(VIEWPORT_DOM_BLOCKS, blocks.length) : blocks.length;

    const holder = document.createElement('div');
    const parts: string[] = [];
    for (let i = 0; i < headCount; i++) {
      parts.push(i < limit ? this.blockHtml(blocks[i]) : this.placeholderHtml(blocks[i], mode));
    }
    if (mode === 'viewport' && blocks.length > headCount) {
      parts.push(this.tailHtml(headCount));
    }
    holder.innerHTML = parts.join('');

    const changed: Element[] = [];
    morphdom(this.article, holder, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        const sameKey =
          fromEl.getAttribute('data-key') !== null &&
          fromEl.getAttribute('data-key') === toEl.getAttribute('data-key');
        if (sameKey) return false;
        changed.push(toEl);
        return true;
      },
    });

    // morphdom 可能复用节点但内容已变，统一按「key 不同或从未 mount」判定
    const targets: HTMLElement[] = [];
    for (const el of Array.from(this.article.children)) {
      if (!(el instanceof HTMLElement)) continue;
      const key = el.dataset.key ?? '';
      const isLazy = el.dataset.lazy === '1';
      if (isLazy) {
        this.stats.lazy++;
        if (mode === 'shard') this.enqueue(key);
        else this.observer?.observe(el);
        continue;
      }
      if (!this.mounted.has(el) || previous.get(key) !== el) targets.push(el);
    }

    const tail = this.article.querySelector<HTMLElement>('[data-tail]');
    if (tail) this.observeTail(tail);

    let mounted = 0;
    for (const el of targets) {
      const did = await this.mountBlock(el);
      if (did) mounted++;
    }
    return { mounted, lazy: this.stats.lazy };
  }

  private blockHtml(block: Block): string {
    return (
      `<section class="ge-block" data-key="${block.key}" data-line="${block.line}"` +
      (block.plugins.length ? ` data-plugins="${escapeAttr(block.plugins.join(','))}"` : '') +
      `>${block.html}<button class="ge-line" data-line="${block.line}" title="跳到源码第 ${block.line} 行">${block.line}</button></section>`
    );
  }

  private placeholderHtml(block: Block, mode: RenderMode): string {
    const lines = Math.max(1, block.lines);
    const height = Math.min(600, 12 + lines * 22);
    return (
      `<section class="ge-block ge-block--lazy" data-key="${block.key}" data-line="${block.line}" data-lazy="1"` +
      (mode === 'viewport' ? '' : ' data-queued="1"') +
      ` style="min-height:${height}px"><button class="ge-line" data-line="${block.line}">${block.line}</button></section>`
    );
  }

  /** 尾部间隔器：按剩余块的估算高度占位，避免出现「滚动条突然变短」 */
  private tailHtml(from: number): string {
    return `<section class="ge-block ge-block--tail" data-tail="1" data-tail-from="${from}" style="min-height:${this.tailHeightFrom(from)}px"></section>`;
  }

  private observeTail(tail: HTMLElement): void {
    this.tailObserver?.disconnect();
    this.tailObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) void this.materializeTail();
        }
      },
      { rootMargin: '300% 0px 300% 0px' }
    );
    this.tailObserver.observe(tail);
  }

  /** 把尾部下一批块变成真正的占位节点，剩余部分继续用间隔器顶着 */
  private async materializeTail(): Promise<void> {
    const tail = this.article.querySelector<HTMLElement>('[data-tail]');
    if (!tail) return;
    const from = Number(tail.dataset.tailFrom ?? '0');
    if (from >= this.ordered.length) {
      // 兜底：块数变少时尾部已无事可做，必须摘掉间隔器，否则 expandAll 会空转
      tail.remove();
      this.tailObserver?.disconnect();
      return;
    }
    const to = Math.min(from + TAIL_BATCH, this.ordered.length);

    const frag = document.createElement('div');
    frag.innerHTML = this.ordered
      .slice(from, to)
      .map((b) => this.placeholderHtml(b, 'viewport'))
      .join('');
    const nodes = Array.from(frag.children);
    for (const node of nodes) tail.before(node);

    if (to >= this.ordered.length) {
      tail.remove();
      this.tailObserver?.disconnect();
    } else {
      tail.dataset.tailFrom = String(to);
      tail.style.minHeight = `${this.tailHeightFrom(to)}px`;
    }
    this.stats.lazy += nodes.length;
    for (const node of nodes) this.observer?.observe(node);
  }

  private tailHeightFrom(from: number): number {
    let height = 0;
    for (let i = from; i < this.ordered.length; i++) {
      height += Math.min(600, 12 + Math.max(1, this.ordered[i].lines) * 22);
    }
    return height;
  }

  private enqueue(key: string): void {
    this.idleQueue.push(key);
    this.scheduleIdle();
  }

  /** 分片模式的空闲填充：一批 40 块，填完再排下一批，避免长时间占住主线程 */
  private scheduleIdle(): void {
    if (this.idleScheduled) return;
    this.idleScheduled = true;
    const run = () => {
      this.idleScheduled = false;
      const batch = this.idleQueue.splice(0, 40);
      for (const k of batch) void this.fill(k);
      if (this.idleQueue.length) this.scheduleIdle();
    };
    if ('requestIdleCallback' in window) {
      (window as unknown as { requestIdleCallback: (cb: () => void, o?: unknown) => void }).requestIdleCallback(
        run,
        { timeout: 200 }
      );
    } else {
      setTimeout(run, 16);
    }
  }

  private async fill(key: string): Promise<void> {
    const block = this.blocks.get(key);
    if (!block) return;
    const el = this.article.querySelector<HTMLElement>(`[data-key="${key}"]`);
    if (!el || el.dataset.lazy !== '1') return;
    if (this.filling.has(key)) return;
    this.filling.add(key);
    try {
      let html = block.html;
      if (!html) {
        const loaded = (await this.loadBlocks?.([key])) ?? [];
        html = loaded.find((b) => b.key === key)?.html ?? '';
        if (!html) {
          // 加载失败也要撤掉占位，否则会一直显示「空块」
          el.textContent = '';
          el.dataset.empty = '1';
          return;
        }
        block.html = html;
      }
      const badge = el.querySelector('.ge-line');
      el.classList.remove('ge-block--lazy');
      el.removeAttribute('data-lazy');
      el.style.minHeight = '';
      el.innerHTML = html;
      if (badge) el.appendChild(badge);
      await this.mountBlock(el);
    } finally {
      this.filling.delete(key);
    }
  }

  private async mountBlock(el: HTMLElement): Promise<boolean> {
    const registry = this.registry;
    if (!registry) return false;
    let ran = false;
    for (const rt of registry.runtimes.values()) {
      if (!rt.loaded) continue;
      for (const entry of rt.mounts) {
        const nodes = Array.from(el.querySelectorAll<HTMLElement>(entry.selector));
        for (const node of nodes) {
          ran = true;
          try {
            const payload = { line: Number(el.dataset.line ?? '1'), key: el.dataset.key };
            await withTimeout(
              Promise.resolve(entry.fn(node, payload, rt.ctx)) as Promise<unknown>,
              MOUNT_TIMEOUT,
              `渲染超时（${rt.spec.name}）`
            );
          } catch (err) {
            this.showMountError(node, rt.spec.id, err);
          }
        }
      }
    }
    this.mounted.add(el);
    return ran;
  }

  private showMountError(node: HTMLElement, pluginId: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.hooks.onLog('error', `[${pluginId}] ${message}`);
    const card = document.createElement('div');
    card.className = 'ge-error ge-error--mount';
    card.innerHTML =
      `<div class="ge-error__t">${escapeHtml(pluginId)} 渲染失败：${escapeHtml(message)}</div>` +
      `<pre class="ge-error__c">${escapeHtml(node.textContent ?? '')}</pre>` +
      `<button class="ge-error__retry">重试</button>`;
    card.querySelector('.ge-error__retry')?.addEventListener('click', () => {
      card.remove();
      const parent = node.parentElement;
      if (parent) void this.mountBlock(parent.closest('.ge-block') as HTMLElement ?? parent);
    });
    node.replaceWith(card);
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/`/g, '&#96;');
}
