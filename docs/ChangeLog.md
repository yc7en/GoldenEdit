# GoldenEdit ChangeLog

## 2026-10-27

- **BugFix-261027-0001** 修复 wails build 前端编译错误（插件路径/默认导出/编码/monaco worker），成功产出 `GoldenEdit.exe`（10.2MB）。
- **R-261027-0005** vault 文件树/多标签 + 设置面板（插件勾选与 config 表单自动生成）。
- **R-261027-0004** Monaco 暗色编辑器 + 三布局切换 + 预览区亮暗独立切换。
- **R-261027-0003** 前端插件运行时 + 迁移 7 个内置插件（callout/heading-number/mermaid/codebar/katex/table-gfm/dialogue）。
- **R-261027-0002** Go 后端服务层：vault 文件树扫描、文件读写、设置 JSON 持久化、HTML/PDF 导出、原生对话框。
- **R-261027-0001** 初始化项目骨架：Go + Wails v2 + Vite/TS 前端，建立 internal/frontend/plugins 目录结构，落地架构设计文档与插件契约。（架构变更）
