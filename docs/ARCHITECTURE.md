# GoldenEdit 架构设计

> **本文件是软件设计契约。** 实现必须与本文一致；任何架构层面的变更，必须先修改本文件、再修改代码。
> 版本基线：0.1.0 · 2026-10-28 · 目标平台 Windows（WebView2），架构上不排斥 macOS / Linux。

---

## 0. 文档治理

### 0.1 文档职责

| 文件 | 职责 |
|---|---|
| `docs/Features.md` | 功能清单。每条一句话，带状态标记。 |
| `docs/ChangeLog.md` | 变更流水，按时间倒序。 |
| `docs/ARCHITECTURE.md` | 本文。架构契约，唯一权威。 |
| `docs/R-YYMMDD-00XX.md` | 需求 / 功能迭代记录。 |
| `docs/BugFix-YYMMDD-00XX.md` | 缺陷修复记录。 |

### 0.2 强制规则

- 新增功能：必须同时更新 `Features.md` 与 `ChangeLog.md`。
- 修改已有功能行为：必须更新 `Features.md`，并在 `ChangeLog.md` 记录。
- 删除 / 废弃功能：必须更新 `Features.md` 状态，并在 `ChangeLog.md` 记录废弃 / 迁移说明。
- 仅修 bug、不改功能行为：至少更新 `ChangeLog.md`；若影响功能说明，再更新 `Features.md`。
- 架构发生变化：必须先更新 `ARCHITECTURE.md`，并在 `ChangeLog.md` 中注明「架构变更」。
- 只改代码、不改文档：不允许提交，除非能明确说明「本次变更不触发任何文档更新」。
- 文档更新与代码变更放在同一个提交中，不允许事后补。

### 0.3 状态标记

`✅ 已实现` / `🚧 开发中` / `📋 规划中` / `🗑 废弃`

### 0.4 记录文件头

`R-*` 与 `BugFix-*` 文件必须以下述头部开始，便于检索：

```markdown
---
date: YYYY-MM-DD
abstract: 一句话摘要
status: 待处理 | 已处理 | 已取消
---
```

---

## 1. 产品定位与边界

**一句话**：把 Markdown 当源码，把预览当可插拔的渲染目标。

**差异化**：Typora 的主题只能换皮，Obsidian 的插件绑死在 Obsidian 内，VS Code 扩展只能活在 VSCode 的预览里。GoldenEdit 把「渲染」本身做成可外挂的：丢一个 JS/CSS 目录进去、勾选、预览立刻变样，并且能把这套外观原样导出成一份独立 HTML。

**目标用户**：需要控制「文档交付形态」的人——写技术文档、研报、剧本，且不接受「在我的机器上很好看，发出去就散了」。

**明确不做**：

| 不做 | 原因 |
|---|---|
| 移动端 | 编辑依赖键盘与多窗格；手机端定位是「读」，属于后期用同一套渲染层做网页版 |
| 所见即所得（Typora 式行内编辑） | 与「源码 / 成品分离」的产品模型冲突，且成本极高 |
| 云同步 / 多人协作 | 一期契约里只留接口，不实现 |
| 双链 / 笔记库 / 图谱 | 这是 Obsidian 的战场，不进入 |
| 插件市场与在线分发 | 一期只支持本地目录安装；`manifest.source` 字段预留 |

**争议裁决标准**：当功能取舍僵持时，问一句「它是否让预览更可编程、或让交付更可控」。答否即推迟。

---

## 2. 系统分层

