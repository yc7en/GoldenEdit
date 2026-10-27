# GoldenEdit 架构设计

> Go + Wails v2 桌面 Markdown / HTML 编辑器。
> 本地优先、离线可用、预览渲染可插拔（JS/CSS 插件，勾选即启用）。
> Obsidian 兼容（读写本地 .md 库），左编辑暗色 / 右预览亮色分栏。

---

## 1. 设计目标

| 目标 | 说明 |
|---|---|
| 本地优先 | 不登录、不联网也能用；文件就是磁盘上的 .md，不入库 |
| 插件化预览 | 新增渲染格式 = 丢一个 JS/CSS 插件包，设置页勾选启用；不改 Go、不重打包 |
| 代码块触发 | ```mermaid / ```latex 等围栏语言名决定走哪个插件渲染 |
| 暗色编辑 / 亮色预览 | 编辑区与预览区主题独立，默认左黑右白（Obsidian 分栏观感） |
| 二期契约预留 | 云同步、协作、Vim/Emacs、DOCX/EPUB 只留接口，不实现 |

---

## 2. 总体分层

```
┌─────────────────────────────────────────────────────────┐
│                    Wails 窗口 (WebView2)                  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  frontend SPA (TS + Vite)                          │  │
│  │  ┌──────────┐  ┌─────────────┐  ┌────────────────┐ │  │
│  │  │  Monaco  │  │  Preview    │  │  Settings/UI   │ │  │
│  │  │  编辑器   │←→│  渲染管线   │←→│  插件勾选面板  │ │  │
│  │  └──────────┘  └──────┬──────┘  └───────┬────────┘ │  │
│  │                        │                   │          │  │
│  │              ┌─────────▼─────────────────▼───────┐   │  │
│  │              │  Plugin Loader / Registry         │   │  │
│  │              │  (markdown-it 规则 + 生命周期钩子)│   │  │
│  │              └─────────▲─────────────────────────┘   │  │
│  └────────────────────────│───────────────────────────┘  │
└──────────────────────────┼───────────────────────────────┘
                            │ Wails Bind (TS <-> Go)
┌────────────────────────────┼───────────────────────────────┐
│  Go Backend                ▼                               │
│  internal/fs     读文件、vault 扫描、watcher、最近文件     │
│  internal/settings  设置持久化 (appdata JSON)              │
│  internal/export    HTML 单文件 / PDF (webview print)     │
│  internal/platform  原生对话框、托盘、打开外部程序          │
│  internal/sync      [二期] SyncProvider 接口 (空实现)      │
│  internal/collab    [二期] 协作接口 (空实现)               │
└────────────────────────────────────────────────────────────┘
```

**关键决策：Markdown→HTML 在前端做，不在 Go 做。**
理由：插件是 JS/CSS，`markdown-it` 的 fenced code block 渲染规则就是插件天然的挂载点；Go 端只做文件 IO 和系统集成，保持瘦后端。Go 不碰 markdown 语法树。

---

## 3. 目录结构

