# GoldenEdit 功能清单

> 每条一句话。状态：✅ 已实现 / 🚧 开发中 / 📋 规划中 / 🗑 废弃。

## 核心编辑

- ✅ Monaco 编辑器，Markdown 语法高亮（🚧 脚手架阶段）
- 📋 左右分栏：左编辑暗色 / 右预览亮色（Obsidian 风格）
- 📋 三种布局切换：分栏 / 纯编辑 / 纯预览
- 📋 编辑行 ↔ 预览锚点滚动同步
- 📋 vault 文件树、多标签页、未保存标记、最近文件

## 预览渲染（插件化）

- 📋 markdown-it 渲染管线，插件按围栏/容器/定界符触发
- 📋 callout：Obsidian `> [!NOTE]` 提示框 + 旧 `!!!note` 语法
- 📋 heading-number：标题多级编号 1.1.1 + TOC 目录
- 📋 mermaid：```mermaid 图表（主题/曲线/配色可配）
- 📋 codebar：代码块工具条 + 复制按钮 + 行内代码强调
- 📋 katex：`$...$` / `$$...$$` 公式
- 📋 table-gfm：GFM 表格
- 📋 dialogue：`::: dialogue` 对白容器
- 📋 插件设置页：勾选启停、按 manifest.config 自动生成配置表单
- 📋 第三方插件目录：丢 JS/CSS 文件夹即可启用

## 主题与外观

- 📋 编辑区暗色 / 预览区亮色，两区主题独立
- 📋 预览自定义 CSS 皮肤

## 导出

- 📋 单文件 HTML 导出（内联 CSS）
- 📋 PDF 导出（webview print）

## 二期（契约预留，未实现）

- 🗑 云同步（GitHub/Drive/OneDrive）— 接口预留
- 🗑 多人实时协作 — 接口预留
- 🗑 Vim/Emacs 键位 — Monaco 扩展点预留
- 🗑 DOCX / EPUB / LaTeX 导出 — Exporter 接口预留