```
┌──────────────────────────────────────────────────────────────┐
│ L1  Rust 宿主（tauri core）                                   │
│     文件读写 / 目录扫描 / 文件监听 / 设置持久化 / 导出落盘     │
│     预览 HTTP 服务 / 原生对话框 / 外部链接                     │
│     职责红线：不解析 Markdown，不碰渲染树                      │
└───────────────────────────┬──────────────────────────────────┘
                            │ Tauri IPC（仅 L2 持有 capability）
┌───────────────────────────▼──────────────────────────────────┐
│ L2  主 WebView（可信上下文）                                   │
│     Monaco 编辑器 / 左侧分组导航 / 标签页 / 设置 / 插件管理      │
│     postMessage 桥 / 剪贴板 / 快捷键                           │
└───────────────────────────┬──────────────────────────────────┘
                            │ postMessage（双向 origin 校验）
┌───────────────────────────▼──────────────────────────────────┐
│ L3  预览 iframe（不可信上下文，opaque origin）                  │
│     预览外壳页 / markdown-it 管线 / 插件运行时 / Worker        │
│     无 Tauri IPC、无宿主 DOM、无 localStorage                  │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 层间铁律

1. **L1 不解析 Markdown**。所有语法树与渲染逻辑都在 L3。L1 只认字节和路径。
2. **L2 是唯一持有 Tauri capability 的上下文**。所有特权操作只能由 L2 发起。
3. **L3 必须从预览服务的独立源加载**，不得使用 `srcdoc`、不得加载应用自身页面。原因：`srcdoc` 会继承父页面源，Tauri 的 IPC 注入脚本可能随之进入，沙箱失效。
4. **插件代码只允许在 L3 执行**。插件永远拿不到 L2 的 DOM，也拿不到任何 IPC。
5. **数据单向**：文档内容与配置由 L2 推入 L3；渲染结果只留在 L3；L3 只能回传事件（跳转、复制、日志）。L3 不向 L2 回传 HTML。

### 2.2 为什么渲染不在 Rust 侧

插件是 JS/CSS，`markdown-it` 的 fence / container 规则是插件唯一的挂载点。若渲染放 Rust，插件必须改成 WASM 或跨进程 RPC，「丢一个 JS 目录进去就能用」这个核心承诺立刻破产。

---

## 3. 目录结构

```
GoldenEdit/
├─ src-tauri/
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  ├─ capabilities/default.json          # 只授予主窗口 core:default + 自定义命令
│  └─ src/
│     ├─ main.rs
│     ├─ lib.rs
│     ├─ state.rs                       # AppState：vault / settings / 插件注册表
│     ├─ paths.rs                       # 路径守卫（唯一允许拼路径的地方）
│     ├─ watcher.rs                     # notify 封装
│     ├─ preview_server.rs              # 本地 HTTP 服务
│     └─ commands/
│        ├─ vault.rs  ├─ doc.rs  ├─ settings.rs
│        ├─ plugin.rs ├─ export.rs ├─ system.rs
├─ frontend/
│  ├─ index.html
│  ├─ vite.config.ts
│  ├─ src/
│  │  ├─ main.ts
│  │  ├─ bridge/            # invoke 封装 + 事件订阅（唯一碰 @tauri-apps/api 的目录）
│  │  ├─ editor/            # Monaco 实例、golden-dark 主题、Emacs/Vim 预留
│  │  ├─ shell/             # 应用外壳：左栏分组、标签页、分栏、模态、状态条
│  │  ├─ vault/             # 文件分组（懒加载）与大纲分组
│  │  ├─ plugins/           # 插件管理 UI（不含运行时）
│  │  ├─ settings/
│  │  └─ theme/             # 设计 token、预设、生成 --ge-* 变量
│  ├─ preview-shell/        # L3 入口页（打进预览服务，不打包进主页面）
│  │  ├─ shell.ts           # 消息桥 + 管线装配
│  │  ├─ pipeline.ts        # 解析 / 分块 / morphdom / mount 调度
│  │  ├─ blocks.ts          # 块切分与 key
│  │  ├─ context.ts         # PluginContext 实现
│  │  ├─ worker/parse.ts    # Worker：markdown-it + L1 插件
│  │  └─ plugins.css        # --ge-* 变量消费方样式
│  └─ plugins/              # 内置插件（随包发布，构建期复制到预览服务根）
│     ├─ callout/  ├─ heading-number/ ├─ mermaid/
│     ├─ katex/    ├─ codebar/        ├─ table-gfm/  └─ dialogue/
├─ design/prototype/index.html
├─ docs/
└─ README.md
```

**约束**：`frontend/src` 内除 `bridge/` 外，任何文件不得 import `@tauri-apps/api`。这是为了让预览侧的代码将来能原样搬到网页版。

---

## 4. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 壳 | Tauri 2（Rust） | 体积小、capability 权限模型细、CSP 可控 |
| 编辑器 | Monaco | VS Code 内核，Markdown 高亮、查找替换、多光标、折叠白送；现有 `setup.ts` 可直接平移 |
| 渲染 | markdown-it | 插件的 fence / container 挂载点天然，生态成熟 |
| DOM 增量 | morphdom | 按块 diff，不重建未变节点 |
| 数学 | KaTeX（离线） | 快、无 CDN 依赖 |
| 图表 | Mermaid（离线） | 对比页共识项 |
| 构建 | Vite + TypeScript | 标准 |
| 文件监听 | notify | Rust 生态标准实现 |
| 预览服务 | tiny_http 或 axum | 只服务静态资源，无需框架能力 |

**Monaco 的已知约束**：靠 Web Worker 做语法分析，Tauri 的 CSP 会拦 `blob:` worker，必须放行 `worker-src blob:`。这是 Wails 下不会暴露、Tauri 下必然遇到的差异。

---

## 5. 插件体系（核心契约）

### 5.1 三条设计原则

1. **插件只产内容，不产结构。** 块包裹、`data-line` 锚点、错误卡片一律由管线生成，插件无法介入。这样「第三方插件渲染完丢掉行号、点击跳转失效」这个必然出现的 bug 在架构上被杜绝，而不是靠文档约束。
2. **能力按「用了哪个口子」划分，不按作者自述。** 等级由运行时检测得出：用了 `onMount` 即 L2，用了 `ctx.net` 即 L3。manifest 里的 `permissions` 只用于「安装时提示」，不参与授权判断。
3. **`ctx` 字段全部是 getter。** 插件若缓存 `ctx.config`，用户改配置后它将不响应。每次读取都必须拿到最新值。

### 5.2 包结构

```
plugins/mermaid/
├─ manifest.json
├─ entry.js            # ES module，必须导出 register(md, ctx)
├─ style.css           # 可选，注入预览外壳，作用于 .ge-plugin-mermaid 作用域
└─ assets/             # 可选，通过 ctx.assets.url() 引用
```

### 5.3 manifest.json

```json
{
  "id": "mermaid",
  "name": "Mermaid 图表",
  "version": "1.4.2",
  "apiVersion": 1,
  "author": "builtin",
  "description": "流程图、时序图、甘特图",
  "trust": "builtin",
  "entry": "entry.js",
  "style": "style.css",
  "match": {
    "fence": ["mermaid", "mmd"],
    "container": [],
    "delimiter": []
  },
  "permissions": ["dom", "libs:mermaid"],
  "config": {
    "theme": { "type": "select", "default": "auto", "options": ["auto", "default", "dark", "neutral"] },
    "curve": { "type": "select", "default": "basis", "options": ["basis", "linear", "step"] }
  },
  "preview": "preview.png",
  "source": { "type": "builtin" }
}
```

字段规则：

- `apiVersion` 必须等于宿主支持的版本，否则拒绝加载并在插件页标注「需要更新宿主」。
- `trust` 取 `builtin` / `local`。仅 `builtin` 可取用 `ctx.onCoreRule`。
- `match` 三类可组合：`fence`（```lang）、`container`（`::: name`）、`delimiter`（`$...$` 等定界符）。
- `config` 的 schema 类型限定 `boolean / select / number / string / textarea`，插件页据此自动渲染表单。
- `source` 记录来源，`builtin` / `local` / 预留 `remote`。

