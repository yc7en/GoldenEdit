/**
 * 渲染性能探针（ARCHITECTURE §13.1）。
 *
 * 只做一件事：把一段文本推进真实的预览管线，量「提交 → 首屏渲染完成」的墙钟时间。
 * 三条约束：
 * - 走 preview.pushAndWait，不另开渲染路径，否则测到的不是用户看到的东西；
 * - 结果来自 L3 的 rendered 消息，和状态条同源；
 * - 测完把原文档推回去，不留下「预览里是样本、编辑器里是别的文件」的状态。
 */
import type { PreviewHost } from './preview/host';
import { store } from './store';

export interface BenchRow {
  name: string;
  /** 提交的字符数 */
  chars: number;
  /** 外壳收到的字符数（宿主 → iframe） */
  submitted: number;
  /** Worker 实际解析的字符数（iframe → worker） */
  rendered: number;
  kb: number;
  blocks: number;
  /** markdown-it 解析 + 插件渲染（Worker 侧上报） */
  kernelMs: number;
  /** 解析阶段 */
  parseMs: number;
  /** 切块 + key 计算阶段 */
  loopMs: number;
  /** 各条自定义规则耗时（诊断用） */
  rules: Record<string, number>;
  /** iframe 收到文档 → Worker 回结果（含两次跨线程传输与解析） */
  xferMs: number;
  /** 主线程建 DOM（pipeline.render） */
  domMs: number;
  /** 从 push 到首屏可交互的墙钟时间（含 150ms 防抖） */
  wallMs: number;
  /** 主线程分段：防抖 / 投递 postMessage / 收到 rendered 之后的回调 */
  debounceMs: number;
  postMs: number;
  cbMs: number;
}

export async function bench(preview: PreviewHost, text: string, name = 'sample'): Promise<BenchRow> {
  const started = performance.now();
  const info = await preview.pushAndWait(text);
  const wallMs = performance.now() - started;
  const t = preview.timing;
  return {
    name,
    chars: text.length,
    submitted: info.submitted,
    rendered: info.chars,
    kb: Math.round(text.length / 1024),
    blocks: info.blocks,
    kernelMs: info.ms,
    parseMs: info.parseMs,
    loopMs: info.loopMs,
    rules: info.rules,
    xferMs: info.xferMs,
    domMs: info.domMs,
    wallMs: Math.round(wallMs),
    debounceMs: Math.round(t.firedAt - t.pushAt),
    postMs: Math.round(t.sentAt - t.firedAt),
    cbMs: Math.round(started + wallMs - t.renderedAt),
  };
}

/**
 * 把预览打回空白文档并等这一次渲染落地。
 * 每档样本前都调一次：分片/视口模式在后台还有一批懒填充，不冲掉就会把下一档的
 * 首屏时间算进去（实测 2MB → 8MB 多算了 2.1 秒）。
 */
export async function settle(preview: PreviewHost): Promise<void> {
  await preview.pushAndWait('# settle\n', 20_000).catch(() => undefined);
}

/** 自检当前文档，用于「诊断」菜单：不需要额外样本文件 */export async function benchCurrent(preview: PreviewHost): Promise<BenchRow | null> {
  const tab = store.activeTab;
  if (!tab) return null;
  const row = await bench(preview, tab.text, tab.name);
  preview.push(tab.text);
  return row;
}
