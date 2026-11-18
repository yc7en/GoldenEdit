/**
 * 第三方渲染库的加载器（ARCHITECTURE §5.12 / §5.13）。
 *
 * 单独成模块的理由不只是整洁：`context.ts` 被 Worker 与主线程共用，如果库的
 * `import()` 写在 context.ts 里，Worker 打包时会把整包内联进去（实测 abcjs
 * 500KB 被塞进 worker bundle），每个文档渲染都要多解析一遍。放在这里、由主线程
 * 路径动态 `import()` 本模块，Worker 的依赖图里就看不到这些库。
 */

export type LibName = 'pele' | 'katex' | 'abcjs' | 'markmap';

const libCache = new Map<string, Promise<unknown>>();

export function loadLib(name: LibName): Promise<unknown> {
  let hit = libCache.get(name);
  if (!hit) {
    hit =
      name === 'pele'
        ? // 走 lazy 入口：按图类型分块，文档里有哪种图才下载哪几块。
          // 换成 `import('pele')` 会把全部图类型一次性打进来（gzip 268KB）。
          import('pele/lazy')
        : name === 'katex'
          ? import('katex').then((m) => m.default)
          : name === 'markmap'
            ? // markmap 1.x 按职责拆包：parse 把 Markdown 转成树，render 排版并输出
              // 图元。两者是同一套内部类型，版本必须一起升，所以一次取齐再交给插件。
              // 不取 @markmap/view：它带缩放与折叠交互，会和预览滚动抢手势。
              Promise.all([import('@markmap/parse'), import('@markmap/render')]).then(
                ([parse, render]) => ({ parse, render })
              )
            : // abcjs 是 CJS 包，某些打包形态下默认导出会多包一层，两种都兜住
              import('abcjs').then((m) => (m as { default?: unknown }).default ?? m);
    libCache.set(name, hit);
  }
  return hit;
}