### 5.4 能力分级

| 等级 | 判定条件 | 能力 | 安装提示 |
|---|---|---|---|
| L0 | 只有 `style.css`，无 `entry.js` | 纯样式覆盖 | 无风险 |
| L1 | 只用 `onFence / onContainer / onDelimiter`，且回调为纯函数 | 同步返回 HTML 字符串，可在 Worker 中执行 | 低 |
| L2 | 使用 `onMount` | 可操作自己容器内的 DOM | 中 |
| L3 | 使用 `ctx.net` 或 `ctx.fs` | 可发起网络请求 / 读取白名单目录 | 高，需二次确认 |

检测在加载时进行：对 `ctx` 的受限成员使用 Proxy 记录访问，`register` 结束后按访问记录计算等级并写入诊断面板。

### 5.5 PluginContext 契约

```ts
export interface PluginContext {
  readonly env: { apiVersion: 1; hostVersion: string; locale: string; scope: 'worker' | 'main' };
  readonly config: Readonly<Record<string, unknown>>;   // getter，每次读取取最新值
  readonly doc: Readonly<{ path: string; name: string; dir: string; frontmatter: Record<string, unknown> }>;
  readonly theme: Readonly<{ mode: 'light' | 'dark'; tokens: Readonly<Record<string, string>> }>;

  onFence(langs: string[], fn: (info: string, code: string, ctx: PluginContext) => string): void;
  onContainer(names: string[], fn: (name: string, body: string, attrs: Record<string, string>, ctx: PluginContext) => string): void;
  onDelimiter(kind: 'inline' | 'block', fn: (text: string, ctx: PluginContext) => string): void;

  onMount(selector: string, fn: (el: HTMLElement, payload: unknown, ctx: PluginContext) => void | (() => void)): void;

  assets: { url(rel: string): string };
  libs: { load(name: 'mermaid' | 'katex'): Promise<unknown> };
  log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void;

  // 仅 trust === 'builtin'
  onCoreRule?(fn: (state: unknown) => void): void;
}
```