```
GoldenEdit/
├── go.mod
├── main.go                  # Wails 入口
├── app.go                   # App 结构，Bind 各 service
├── wails.json
├── internal/
│   ├── fs/                  # 文件层
│   │   ├── vault.go         # 打开 vault、列目录树
│   │   ├── watcher.go       # 文件变更监听（外部改动同步回编辑器）
│   │   ├── recent.go        # 最近文件/最近 vault
│   │   └── doc.go
│   ├── settings/            # 设置读写
│   │   └── settings.go      # settings.json 模型 + 默认值
│   ├── export/
│   │   ├── exporter.go       # Exporter 接口（二期扩展点）
│   │   ├── html.go           # 单文件 HTML 导出
│   │   └── pdf.go            # 调 webview print-to-pdf
│   ├── platform/
│   │   ├── dialog.go         # 打开/保存文件、选 vault 目录
│   │   └── shell.go          # 打开外部链接/文件夹
│   ├── sync/                # [二期] 接口，不实现
│   │   └── provider.go      # type Provider interface {...}
│   └── collab/              # [二期] 接口，不实现
│       └── session.go
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.ts
│   │   ├── editor/          # Monaco
│   │   │   ├── setup.ts     # 实例化、暗主题、键位
│   │   │   └── theme.ts     # "Golden Dark" 自定义主题
│   │   ├── preview/         # 预览区
│   │   │   ├── pipeline.ts  # markdown-it 实例 + 插件装配
│   │   │   ├── renderer.ts  # HTML 注入预览容器
│   │   │   └── scrollsync.ts # 编辑行↔预览锚点对齐
│   │   ├── plugins/         # 插件运行时
│   │   │   ├── types.ts     # PluginManifest / PluginContext
│   │   │   ├── manager.ts   # 扫描、加载、启停
│   │   │   └── sandbox.ts   # 插件沙箱（隔离用户贴的 HTML）
│   │   ├── theme/           # 主题引擎
│   │   │   ├── editor.css   # 暗色编辑区
│   │   │   └── preview.css  # 亮色预览区（独立作用域）
│   │   ├── vault/           # 文件树、多标签
│   │   ├── settings/        # 设置面板（插件勾选表）
│   │   └── wails-bindings/  # Wails 生成的 TS client
│   └── plugins/             # 内置插件（随包发布）
│       ├── callout/         # Obsidian > [!NOTE] + 旧 !!!note
│       ├── heading-number/   # 标题多级编号 + TOC
│       ├── mermaid/         # ```mermaid 图表
│       ├── codebar/         # 代码块工具条/复制/行内代码
│       ├── katex/           # $...$ 公式
│       ├── table-gfm/       # GFM 表格
│       └── dialogue/        # ::: dialogue 对白容器
└── docs/
    └── ARCHITECTURE.md
```

用户第三方插件不落仓库，落在：
`%AppData%/GoldenEdit/plugins/<plugin-id>/`，启动时与内置插件合并扫描。

---

## 4. 插件契约（核心）

### 4.1 插件包结构

```
plugins/mermaid/
├── manifest.json
├── renderer.js        # 入口，暴露 register()
└── style.css          # 插件样式（可选）
```

### 4.2 manifest.json

```json
{
  "id": "mermaid",
  "name": "Mermaid 图表",
  "version": "1.0.0",
  "match": {
    "fence": ["mermaid", "mmd", "flowchart"]
  },
  "entry": "renderer.js",
  "style": "style.css",
  "config": {
    "theme": { "type": "select", "default": "auto",
               "options": ["auto","default","dark","forest","neutral","base"] },
    "curve": { "type": "select", "default": "basis",
               "options": ["basis","linear","step","natural","monotoneX"] },
    "palette": { "type": "select", "default": "default",
                 "options": ["default","mono"] },
    "securityLevel": { "type": "select", "default": "strict",
                       "options": ["strict","loose","antiscript"] }
  }
}
```

字段说明：
- `match`：触发方式，**三种可组合**（迁移自现有两个 VSCode 插件的实际触发形式）：
  - `fence`：围栏语言名命中，如 `["mermaid"]`（对应 ```mermaid）
  - `container`：`::: name ... :::` 容器名命中，如 `["dialogue"]`（迁移自 vscode-dialogue）
  - `delimiter`：行内/块级定界符，如 `{"inline": "$...$", "block": "$$...$$"}`（迁移自 latex 插件）
- `entry`：JS 入口，必须导出 `register(md, ctx)`。
- `style`：插件样式（可选）。
- `config`：插件自有设置项；设置页按 schema 自动生成表单，用户改完持久化。schema 类型：`boolean / select / number / string`。

### 4.3 renderer.js 约定

```js
// markdown-it 实例 + 上下文
export function register(md, ctx) {
  // 方式一：替换围栏渲染规则（同步、简单插件用这个）
  md.renderer.rules.fence = wrapFence(md.renderer.rules.fence, (info, code) => {
    if (info === 'mermaid') {
      return `<div class="ge-mermaid" data-code="${escape(code)}"></div>`;
    }
  });

  // 方式二：挂载后异步渲染（需要 canvas/SVG 初始化的用这个）
  ctx.onMount('.ge-mermaid', async (el, code, config) => {
    const { svg } = await ctx.libs.mermaid.render(el.id, code, config);
    el.innerHTML = svg;
  });
}
```

