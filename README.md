# GoldenEdit

Rust + Tauri 2 桌面 Markdown / HTML 编辑器。本地优先、离线可用、**预览渲染可插拔**（外挂 JS/CSS 插件，勾选即启用）。

把 Markdown 当源码，把预览当可插拔的渲染目标 —— 新增一种内容的渲染方式，只需要丢一个插件目录进去，不重新打包。

## 文档

| 文件 | 内容 |
|---|---|
| [架构设计](docs/ARCHITECTURE.md) | **软件设计契约**。实现必须与之一致，改架构先改本文。 |
| [功能清单](docs/Features.md) | 每条一句话，带状态标记。 |
| [变更记录](docs/ChangeLog.md) | 按时间倒序，架构变更单独标注。 |
| [开发计划](docs/PLAN.md) | 14 个工作包、6 个里程碑、关键路径与首批任务清单。 |
| [原型](design/prototype/index.html) | 主界面 / 插件管理 / 导出对话框，浏览器直接打开。 |

## 状态

架构基线阶段（0.1.0）。旧 Go + Wails 实现已归档为 `GoldenEdit.7z`，不作为构建依赖。

## 开发

```bash
# 前端
cd frontend && npm install && npm run dev

# 桌面壳
cargo tauri dev
```

需要 Node 18+、Rust stable、WebView2（Windows 10/11 自带）。
