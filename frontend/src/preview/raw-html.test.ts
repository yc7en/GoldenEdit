/**
 * 原始 HTML 直通（html: true）的两个纯函数：
 * 净化（`sanitizeBlockHtml`）与图片地址改写（`rewriteHtmlAssets`）。
 *
 * 为什么单独立一处：`html: true` 是「文档里写什么标签就渲染什么」的开关，
 * 安全边界全压在这两个函数上——预览侧还有 CSP 兜底，**导出产物没有**，
 * 所以这里每个断言都对应一条真实会被利用的写法。
 */
import { describe, expect, it } from 'vitest';
import {
  sanitizeBlockHtml,
  stripDangerousUrls,
  stripEventHandlers,
  stripScripts,
} from '../../preview-shell/blocks';
import { assetBaseOf, assetUrl, rewriteHtmlAssets } from '../../preview-shell/assets';

const BASE = '/p/tok123/';
const DIR = 'notes/sub';

describe('内联 HTML 净化', () => {
  it('剥成对与未成对的 <script>，内容一起带走', () => {
    expect(stripScripts('<p>a</p><script>alert(1)</script><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(stripScripts('<script src="//evil/x.js"></script>')).toBe('');
    // 没有闭合标签时浏览器照样执行，开始标签必须剥
    expect(stripScripts('ok<script src="//evil/x.js">')).toBe('ok');
    expect(stripScripts('<SCRIPT TYPE="text/javascript">x()</SCRIPT>')).toBe('');
  });

  it('剥内联事件属性，标签本身保留', () => {
    expect(stripEventHandlers('<img src="a.png" onerror="alert(1)">')).toBe('<img src="a.png">');
    expect(stripEventHandlers("<div onclick='steal()' class=\"x\">t</div>")).toBe(
      '<div class="x">t</div>'
    );
    // 未加引号的属性值
    expect(stripEventHandlers('<body onload=init()>')).toBe('<body>');
    // 多个事件属性
    expect(stripEventHandlers('<a onmouseover="a()" onfocus="b()">x</a>')).toBe('<a>x</a>');
  });

  it('不误伤名字里带 on 的正文与普通属性', () => {
    const html = '<p>online 与 ongoing 都是正文</p><div data-on-x="1" class="only">t</div>';
    expect(stripEventHandlers(html)).toBe(html);
  });

  it('剥 javascript: / vbscript: / data:text/html 地址，data:image 保留', () => {
    expect(stripDangerousUrls('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(stripDangerousUrls('<a href=" JavaScript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(
      stripDangerousUrls('<iframe src="data:text/html;base64,PHNjcmlwdD4="></iframe>')
    ).toBe('<iframe></iframe>');
    const img = '<img src="data:image/png;base64,iVBORw0KGgo=">';
    expect(stripDangerousUrls(img)).toBe(img);
  });

  it('保留 <style>、内联 SVG 与 SVG 自身的 url() 引用', () => {
    const html =
      '<style>.a{fill:url(#g)}</style><svg viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/></svg>';
    expect(sanitizeBlockHtml(html)).toBe(html);
  });

  it('用户写的排版表格原样通过（这就是 html: true 的目的）', () => {
    const html =
      '<table><tr><td width="50%" valign="top"><img src="docs/a.png" width="100%" alt="A"></td></tr></table>';
    expect(sanitizeBlockHtml(html)).toBe(html);
  });

  it('三类净化串起来跑一遍，混合输入只剩安全标签', () => {
    const html =
      '<table onmouseover="x()"><tr><td><a href="javascript:x()">l</a></td></tr></table><script>y()</script>';
    expect(sanitizeBlockHtml(html)).toBe('<table><tr><td><a>l</a></td></tr></table>');
  });
});

describe('原始 HTML 里的图片地址', () => {
  it('相对路径改写成 /asset 路由，按当前文档目录解析', () => {
    expect(rewriteHtmlAssets('<img src="a.png">', BASE, DIR)).toBe(
      `<img src="${BASE}asset?p=${encodeURIComponent('notes/sub/a.png')}">`
    );
  });

  it('以 / 开头按工作区根解析', () => {
    expect(rewriteHtmlAssets('<img src="/img/a.png">', BASE, DIR)).toContain(
      encodeURIComponent('img/a.png')
    );
  });

  it('http / data / 盘符绝对路径与 srcset 一律不动', () => {
    for (const src of ['https://x/a.png', 'data:image/png;base64,AAA', 'D:/pic/a.png', '//cdn/a.png']) {
      const html = `<img src="${src}">`;
      expect(rewriteHtmlAssets(html, BASE, DIR)).toBe(html);
    }
    const srcset = '<img srcset="a.png 1x, b.png 2x">';
    expect(rewriteHtmlAssets(srcset, BASE, DIR)).toBe(srcset);
  });

  it('单引号与不带引号的 src 都认', () => {
    expect(rewriteHtmlAssets("<img src='a.png'>", BASE, DIR)).toContain(`${BASE}asset?p=notes%2Fsub%2Fa.png`);
    expect(rewriteHtmlAssets('<img src=a.png>', BASE, DIR)).toContain(`${BASE}asset?p=notes%2Fsub%2Fa.png`);
  });

  it('一个块里多张图逐个改写，其余属性原样', () => {
    const out = rewriteHtmlAssets(
      '<img width="100%" src="a.png" alt="甲"><img src="b.png">',
      BASE,
      DIR
    );
    expect(out).toContain(`width="100%" src="${BASE}asset?p=notes%2Fsub%2Fa.png" alt="甲"`);
    expect(out).toContain(`<img src="${BASE}asset?p=notes%2Fsub%2Fb.png">`);
  });

  it('越出工作区的 ../ 不冒充资源地址，原样留给 404', () => {
    expect(rewriteHtmlAssets('<img src="../../../etc/a.png">', BASE, DIR)).toBe(
      '<img src="../../../etc/a.png">'
    );
  });

  it('没有 assetBase（非 /p/{token}/shell/ 形态）时完全不接管', () => {
    const html = '<img src="a.png">';
    expect(rewriteHtmlAssets(html, '', DIR)).toBe(html);
  });

  it('assetBaseOf 只认 shell 地址', () => {
    expect(assetBaseOf('http://127.0.0.1:9/p/abc/shell/')).toBe('http://127.0.0.1:9/p/abc/');
    expect(assetBaseOf('http://127.0.0.1:9/p/abc/other/')).toBe('');
    // 文档目录为根时，相对路径直接落在工作区根
    expect(assetUrl(BASE, '', 'a.png')).toBe(`${BASE}asset?p=a.png`);
  });
});