`ctx` 提供的能力（一期冻结）：
- `ctx.libs`：插件共享的库句柄（mermaid、katex 等重库只加载一次）
- `ctx.onMount(selector, fn)`：预览 DOM 更新后，对匹配节点执行挂载
- `ctx.config`：当前插件配置
- `ctx.bus`：事件总线（文档切换、主题切换通知插件）

### 4.4 插件生命周期

```
启动 → 扫描内置 + 用户目录
     → 读 manifest，校验 id/version/match
     → 按设置页勾选状态决定启用
     → 对启用插件：加载 style.css、执行 renderer.js 的 register(md, ctx)
     → markdown-it 管线装配完成
编辑输入 → markdown-it 转 HTML → 注入预览容器
       → ctx.onMount 钩子对特殊节点做异步渲染
```

### 4.5 安全

- 第三方插件 JS 有风险：预览用户贴的 HTML 时用 iframe 沙箱（`sandbox="allow-scripts"`）隔离。
- 插件默认**不能**直接调 Go 绑定；需要文件/系统能力时走显式白名单 API（二期再扩）。

---

## 5. 主题模型（左黑右白）

- 编辑区（Monaco）：独立 dark 主题 `Golden Dark`，CSS 作用域 `.ge-editor`。
- 预览区：独立 light 主题，CSS 作用域 `.ge-preview`，默认亮色排版。
- 两区主题**解耦**：用户可分别切换；设置里默认 `editor=dark, preview=light`。
- 预览区暗色只是切一个 class（`.ge-preview.dark`），不影响编辑区。
- 自定义 CSS：用户可在设置里追加自己的预览 CSS（Typora 式皮肤）。

---

## 6. 渲染管线细节

1. Monaco 内容变化 → 防抖 200ms → 交给 `pipeline.render(mdText)`。
2. `markdown-it`（已被所有启用插件注册过规则）输出 HTML 字符串。
3. 写入预览容器 `innerHTML`。
4. `ctx.onMount` 队列执行：mermaid/katex 这类异步渲染把占位 div 换成真实 SVG。
5. 滚动同步：编辑光标所在行 → 找预览中对应 `data-line` 锚点 → 滚动对齐。
6. 大文件（>500KB）：分片渲染 + 预览虚拟滚动，避免主线程卡死。

---

## 7. Go 端 Bind 接口（一期冻结）

前端通过 Wails 调的方法，一期只暴露这些：

| 方法 | 作用 |
|---|---|
| `fs.OpenVault(dir)` | 打开/注册一个 vault，返回目录树 |
| `fs.ListFiles(dir)` | 列 .md 文件 |
| `fs.ReadFile(path)` | 读文件内容 |
| `fs.WriteFile(path, content)` | 写回 |
| `fs.Watch(dir)` | 监听外部改动，推送事件给前端 |
| `fs.RecentVaults() / fs.AddRecent(...)` | 最近 vault |
| `settings.Get() / settings.Set(partial)` | 读写设置（含插件启停状态） |
| `export.HTML(path, out)` | 导出单文件 HTML |
| `export.PDF(path, out)` | 导出 PDF |
| `platform.PickVaultDir()` | 弹原生选目录对话框 |
| `platform.OpenExternal(url)` | 浏览器打开链接 |

二期接口（先建空文件，方法签名定好）：
- `sync.Provider`：`Pull(ctx) / Push(ctx) / WatchRemote(ctx)`
- `collab.Session`：`Join(docId) / Apply(op)`

---

## 8. 一期功能范围

**做：**
- Monaco 编辑 + 左右分栏 + 三种布局切换（分栏 / 纯编辑 / 纯预览）
- vault 文件树、多标签、未保存标记、最近文件
- markdown-it 基础渲染 + 内置 7 插件（全部从现有 VSCode 插件迁移）：
  代码块工具条/复制、KaTeX 公式、Mermaid 图表、Obsidian callout、标题编号+TOC、GFM 表格、对白容器(dialogue)
- 插件设置页（勾选启停、插件配置表单）
- 左黑右白主题，预览自定义 CSS
- HTML / PDF 导出
- 滚动同步

**不做（二期，仅留契约）：**
- 云同步（GitHub/Drive/OneDrive）
- 多人实时协作
- Vim/Emacs 键位（Monaco 扩展点已留）
- DOCX / EPUB / LaTeX 导出（`export.Exporter` 接口已留）

