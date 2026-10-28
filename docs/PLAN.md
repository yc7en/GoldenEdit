# GoldenEdit 开发计划与工作包

> 本文件是**执行计划**，不是契约。范围与行为一律以 `ARCHITECTURE.md` 为准；
> 若计划与契约冲突，先改契约，再改计划。

## 0. 计划原则

1. **垂直切片优先**。M1 结束时必须有一条能跑通的闭环：打开文件夹 → 编辑 → 保存 → 在沙箱 iframe 里渲染出纯 Markdown。宁可这条链窄，也不要先横向铺满所有后端命令。
2. **包 = 一次提交范围 = 一份 R 记录**。包内不夹带下一个包的内容，方便回滚与定位。
3. **每个包必须有可执行的验收**。不接受「跑起来看着没问题」；验收写成命令、测试或一段固定的点击路径。
4. **契约先行**。实现中发现契约不足，先改 `ARCHITECTURE.md`，再写代码，同一个提交。

## 1. 里程碑

| 里程碑 | 能力 | 工作包 | 累计人日 | 建议周次 | 出口条件 |
|---|---|---|---|---|---|
| M0 | 骨架可跑 | P0 | 3 | 第 1 周 | `cargo tauri dev` 起空窗口，lint 能拦住违规 import |
| M1 | 最小闭环 | P1 P2 P3 | 19 | 第 4 周末 | 打开文件夹、编辑保存、iframe 内渲染出带 `data-line` 的纯 Markdown |
| M2 | 插件可用 | P4 P5(前半) | 33 | 第 7 周 | 3 个 L1 插件在 Worker 与主线程双环境行为一致 |
| M3 | 日常可用 | P5(后半) P6 P7 P8 P9 | 50 | 第 10 周 | 7 个内置插件、主题四档、比例记忆，可以拿它写一篇真实文档 |
| M4 | 可交付 | P10 P11 P12 | 65 | 第 13 周 | 第三方插件可从文件夹安装，能导出与预览一致的 HTML/PDF |
| M5 | 可发布 | P13 P14 | 73 | 第 15 周 | 8MB 文档可用，安装包可分发 |

单点估算按**单人全职、熟悉 TypeScript 与 Rust** 计，含自测、不含返工。加 20% 缓冲后约 **88 人日 / 17–18 周**。

## 2. 工作包

### P0 · 工程骨架（3 人日）

- 按 `ARCHITECTURE.md` §3 建目录：`src-tauri/`、`frontend/src/{bridge,editor,shell,vault,plugins,settings,theme}`、`frontend/preview-shell/`、`frontend/plugins/`。
- `capabilities/default.json` 只授予主窗口 `core:default` + 自定义命令；`tauri.conf.json` 的 CSP 放行 `worker-src blob:`。
- `bridge/` 是唯一允许 `import @tauri-apps/api` 的目录，用 ESLint `no-restricted-imports` 强制，并写一个故意违规的用例验证规则真的生效。
- **验收**：`npm run typecheck`、`cargo clippy -D warnings`、`cargo tauri dev` 三者均通过；违规 import 被 lint 拦下。

### P1 · 文件层（5 人日）

