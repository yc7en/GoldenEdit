import { defineConfig } from 'vitest/config';

/**
 * 单测只覆盖「纯逻辑」：块切分、key 计算、能力分级。
 * 渲染管线的 DOM 行为留在真机验收（scripts/perf-check.mjs 与手工点验），
 * 不引入 jsdom——测不到真 WebView 的差异，反而给人「已经测过」的错觉。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['frontend/**/*.test.ts'],
    // 单线程跑：本机沙箱对临时目录写入敏感，并行 worker 会因 EPERM 掉文件
    fileParallelism: false,
  },
});