---

## 9. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 壳 | Wails v2 | Go 后端 + WebView2，单 exe |
| 编辑器 | Monaco | VSCode 内核，语法高亮/大纲白送 |
| Markdown | markdown-it（前端） | 插件规则挂载点天然 |
| 代码高亮 | Shiki（首版可用 highlight.js 降级） | 效果好 |
| 数学 | KaTeX | 对比页共识 |
| 图表 | Mermaid | 对比页里差异化点 |
| 构建 | Vite + TS | 前端 SPA 标准 |
| 设置 | appdata JSON | 简单可读 |

---

## 10. 待确认 / 风险

1. **Wails v2**：已定，一期用 v2。
2. **大文件**：>2MB 的 md 渲染性能要早做压测。
3. **插件热更新**：设置页勾选后是否需要重启窗口？建议一期"即时重载插件注册"，二期再做。

---

## 11. 现有项目迁移清单

两个 VSCode 插件的渲染逻辑直接迁成 GoldenEdit 内置插件。

### 11.1 来源：vscode-markdown-extended

| 现有文件 | GoldenEdit 插件目录 | 触发方式 | 说明 |
|---|---|---|---|
| `src/plugins/callout.js` + `callout-shared.js` | `frontend/plugins/callout/` | blockquote `> [!NOTE]` | Obsidian 风格提示框，含图标/中文标题/别名表 |
| `src/plugins/admonition.js` | 并入 callout 插件 | `!!!note{标题} ... !!!` | 旧语法，callout 插件内开关控制 |
| `src/plugins/heading.js` | `frontend/plugins/heading-number/` | 渲染所有 `#` 标题 | 多级编号 1.1.1 + 锚点 id |
| `src/plugins/mermaid.js` | `frontend/plugins/mermaid/` | fence `mermaid` | 解析期产占位 div，挂载期异步绘图 |
| `src/plugins/codeblock.js` | `frontend/plugins/codebar/` | fence + code_block + code_inline | 工具条/复制按钮/行内代码强调 |
| `src/plugins/latex.js` | `frontend/plugins/katex/` | delimiter `$...$` / `$$...$$` | markdown-it-texmath + KaTeX |
| `src/plugins/theme.js` | `frontend/src/theme/`（非插件） | 包装 md.render | 亮/暗配色接管 |
| `media/vendor/mermaid.min.js` | `frontend/plugins/mermaid/vendor/` | — | 3.5MB 运行时，复用 |
| `media/katex.min.css` + `media/fonts/*.woff2` | `frontend/plugins/katex/vendor/` | — | KaTeX 样式+字体，复用 |
| `media/preview.css` / `styles/markdown-theme.css` | `frontend/src/theme/preview.css` | — | 预览排版，迁到独立作用域 |

### 11.2 来源：vscode-dialogue

| 现有文件 | GoldenEdit 插件目录 | 触发方式 | 说明 |
|---|---|---|---|
| `src/md-plugin.js` | `frontend/plugins/dialogue/` | container `::: dialogue ... :::` | 零依赖 container 解析器，直接搬 |
| `src/dialogue.css` | `frontend/plugins/dialogue/style.css` | — | 左右分栏+树状批注样式 |
| `src/renderer.js` | 不迁 | — | VSCode webview 专用，GoldenEdit 用自己的 pipeline |

### 11.3 迁移注意点

- 现有插件用 CommonJS（`module.exports`），GoldenEdit 前端是 Vite + ESM，迁移时改成 `export function register(md, ctx)`。
- 现有配置读取是 `ctx.getOptions()` 惰性函数；GoldenEdit 改成 `ctx.config` 直接拿当前插件配置（设置页勾选时持久化）。
- 现有 mermaid 依赖 VSCode webview 注入的 `media/preview.js` 做异步绘图；GoldenEdit 把这部分并进 `ctx.onMount` 钩子。
- 现有 `readConfig()` 里的所有字段直接作为各插件 `manifest.config` schema 的初始值。
- 不迁移：`test/`、`scripts/`、`.vsix` 产物、`extension.js`（VSCode 入口）。
