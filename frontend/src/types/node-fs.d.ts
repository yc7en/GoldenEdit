/**
 * 前端运行时代码不依赖 Node，所以工程故意不装 @types/node（tsconfig 的 types
 * 只留 vite/client）。但单测要读 CSS 源文件做作用域断言，这里给 node:fs 补一条
 * 最小声明：只声明用到的签名，不给前端代码开放 Node API。
 */
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}
