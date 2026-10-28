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
    const lazy = Array.from(this.article.querySelectorAll<HTMLElement>('.ge-block--lazy'));
    for (const el of lazy) this.fill(el.dataset.key ?? '');
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

    const previous = new Map<string, Element>();
    for (const el of Array.from(this.article.children)) {
      if (el instanceof HTMLElement) previous.set(el.dataset.key ?? '', el);
    }

    const limit =
      mode === 'full' ? blocks.length : mode === 'shard' ? Math.min(FIRST_SCREEN_BLOCKS, blocks.length) : 0;

    const holder = document.createElement('div');
    holder.innerHTML = blocks
      .map((b, i) => (i < limit ? this.blockHtml(b) : this.placeholderHtml(b, mode)))
      .join('');

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
    const lines = Math.max(1, block.source.split('\n').length);
    const height = Math.min(600, 12 + lines * 22);
    return (
      `<section class="ge-block ge-block--lazy" data-key="${block.key}" data-line="${block.line}" data-lazy="1"` +
      (mode === 'viewport' ? '' : ' data-queued="1"') +
      ` style="min-height:${height}px"><button class="ge-line" data-line="${block.line}">${block.line}</button></section>`
    );
  }

  private enqueue(key: string): void {
    this.idleQueue.push(key);
    if (this.idleScheduled) return;
    this.idleScheduled = true;
    const run = () => {
      this.idleScheduled = false;
      const batch = this.idleQueue.splice(0, 40);
      for (const k of batch) this.fill(k);
      if (this.idleQueue.length) this.enqueue(this.idleQueue.shift()!);
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

  private fill(key: string): void {
    const block = this.blocks.get(key);
    if (!block) return;
    const el = this.article.querySelector<HTMLElement>(`[data-key="${key}"]`);
    if (!el || el.dataset.lazy !== '1') return;
    const badge = el.querySelector('.ge-line');
    el.classList.remove('ge-block--lazy');
    el.removeAttribute('data-lazy');
    el.style.minHeight = '';
    el.innerHTML = block.html;
    if (badge) el.appendChild(badge);
    void this.mountBlock(el);
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