**双环境约定（必须遵守）**：同一份 `entry.js` 会在 Worker 与主线程各执行一次 `register`。

- Worker 中 `ctx.scope === 'worker'`：`onMount` 注册为空操作；`onFence / onContainer / onDelimiter` 正常生效。因此这类回调**必须是纯函数**，不得引用 DOM、`window`、模块级可变状态。
- 主线程中 `ctx.scope === 'main'`：`onFence` 等注册为空操作（渲染已在 Worker 完成）；`onMount` 正常生效。
- 插件若在两个环境行为必须不同，用 `ctx.scope` 分支，不要探测 `typeof window`。

**禁止清单**（宿主不提供，且 CSP 层拦截）：`fetch` / `XMLHttpRequest` / `WebSocket`（除 L3 代理）、`localStorage`、`window.parent`、`document.cookie`、任何 Tauri API。

### 5.6 块与锚点归属

管线在 Worker 侧按 markdown-it 顶层 token 切块，每块输出：

```ts
interface Block {
  key: string;        // hash(源码 + 影响它的插件 id@version + theme.mode)
  html: string;       // 插件 L1 输出，未包裹
  line: number;       // token.map[0] + 1
  pending: string[];  // 需要主线程 mount 的插件 id
}
```

主线程负责包裹：

```html
<section class="ge-block" data-key="{key}" data-line="{line}" data-plugins="mermaid">
  <!-- 插件返回的 html -->
</section>
```

**插件不得输出 `data-line`、不得自带外层 `<section>`**；管线会剥离插件返回内容中的 `data-line` 属性并记一条 warn。

### 5.7 错误、超时与降级

