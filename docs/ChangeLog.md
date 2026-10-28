# 变更记录

> 按时间倒序。架构层面的改动用 **架构变更** 标注；废弃与迁移必须写明去向。

## 0.1.0 · 2026-10-28

**架构变更**：整体由 Go + Wails v2 迁移到 Rust + Tauri 2；渲染管线从主页面迁入独立源的预览 iframe 沙箱；预览资源加载从自定义协议改为本地 HTTP 服务。

### 新增

- `docs/ARCHITECTURE.md`：建立软件设计契约，明确三层边界、插件契约、命令契约与安全模型。
- `docs/Features.md` / `docs/ChangeLog.md`：功能清单与变更流水，纳入提交约束。
- 插件契约：`register(md, ctx)`，`ctx` 收窄为 9 个成员，块包裹与 `data-line` 锚点由管线统一生成。
- 插件能力分级 L0–L3，按运行时访问记录判定，不采信作者自述。
- 渲染管线四层性能策略：块级 morphdom、分片渲染、防抖 + 代际取消、Worker 解析。
- 本地预览 HTTP 服务：`127.0.0.1:0` + 随机 token，服务外壳页、插件资源与 vault 图片。
- 预览交互：块左侧行号角标点击跳转源码，正文保持原生选区行为。
- 主题四档预设，编辑器与预览可独立设置；插件颜色强制走 `--ge-*` 变量。
- 导出：前端生成完整 HTML，Rust 仅负责落盘；Windows 下走 WebView2 `PrintToPdfAsync` 静默出 PDF。

### 变更

- 预览隔离方式：由「同 DOM + 样式作用域」改为「独立源 iframe + postMessage」。
- 资源加载：不再使用 `asset://` 自定义协议，统一走本地 HTTP。
- 插件启停：由「热替换 register」改为「重建预览 iframe」，消除残留状态。
- 分栏比例：由全局单一值改为按文件记忆，存于应用数据目录。
- 主题：由「左暗右亮固定」改为四档预设 + 独立设置。

### 废弃 / 迁移

- Go 后端（`app.go`、`embed.go`、`internal/`）→ 归档为 `GoldenEdit.7z`，不再维护。
- Wails 绑定与 `frontend/wailsjs/` → 移除，改由 `frontend/src/bridge/` 统一封装 Tauri API。
- `frontend/plugins/*/register.ts` 的 VSCode 专属实现 → 按新契约重写，仅保留语法解析与渲染逻辑。

关联记录：`R-261028-0001.md`