- `paths.rs` 实现 §9.2 四条规则，单测覆盖：绝对路径、`..`、UNC、符号链接、大小写差异、`\\?\` 长路径、vault 外路径。
- 命令：`open_vault` / `list_dir` / `read_doc` / `write_doc` / `create_entry` / `rename_entry` / `delete_entry` / `reveal_in_explorer`。
- `read_doc` 超 32MB 拒绝；`write_doc` 的 `expectedMtime` 不匹配返回 `CONFLICT`；删除走系统回收站。
- **验收**：单测全绿；手动改文件后立刻保存，能收到 `CONFLICT` 而不是静默覆盖。

### P2 · 预览资源服务（3 人日）

- `127.0.0.1:0` + 32 字节随机 token；路由 `/p/{token}/shell`、`/p/{token}/plugin/{id}/{path}`、`/p/{token}/asset`（§9.4）。
- token 错误一律 403 且不泄露路由存在性；插件路径只允许 `entry.js` / `style.css` / `assets/*`；`asset` 只放行白名单扩展名。
- 随应用退出销毁，`stop_preview_server` 后可换新 token。
- **验收**：`curl` 无 token 403、带 token 200、`..` 穿越 403、非白名单扩展名 403。

### P3 · 渲染内核（8 人日）

- `preview-shell/shell.ts` 握手：`ready` → 宿主发 `doc`，带 `gen` 代际号丢弃过期批次。
- `blocks.ts` 按顶层 token 切块，外层 `<section class="ge-block" data-key data-line>`；`key = hash(源码 + 插件版本 + 主题模式)`（§6.3）。
- `pipeline.ts`：markdown-it 解析 → morphdom 增量 → 首屏 200 块分片 → 150ms 防抖 → 代际取消。
- Worker 内跑 markdown-it 与 L1 插件；L2 块回主线程 mount。
- 按 §6.4 四档阈值降级，>10MB 暂停预览并给出恢复入口。
- **验收**：连续输入时滚动位置不跳、mermaid 节点引用不变；8MB 样本首屏 < 2s。

### P4 · 插件运行时（6 人日）

- manifest 校验：`id` 唯一、`apiVersion` 兼容、字段缺失降级为禁用而非崩溃（§5.3）。
- `PluginContext` 完整实现（§5.5）：`env / config / doc / theme / onFence / onContainer / onDelimiter / onMount / assets / libs / log`；字段为 getter，配置变更后下一次渲染立即生效。
- 能力分级按运行时访问记录判定：`mount` → L2，`fetch` → L3（一期不开放），纯返回字符串 → L1。
- 双环境：同一 `entry.js` 在 Worker 与主线程各执行一次 `register`，用 `ctx.scope` 分支（§5.5）。
- 错误降级三条（§5.7）：`register` 抛错只影响该插件；`mount` 抛错块内显示源码 + 错误；3s 超时给重试。
- **验收**：写一个故意抛错的插件，只有对应块降级，其余照常；把 `register` 改成死循环，3s 后出现超时卡片。

### P5 · 内置插件（8 人日）

- 批次 A（L1 纯函数）：`callout`、`table-gfm`、`heading-number`（需内置口子 `ctx.onCoreRule`）。
- 批次 B（L2）：`mermaid`、`katex`、`codebar`。
- 批次 C（L0）：`typographer` 纯 CSS。
- `dialogue` 视档期后置，不影响 M3 出口。
- **验收**：7 个插件在双环境行为一致；所有颜色走 `--ge-*`，暗色预览无破相；`grep -r "#[0-9a-f]{3,6}" frontend/plugins` 无硬编码颜色。

### P6 · 编辑器（4 人日）

- Monaco + `golden-dark`；CSP 放行后确认高亮与查找可用（Wails 下不会暴露的问题）。
- 保存、脏标记、`Ctrl+S`、撤销栈保留；外部改动走 `doc:external_changed` 提示「重载 / 保留我的」。
- 预览块行号角标点击 → 编辑器定位到对应行并把光标放到行首。
- **验收**：点预览 `L18`，编辑器滚到第 18 行；外部改文件不覆盖当前输入。

### P7 · 应用外壳（7 人日）

- 左栏三段：品牌区 / 导航区 / 分组区（文件顶部锚定、大纲与版本沉底）（§8）。
- 折叠方向：顶部组向上收、沉底组向下收，220ms 高度过渡。
- 标签页、分隔条拖动、预览面板按钮开合、状态条、内容页（插件 / 设置）占内容区并保留左栏。
- 命令面板（`Ctrl+Shift+P`）覆盖全部操作。
- **验收**：原型 v5 的交互逐条复现；折叠方向与沉底行为一致；分栏比例拖动后状态条文案正确。

### P8 · 主题（3 人日）

- 四档预设 + 高级里编辑器/预览各一个独立下拉（§7.1）。
- `theme/tokens.ts` 生成 editor / preview 两套变量，L3 只做 `setProperty`（§7.2）。
- **验收**：切换主题不触发整页重绘（mermaid 不重绘）；暗色预览下 callout / 代码块 / 表格颜色正确。

### P9 · 设置与状态（3 人日）

- `settings.json` 深合并、原子写；`ui-state.json` 按 `vaultId + relPath` 记忆比例、预览收起、滚动位置（§10）。
- 拖动只改内存，松手落盘。
- **验收**：关闭重开，比例与展开状态复原；用户仓库目录内不产生任何隐藏文件。

### P10 · 插件管理 UI 与诊断（6 人日）

- 卡片列表（名称 / 版本 / 来源 / 权限等级 / 触发语法）、开关、按 `manifest.config` 生成的配置表单。
- 从文件夹安装（只复制与校验，不执行）、移除。
- 诊断面板：每个块命中的插件、耗时、错误栈。
- **验收**：装一个第三方插件，勾选后预览重渲染并提示「已启用 X，重渲染 N 个块」；故意装坏插件，只在诊断里亮红，不影响其它块。

### P11 · 导出（5 人日）

- 单文件 HTML：内联 CSS / 图片 / 字体，插件 CSS 与插件脚本各自可选（§9.5）。
- PDF：Windows 走 WebView2 `PrintToPdfAsync` + `@page`；其它平台降级为打印对话框。
- 导出与预览共用同一段渲染代码，Rust 只落盘。
- **验收**：导出的 HTML 与预览截图逐像素对比偏差可解释；含长代码块与表格的 PDF 不被截断。

### P12 · 系统集成（4 人日）

- 单实例、`.md` 文件关联、`goldenedit file.md` 命令行打开。
- 拖入文件 / 文件夹；最近 vault。
- **验收**：双击 `.md` 由 GoldenEdit 打开；第二个实例把路径转给第一个窗口而不是再开一个。

### P13 · 性能与稳定性（5 人日）

- 三份样本：200KB / 2MB / 8MB（§13）。
- 压测：冷启动、连续输入、快速切文件、插件重载。
- 全链路兜底：任一环节异常都必须落成块内错误卡，不留白屏路径。
- **验收**：8MB 文档打开 < 2s 出首屏；快速切 10 个文件不出现错块或空白。

### P14 · 发布（3 人日）

- 安装包（NSIS / MSI）、图标、版本号、签名。
- 首次启动引导：打开文件夹 / 最近项目 / 拖入文件。
- **验收**：干净机器安装后可直接打开并编辑，不需要额外运行时。

## 3. 依赖与关键路径

关键路径只有一条：

```
P0 → P1 → P2 → P3 → P4 → P5 → P10 → P11 → P13 → P14
```

其余包的依赖关系：

| 包 | 依赖 | 说明 |
|---|---|---|
| P6 编辑器 | P1、P3 | 读写文件靠 P1，跳转目标行靠 P3 生成的 `data-line` |
| P7 外壳 | P1 | 左栏读 `list_dir`，其余纯前端 |
| P8 主题 | P3 | token 要注入到预览 iframe 内 |
| P9 设置与状态 | P7 | 先有比例拖动，才有可持久化的状态 |
| P11 导出 | P3、P8 | 复用渲染与主题 token，不另写渲染器 |
| P12 系统集成 | P1、P7 | 文件关联与最近项目依赖 vault 与外壳 |

两条纪律：

- **P11 不要提前**。导出必须复用 P3 的渲染代码，早做等于维护第二套渲染器，插件一多必然对不上。
- **P6–P9 只依赖 P1**，理论上可与 P2、P3 交替做。单人开发时并行没有意义，但可以拿它们做上下文切换：渲染管线卡住时去把左栏画出来，比硬啃更省时间。

## 4. 建议施工顺序（单人）

| 周 | 内容 |
|---|---|
| 1 | P0 |
| 2 | P1 |
| 3 | P7 前半（左栏 + 标签 + 分栏，先用假数据） |
| 4 | P2 |
| 5–6 | P3 |
| 7 | P4 |
| 8–9 | P5 |
| 10 | P6 + P8 |
| 11 | P9 + P10 前半 |
| 12 | P10 后半 + P11 |
| 13 | P11 收尾 + P12 |
| 14 | P13 |
| 15 | P14 |

把 P7 前半提到第 3 周，是为了尽早看见成品形态：外壳是纯前端，不依赖渲染内核，先做能让后面两周的调试有地方落。

## 5. 第一个迭代（10 天）任务清单

- [ ] D1 `npm create vite` + `tauri init`，按 §3 建空目录，跑通 `cargo tauri dev`
- [ ] D1 capabilities 与 CSP 配置；写违规 import 的 lint 用例
- [ ] D2 `bridge/` 封装 `invoke` 与事件订阅，类型与 §9.1 对齐
- [ ] D3 `paths.rs` + 前 4 条单测（绝对路径 / `..` / UNC / 符号链接）
- [ ] D4 补 3 条单测（大小写 / 长路径 / vault 外路径）；实现 `open_vault` `list_dir`
- [ ] D5 `read_doc` `write_doc` + `CONFLICT` 分支 + 32MB 上限
- [ ] D6 `create_entry` `rename_entry` `delete_entry`（回收站）+ `reveal_in_explorer`
- [ ] D7 前端左栏接真实 `list_dir`，懒加载展开
- [ ] D8 预览服务骨架：绑定端口、token、`/shell` 返回占位页
- [ ] D9 `asset` 路由 + 扩展名白名单 + 路径穿越防护，补齐 P2 验收
- [ ] D10 复盘：把本周发现与契约不一致的地方写进 `ARCHITECTURE.md`，再进 P3

## 6. 每个包的完成定义（DoD）

一个包只有在下面五条全绿时才算完成：

1. 代码合并，`typecheck` / `clippy` / 单测通过；
2. 上表的**验收**实际执行过，结果写进对应的 R 记录；
3. `Features.md` 里相关条目的状态标记已改（📋 → 🚧 → ✅）；
4. `ChangeLog.md` 有对应条目，废弃项写明去向；
5. 提交信息里带本次 R 记录文件名。

## 7. 估算假设与风险

- 估算不含：图标与视觉打磨、文案、官网、自动更新、代码签名证书采购。
- 风险最高的是 **P3 与 P4**（双环境约定、块 key、时序），给它们留的缓冲应比其他包多；P13 的三份样本要提前准备，不要等到最后。
- 若时间被压缩，**先砍 P12 与 P14 的可选项**（自动更新、命令行打开），不要砍 P5 与 P10——插件体系是产品差异化的全部来源。

## 8. 一期明确不做

- HTML 文档的编辑与实时预览（只做 Markdown；`.html` 预览留到二期）
- 移动端、协作、云同步、Git 集成面板
- PNG 导出、PDF 页码
- 通用 `read_file` / `write_file` / `exec` / `http_request`（§9.6）
- 插件市场的远程安装（一期只支持从本地文件夹安装）