| 场景 | 行为 |
|---|---|
| `register` 抛错 | 该插件标记「加载失败」，其余插件照常；插件页显示红色状态 |
| L1 渲染抛错 | 该块降级为纯文本源码，附错误条；不影响其它块 |
| `onMount` 抛错 | 容器内显示错误卡片（错误信息 + 原始代码 + 重试按钮） |
| `onMount` 超过 3s 未完成 | 显示「渲染超时」，保留重试入口 |
| `register` 超过 2s | 中止该插件加载 |
| 插件样式缺失 | 不视为错误 |

任何情况下**不允许整页白屏**，这是硬性验收标准。

### 5.8 主题变量契约

插件所有颜色必须使用 `--ge-*` 变量，禁止硬编码色值。

```css
:root {
  --ge-bg, --ge-bg-subtle, --ge-fg, --ge-fg-muted,
  --ge-border, --ge-accent, --ge-accent-fg,
  --ge-code-bg, --ge-code-fg, --ge-link,
  /* 语义色 */
  --ge-note, --ge-tip, --ge-warn, --ge-danger, --ge-success
}
```

插件如需在运行时绘制（Mermaid、Canvas），从 `ctx.theme.tokens` 读取同名变量值，不要解析 CSS。

### 5.9 安装与扫描

扫描三处，后者覆盖前者（同 id 时用户在插件页看到「覆盖」标记）：

1. 应用资源目录 `plugins/`（内置，只读）
2. 用户数据目录 `<appdata>/GoldenEdit/plugins/<id>/`
3. 当前 vault 下 `.goldenedit/plugins/<id>/`（可选，默认关闭，便于项目自带插件）

安装方式：拖入文件夹、选择文件夹、从 zip 解压。安装仅做「复制到用户目录 + 校验 manifest」，不执行任何脚本。

### 5.10 启停与重载

勾选状态变化时，**重建整个预览 iframe**，而不是热替换 `register`。理由：重建能消除一切残留状态（定时器、缓存、全局变量），代价是一次重新渲染（<100ms）。插件文件 mtime 变化同样触发重建。

---

## 6. 渲染管线

### 6.1 主链路

```
Monaco change
  └─(150ms 防抖 + 代际号 gen++)→ L2 发送 {type:'doc', gen, text, path}
        └─ L3 shell 收到 → 若 gen < 当前代际则丢弃
              └─ Worker: markdown-it 解析 → L1 插件渲染 → 切块 → 计算 key
                    └─ 主线程：morphdom 按 key diff → 对 pending 块执行 onMount
                          └─ 首屏后 requestIdleCallback 继续渲染剩余块
```

### 6.2 四层性能策略（全部实现）

| 层 | 机制 | 解决的问题 |
|---|---|---|
| 1 | **块级 morphdom** | 全量 `innerHTML` 造成的 mermaid 重绘、折叠状态丢失、滚动跳变 |
| 2 | **分片渲染** | 首屏只渲染前 200 块，其余空转插入，打开大文档不冻结 |
| 3 | **防抖 + 代际取消** | 连续输入时旧的渲染结果覆盖新的；用 `gen` 单调递增，L3 丢弃过期批次 |
| 4 | **Worker 解析** | 主线程不被 markdown-it 阻塞；L1 插件在 Worker 内执行，L2 块回主线程 mount |

第 4 层的边界必须写清：**Worker 里没有 DOM**，因此 L2 插件在 Worker 阶段只产出占位容器，由主线程 `onMount` 填充。这也是 5.5 双环境约定的由来。

### 6.3 块 key 算法

```
key = base36( fnv1a( blockSource + "\u0000" + sortedPluginIds + "\u0000" + themeMode ) )
```

- `blockSource`：该 token 对应的原始 Markdown 片段
- `sortedPluginIds`：当前启用且 `match` 命中的插件 `id@version`，排序后拼接
- `themeMode`：切换主题时强制重建（Mermaid 需要按新配色重绘）

key 相同 → 节点原地保留，DOM 状态（折叠、选中、SVG）全部保住。

### 6.4 阈值策略

