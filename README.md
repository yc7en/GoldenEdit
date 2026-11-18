# GoldenEdit



![Version](https://img.shields.io/badge/version-0.8.5-blue)



![Tauri](https://img.shields.io/badge/tauri-2-green)



![TypeScript](https://img.shields.io/badge/typescript-5.6-blue)



![Rust](https://img.shields.io/badge/rust-1.77+-orange)



![app-icon](app-icon.png)

> 把 Markdown 当源码，把预览当可插拔的渲染目标。

Rust + Tauri 2 桌面 Markdown / HTML 编辑器，本地优先、离线可用，预览渲染可插拔：外挂 JS/CSS 插件目录，勾选即启用，不重新打包。新增一种内容的渲染方式，只需要丢一个插件目录进去。

## 功能概览



* **编辑**：Monaco 编辑器，明暗双主题；手动保存与未保存标记、崩溃草稿恢复、外部改动冲突提示、命令面板（`Ctrl+Shift+P`）、行内格式开关快捷键。

* **预览**：markdown-it 管线，独立源 iframe 沙箱；KaTeX 公式、highlight.js 代码高亮、提示框双语法、块级跳转、双向同步滚动、错误卡片降级。

* **插件体系**：目录式安装、卡片管理页与配置表单、四级能力标注、热重载、渲染诊断；内置提示框、表格增强、标题编号、Mermaid、思维导图（markmap）、KaTeX、代码块工具条、对白容器、排版美化、乐谱。

* **主题外观**：跟随系统 / 写作模式 / 全亮 / 全暗四档预设，编辑器与预览可分别指定；配色走 `--ge-*` 变量，支持自定义预览 CSS。

* **导出**：单文件 HTML 与 PDF（Windows），导出复用同一套预览渲染 DOM 与样式，与预览像素一致。

* **性能**：块级增量重建、首屏限量、输入防抖与代际取消、Worker 渲染、大文档分级降级。

* **文件与项目**：文件夹即 vault、文件树懒加载、文件系统监听、最近项目、拖入 / 命令行 / 文件关联多入口打开。

完整清单见 [docs/Features.md](docs/Features.md)；用户可感知的变更记录见 [docs/ChangeLog.md](docs/ChangeLog.md)。

## 技术栈



| 层       | 技术                                                     |
| ------- | ------------------------------------------------------ |
| 桌面壳     | Rust · Tauri 2（`src-tauri/`）                           |
| 前端      | TypeScript · Vite 5 · Monaco Editor · markdown-it      |
| 渲染依赖    | highlight.js · KaTeX · markmap · abcjs · Pele（Mermaid） |
| 测试 / 检查 | Vitest · ESLint · `check:boundary` 边界脚本                |

## 环境要求



* Node.js 18+（CI 使用 22）

* Rust stable（MSRV 1.77）

* 系统 WebView：Windows 10/11 自带 WebView2；macOS 13+ 自带 WKWebView

## 开发



```
npm install          # 一次即可，前端与 Tauri CLI 都在根目录
npm run dev         # 只起前端（Vite，1420 端口，strictPort）
npm run tauri dev   # 起桌面壳
```

其他脚本：



| 命令                                            | 作用                                            |
| --------------------------------------------- | --------------------------------------------- |
| `npm run build`                               | 清理后构建主页面 + 预览外壳（`build:ui` / `build:preview`） |
| `npm run typecheck`                           | `tsc --noEmit`                                |
| `npm run lint`                                | ESLint 检查                                     |
| `npm run check:boundary`                      | 前端桥接边界检查                                      |
| `npm run test`                                | Vitest 单测                                     |
| `npm run perf:samples` / `npm run perf:check` | 生成性能样本、按阈值验收                                  |
| `npm run clean`                               | 清理旧构建产物                                       |

## 构建安装包



```
npm run tauri build                  # 出本平台安装包
npm run tauri build -- --no-bundle   # 只编二进制，开发期验证用
```



| 平台               | 产物                              | 说明                                                                                         |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| Windows          | `NSIS` `.exe` + `WiX` `.msi`    | 本地可直接构建；MSI 配 `zh-CN` 代码页（`tauri.conf.json`）                                               |
| macOS            | `.app` + `.dmg`                 | **只能在 macOS 上构建**（dmg 依赖 `hdiutil`，链接依赖 Xcode SDK），打包目标在 `src-tauri/tauri.macos.conf.json` |
| macOS（universal） | `GoldenEdit_<版本>_universal.dmg` | 由 GitHub Actions `macos-15` 任务产出，见 `.github/workflows/build.yml`                           |

产物未签名、未公证：自编自用可用，分发到他人机器会被 Gatekeeper 拦。

## 持续集成

`.github/workflows/build.yml` 双平台并行构建：



* 触发：主干 `main` 提交、版本标签 `GoldenEdit/v*`、手动 `workflow_dispatch`。

* `macos-15` 出 universal dmg；`windows-latest` 出 NSIS / MSI。

* 只有版本标签才由独立 `release` job 汇总两个平台产物发 Release；主干提交与手动触发只出 artifact。

## 项目结构



```
GoldenEdit/
├── frontend/                  # 前端（Vite + TypeScript）
│   ├── src/                   # 主页面：editor / preview / commands / plugins / settings / ui …
│   ├── preview-shell/         # 预览外壳：独立 iframe 源，pipeline / blocks / protocol / Worker
│   ├── shared/               # 编辑区与预览共用的高亮注册表等
│   └── plugins/              # 内置插件（callout / katex / mermaid / markmap / score / …）
├── src-tauri/                 # Rust 桌面壳（Tauri 2）
│   └── src/                 # commands、文件监听、预览本地服务、JSON 存储、路径守卫
├── scripts/                   # 构建清理、桥接边界检查、性能样本与验收
├── docs/                      # 对外文档：Features.md / ChangeLog.md / demo.md
├── design/prototype/         # 浏览器直接打开的界面原型
├── .github/workflows/        # 双平台 CI 构建
├── dist/  dist-preview/      # 构建产物（gitignore）
└── GoldenEdit.7z             # 旧 Go + Wails 实现归档，不作为构建依赖
```

> 根目录 
>
> `plugins/`
>
>  是指向 
>
> `frontend/plugins/`
>
>  的 junction，已在 
>
> `.gitignore`
>
>  中忽略。

## 文档双轨制

文档分两条轨道：



* **内部文档**在统一文档仓库的 `GoldenEdit/` 子目录（相对本仓库 `../docs-local/GoldenEdit/`）。多项目共用一个私有仓库，不在本仓库内；本仓库只留一个 `docs-local.lnk` 快捷方式。改任何东西之前，先读治理规则。

* **对外文档**在本仓库 `docs/`，只在发版时从内部版汇总生成。

> 内部文档在另一个仓库，GitHub 上点不开。本地要求两个仓库放在
>
> **同一父目录**
>
> （本仓库 
>
> `GoldenEdit/`
>
>  与文档仓库 
>
> `docs-local/`
>
>  同级），用上面的相对路径或快捷方式打开。本文不写绝对路径：换台没有同盘符的电脑，文档照样能读。



| 文件                                                                                         | 内容                                             |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| [../docs-local/GoldenEdit/README.md](../docs-local/GoldenEdit/README.md)                   | **规则入口**。分层、强制规则、计划先行、编号与模板。任何变更先按这里判定要改哪些文档。  |
| [../docs-local/GoldenEdit/ARCHITECTURE.md](../docs-local/GoldenEdit/ARCHITECTURE.md)       | **软件设计契约**。实现必须与之一致，改架构先改契约。                   |
| [../docs-local/GoldenEdit/PLAN.md](../docs-local/GoldenEdit/PLAN.md)                       | 计划层。**架构变更必须先在本文列包**（范围 / 验收 / 回滚），再改契约，最后写代码。 |
| [../docs-local/GoldenEdit/Features-local.md](../docs-local/GoldenEdit/Features-local.md)   | 功能清单内部版，每条带稳定 ID，附状态变更记录。                      |
| [../docs-local/GoldenEdit/ChangeLog-local.md](../docs-local/GoldenEdit/ChangeLog-local.md) | 变更记录内部版，只追加，不改历史。                              |
| [功能清单](docs/Features.md)                                                                   | 对外版，随版本发布生成。                                   |
| [变更记录](docs/ChangeLog.md)                                                                  | 对外版，日期 + 版本号。                                  |
| [原型](design/prototype/index.html)                                                          | 主界面 / 插件管理 / 导出对话框，浏览器直接打开。                    |

## 已知平台差异



* **PDF 导出只在 Windows 可用**：走系统打印对话框（`window.print()`）。macOS 的 WKWebView 不实现该 API，导出对话框会把 PDF 置灰，请改用单文件 HTML。

* `⌘W`**&#x20;是关闭窗口**（系统菜单 accelerator），关闭标签在 macOS 用 `⌘⇧W`。

* 关闭窗口即退出进程（单窗口模型），不留无窗口实例。

## 状态

版本 0.8.5。平台：Windows 10/11（WebView2）与 macOS 13+（WKWebView）。旧 Go + Wails 实现已归档为 `GoldenEdit.7z`，不作为构建依赖。

## Contributing



* 架构变更先走内部文档链：`PLAN.md` 列包 → `ARCHITECTURE.md` 改契约 → 再写代码。

* 提交信息沿用 Conventional Commits 前缀：`feat` / `fix` / `docs` / `refactor` / `test` / `chore`，范围用括号标注（如 `feat(plugin): …`、`fix(shell): …`）。

* 提交前本地至少跑通 `npm run typecheck`、`npm run lint`、`npm run test`。

## Security



* 应用本地优先、离线可用；预览运行在独立源 iframe 内，不可编辑、不执行文档内脚本。

* 插件按能力分级标注（L0 纯样式 / L1 纯渲染 / L2 操作 DOM / L3 需网络或本地程序），安装前可见；L3 能力需自行评估风险。

* 发现安全问题请在仓库 Issue 中描述影响范围与复现步骤，或直接联系作者。

## License

本仓库未随附 LICENSE 文件，当前为自编自用；分发前请补充明确的开源协议或保留所有权利声明。

## Author

Leo · [yc7en](https://github.com/yc7en)