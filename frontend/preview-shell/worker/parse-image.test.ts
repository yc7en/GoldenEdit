/**
 * Worker 侧的图片地址改写：`![](image/a.jpg)` 必须落到预览服务的 /asset 路由上，
 * 否则浏览器按 iframe 的 /shell/ 地址去取，一律 404。
 *
 * 这里直接把 Worker 模块载进 Node 跑：只替身 `self`，其余全是真实解析路径。
 */
import { beforeAll, describe, expect, it } from 'vitest';

const BASE = 'http://127.0.0.1:5123/p/tok123/';

interface Wire {
  type: string;
  blocks?: { html: string }[];
  [key: string]: unknown;
}

const out: Wire[] = [];
let handler: ((ev: { data: unknown }) => void) | null = null;

function send(data: unknown): void {
  handler?.({ data });
}

async function waitFor(type: string): Promise<Wire> {
  for (let i = 0; i < 200; i++) {
    const hit = out.find((m) => m.type === type);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`等不到 ${type} 消息`);
}

/** 走一遍 init + doc，返回渲染出的块 HTML */
async function render(text: string, dir: string): Promise<string> {
  out.length = 0;
  send({
    type: 'init',
    specs: [],
    doc: { path: `${dir ? `${dir}/` : ''}demo.md`, name: 'demo.md', dir, frontmatter: {} },
    theme: { mode: 'light', tokens: {} },
    baseUrl: `${BASE}shell/`,
  });
  await waitFor('ready');

  out.length = 0;
  send({ type: 'doc', gen: 1, text, mode: 'full', dir });
  const result = await waitFor('result');
  return (result.blocks ?? []).map((b) => b.html).join('');
}

beforeAll(async () => {
  Object.assign(globalThis, {
    self: {
      postMessage: (msg: Wire) => out.push(msg),
      get onmessage() {
        return handler;
      },
      set onmessage(fn: ((ev: { data: unknown }) => void) | null) {
        handler = fn;
      },
    },
  });
  await import('./parse');
});

describe('图片地址改写', () => {
  it('相对路径按当前文档目录解析到 /asset', async () => {
    const html = await render('![图1](image/be2a70d591749d52.jpg)', 'docs/trade');
    expect(html).toContain(`src="${BASE}asset?p=${encodeURIComponent('docs/trade/image/be2a70d591749d52.jpg')}"`);
  });

  it('工作区根目录下的文档不带多余层级', async () => {
    const html = await render('![图1](image/a.jpg)', '');
    expect(html).toContain(`src="${BASE}asset?p=image%2Fa.jpg"`);
  });

  it('alt 文本仍然保留', async () => {
    const html = await render('![1.1  交易与支付 - 图1](image/a.jpg)', '');
    expect(html).toContain('alt="1.1  交易与支付 - 图1"');
  });

  it('绝对地址与数据 URI 不改写', async () => {
    const html = await render('![x](https://example.com/a.png)', 'docs');
    expect(html).toContain('src="https://example.com/a.png"');
  });

  it('切文档后按新目录解析同一份源码', async () => {
    await render('![图](image/a.jpg)', 'docs/a');
    const html = await render('![图](image/a.jpg)', 'docs/b');
    expect(html).toContain(encodeURIComponent('docs/b/image/a.jpg'));
    expect(html).not.toContain(encodeURIComponent('docs/a/image/a.jpg'));
  });
});