| 文档大小 | 策略 |
|---|---|
| < 200 KB | 全量渲染，不分片、不 morph（开销小于收益） |
| 200 KB – 2 MB | 块级 morphdom + 分片 |
| 2 MB – 10 MB | 追加：只渲染视口上下各 2 屏，滚动时补齐 |
| > 10 MB | 预览默认收起，顶部提示「文档较大，预览已暂停」，提供手动渲染按钮 |

编辑器不受此限制（Monaco 自身按行虚拟化）。

### 6.5 跳转与滚动同步

- 每个块有 `data-line`；L3 在块左侧渲染行号角标（hover 才显示）。
- 点击角标 → `postMessage({type:'jump', line})` → L2 调用 `monaco.revealLineInCenter`。
- 正文区域**不拦截点击**，保持原生选区 / 双击选词行为。
- 滚动同步默认关闭，作为可选项；实现方式为 L2 取 Monaco 首个可见行，L3 滚动到对应块。

---

## 7. 主题模型

### 7.1 四档预设

| 预设 | 编辑器 | 预览 |
|---|---|---|
| 跟随系统 | 系统 | 系统 |
| 写作模式 | 暗 | 亮 |
| 全亮 | 亮 | 亮 |
| 全暗 | 暗 | 暗 |

另提供「高级」：编辑器与预览各有一个独立下拉，可任意组合。

### 7.2 变量来源

L2 的 `theme/tokens.ts` 生成两套 CSS 变量（editor / preview），通过 `{type:'theme', mode, tokens}` 推给 L3。L3 只做 `document.documentElement.style.setProperty`，不加载任何样式表变量文件。

设计意图：预览主题与应用主题可完全解耦，`golden-light` 皮肤与 `golden-dark` 皮肤只是两组 token。

---

## 8. 布局与交互契约

| 元素 | 行为 |
|---|---|
| 左栏 | 常驻 208px，三段式：品牌区（名称 + 版本 + 工作区切换）/ 导航区（新建、打开文件夹、插件、导出）/ 分组区（文件、大纲、版本） |
| 文件分组 | 顶部锚定，左栏内可折叠分组，树形懒加载；分组头显示总数，未保存文件带金点 |
| 大纲分组 | 沉底锚定，与文件分组分离；随当前文档标题生成；`Ctrl+Shift+O` 折叠/展开并滚入视口 |
| 版本分组 | 沉底锚定，位于大纲之下；时间线展示 git 提交（版本号 / 短哈希 / 日期 / 说明），最新一条高亮 |
| 折叠方向 | 顶部组向上收（分组头不动）；沉底组向下收（分组头回落到最下方）；高度过渡 220ms |
| 分组滚动 | 仅分组区滚动；沉底组用 `margin-top:auto` 贴底，内容超出时退化为普通流 |
| 预览 | 右侧面板，默认 46%；由标题栏最右端方形按钮开合（开启态高亮）；`Ctrl+Shift+V`；双击分隔条收起 |
| 内容页 | 插件等导航页从侧栏右侧开始（`left:208px`），保留左栏、隐藏标签栏 |
| 模态 | 导出以模态覆盖全窗；同一时刻只允许一个模态 |
| 分栏比例 | 按文件记忆；拖动过程只改内存，松手落盘；两侧最小宽度 320 / 280 |
| 状态条 | 字数、预计阅读时长、记忆的分栏比例、行列号、编码、语言 |

**收起后编辑区最大宽度 1100px 居中**：行宽过长影响可读性，「只看源码」模式必须可用。

---

## 9. Rust 侧契约

### 9.1 命令清单

前端**永远不传绝对路径**，只传相对 vault 的路径或用户显式选择后的句柄。

