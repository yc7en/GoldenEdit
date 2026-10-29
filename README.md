# GoldenEdit

Rust + Tauri 2 桌面 Markdown / HTML 编辑器。本地优先、离线可用、**预览渲染可插拔**（外挂 JS/CSS 插件，勾选即启用）。

把 Markdown 当源码，把预览当可插拔的渲染目标 —— 新增一种内容的渲染方式，只需要丢一个插件目录进去，不重新打包。

## 文档

文档分两条轨道：

- **内部文档**在统一文档仓库的 `GoldenEdit/` 子目录（相对本仓库 `../docs-local/GoldenEdit/`）。多项目共用一个私有仓库，不在本仓库内；本仓库只留一个 `docs-local.lnk` 快捷方式。改任何东西之前，先读治理规则。
- **对外文档**在本仓库 `docs/`，只在发版时从内部版汇总生成。

> 内部文档在另一个仓库，GitHub 上点不开。本地要求两个仓库放在**同一父目录**（本仓库 `GoldenEdit/` 与文档仓库 `docs-local/` 同级），用上面的相对路径或快捷方式打开。
> 本文不写绝对路径：换台没有同盘符的电脑，文档照样能读。

| 文件 | 内容 |
|---|---|
| [`../docs-local/GoldenEdit/README.md`](../docs-local/GoldenEdit/README.md) | **规则入口**。分层、强制规则、计划先行、编号与模板。任何变更先按这里判定要改哪些文档。 |
| [`../docs-local/GoldenEdit/ARCHITECTURE.md`](../docs-local/GoldenEdit/ARCHITECTURE.md) | **软件设计契约**。实现必须与之一致，改架构先改契约。 |
| [`../docs-local/GoldenEdit/PLAN.md`](../docs-local/GoldenEdit/PLAN.md) | 计划层。**架构变更必须先在本文列包**（范围 / 验收 / 回滚），再改契约，最后写代码。 |
| [`../docs-local/GoldenEdit/Features-local.md`](../docs-local/GoldenEdit/Features-local.md) | 功能清单内部版，每条带稳定 ID，附状态变更记录。 |
| [`../docs-local/GoldenEdit/ChangeLog-local.md`](../docs-local/GoldenEdit/ChangeLog-local.md) | 变更记录内部版，只追加，不改历史。 |
| [功能清单](docs/Features.md) | 对外版，随版本发布生成。 |
| [变更记录](docs/ChangeLog.md) | 对外版，日期 + 版本号。 |
| [原型](design/prototype/index.html) | 主界面 / 插件管理 / 导出对话框，浏览器直接打开。 |

## 状态

版本 0.5.0。旧 Go + Wails 实现已归档为 `GoldenEdit.7z`，不作为构建依赖。

## 开发

```bash
# 前端
cd frontend && npm install && npm run dev

# 桌面壳
cargo tauri dev
```

需要 Node 18+、Rust stable、WebView2（Windows 10/11 自带）。