| 命令 | 签名 | 说明 |
|---|---|---|
| `open_vault` | `(path: String) → VaultInfo` | 记录根路径，返回名称与首层条目 |
| `list_dir` | `(rel: String) → Entry[]` | 懒加载，按需展开 |
| `read_doc` | `(rel: String) → { text, mtime, hash }` | 超过 32 MB 拒绝并返回错误码 |
| `write_doc` | `(rel, text, expectedMtime) → { mtime }` | `expectedMtime` 不匹配返回 `CONFLICT` |
| `create_entry` / `rename_entry` / `delete_entry` | `(rel, …)` | 删除走系统回收站 |
| `reveal_in_explorer` | `(rel)` | |
| `watch_vault` / `unwatch_vault` | `()` | 事件回推 `vault:changed` |
| `get_settings` / `set_settings` | `(patch) → Settings` | 深合并 |
| `scan_plugins` | `() → PluginManifest[]` | 三处扫描合并 |
| `install_plugin` / `remove_plugin` | `(src) / (id)` | 安装只复制与校验，不执行 |
| `save_export` | `(path, bytes) → ()` | 内容由前端生成 |
| `start_preview_server` | `() → { port, token, origin }` | 端口 0，随机 token |
| `stop_preview_server` | `()` | 退出时自动调用 |
| `open_external` | `(url)` | 仅 http / https / mailto |
| `pick_folder` / `pick_file` / `save_dialog` | | 原生对话框 |
| `get_app_info` | `→ { version, platform }` | |

### 9.2 路径守卫

所有接收 `rel` 的命令必须经过 `paths::resolve_in_vault()`：

1. 拒绝绝对路径、盘符、UNC（`\\`）、`..` 段。
2. `canonicalize` 后校验 `starts_with(vault_root)`。
3. Windows 下比较前统一小写并处理长路径前缀 `\\?\`。
4. 符号链接一律解析后校验，解析失败即拒绝。

**这是唯一允许拼接路径的模块**，其它模块不得自行 `Path::join` 用户输入。

### 9.3 事件

| 事件 | 载荷 | 触发 |
|---|---|---|
| `vault:changed` | `{ paths: string[] }` | 文件系统监听 |
| `doc:external_changed` | `{ rel, mtime }` | 当前打开文件被外部修改 |
| `server:ready` | `{ origin }` | 预览服务启动完成 |

### 9.4 预览 HTTP 服务

- 绑定 `127.0.0.1:0`，由系统分配端口，随机 32 字节 token。
- 路由：
  - `GET /p/{token}/shell` → 预览外壳页（内联 CSP，`script-src 'self'; style-src 'self' 'unsafe-inline'`）
  - `GET /p/{token}/plugin/{id}/{path}` → 插件文件（仅允许 `entry.js` / `style.css` / `assets/*`）
  - `GET /p/{token}/asset?p={rel}` → vault 内图片与字体（仅白名单扩展名）
  - 其它 → 404
- token 校验失败一律 403，不泄露路由是否存在。
- 服务进程内运行，随应用退出销毁；`stop_preview_server` 后可重新生成 token。

**为什么不用 `asset://`**：`sandbox="allow-scripts"` 的 iframe 是 opaque origin，自定义协议在该场景下行为不一致，图片与字体会加载失败。走本地 HTTP 后资源与外壳同源，问题整体消失，同时 CSP 完全由自己掌控。

### 9.5 导出

- **HTML**：由 L3 渲染完整文档（含样式与插件 CSS），L2 通过预览服务取回图片/字体并 base64 内联，拼成单文件字符串，调用 `save_export` 落盘。**Rust 不参与 HTML 生成**——预览与导出共用同一段渲染代码，像素一致是结构性保证，而非靠对齐维护。
- **PDF**：Windows 走 WebView2 `ICoreWebView2_7::PrintToPdfAsync`，静默输出；其它平台降级为系统打印对话框。
- **PNG**：一期不做，预留。

### 9.6 明确不暴露的能力

- `read_file` / `write_file`（任意路径）
- `exec` / `spawn`（进程执行）
- `http_request`（通用代理；L3 插件需要的网络能力必须走独立、可审计的 `net_fetch` 命令并受域名白名单约束，一期不实现）

---

## 10. 存储

| 文件 | 位置 | 内容 |
|---|---|---|
| `settings.json` | `<appdata>/GoldenEdit/` | 主题、插件启停与配置、最近 vault、导出默认项 |
| `ui-state.json` | `<appdata>/GoldenEdit/` | 按 `vaultId + relPath` 记忆分栏比例、预览收起状态、滚动位置 |
| 插件 | `<appdata>/GoldenEdit/plugins/<id>/` | 用户安装的插件 |

**禁止向用户文档目录写入任何隐藏文件**（`.goldenedit/` 仅在用户显式开启「项目级插件」时创建）。

---

## 11. 安全模型

| 威胁 | 防线 |
|---|---|
| 第三方插件读取任意文件 | 插件运行于 opaque origin，无 IPC；资源仅能通过带 token 的 `/asset` 取，且限制在 vault 内 |
| 第三方插件外发文档内容 | CSP 禁止 `connect-src`；`fetch` 不可用；L3 级网络请求需显式授权并走可审计命令 |
| 文档内嵌 `<script>` | 预览外壳不执行文档内脚本（渲染结果中 `<script>` 被剥离），沙箱本身亦无同源权限 |
| 路径穿越 | 统一 `resolve_in_vault`，符号链接解析后校验 |
| 预览 iframe 反向控制宿主 | `postMessage` 双向校验 `event.origin === previewOrigin`；只接受白名单消息类型 |
| 导出的 HTML 携带恶意脚本 | 导出时剥离 `<script>`，保留 `<style>` 与内联 SVG |

---

## 12. 一致性检查清单

提交前逐条对照：

- [ ] 新增 / 修改的插件能力是否已在 5.5 更新类型定义？
- [ ] 新增的 Rust 命令是否已在 9.1 登记，并经过 `paths::resolve_in_vault`？
- [ ] 是否引入任何 `frontend/src` 下除 `bridge/` 外的 Tauri API 依赖？
- [ ] 插件是否硬编码了颜色？（应使用 `--ge-*`）
- [ ] 新的渲染块是否带 `data-line` 且由管线包裹？
- [ ] 是否新增了「整页白屏」的可能路径？
- [ ] `Features.md` / `ChangeLog.md` 是否同步？
- [ ] 架构层面的改动是否先更新了本文？

---

## 13. 已知风险与验证方式

| 风险 | 验证方式 | 处置 |
|---|---|---|
| 预览 iframe 与外层 postMessage 时序错乱 | 冷启动、快速切换文件、插件重载三种场景压测 | 用 `gen` 代际号 + `ready` 握手 |
| Monaco worker 被 CSP 拦截 | Tauri 打包后首启检查控制台 | 放行 `worker-src blob:` |
| 大文件渲染卡顿 | 准备 200KB / 2MB / 8MB 三份样本 | 按 6.4 阈值降级 |
| PDF 分页样式不可控 | 导出含代码块、表格、长图的样本 | 用 `@page` 控制纸张与边距；页码后置 |
| 插件在 Worker 与主线程行为不一致 | 内置插件全部跑双环境 | 强制 `ctx.scope` 分支约定 |

---

## 14. 迁移映射（自 Wails 版）

旧实现已归档为 `GoldenEdit.7z`，不作为运行依赖。可复用的部分：

| 旧资产 | 去向 |
|---|---|
| `frontend/src/editor/setup.ts` | 原样平移，补 `worker-src` CSP |
| `frontend/plugins/*/register.ts` | 按 5.5 契约改造（拆 L1 / L2，去掉 VSCode 专属逻辑） |
| `media/` 下 KaTeX 字体、Mermaid bundle | 随内置插件打包，经 `ctx.libs` 加载 |
| `internal/fs`、`internal/settings` | 用 Rust 重写，契约以 9.1 为准 |
| Wails 绑定与 `wailsjs/` | 废弃 |
