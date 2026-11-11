# MacDown 功能兼容清单

目标是对齐 MacDown 的完整功能范围，不以少量编辑功能作为完成标准。基线：MacDown master `3e2a2bf101c215c143bf00d9f857965f0ee82487`，详见 [原始菜单与偏好基线](baseline.json)。

| 功能组 | 实现入口 | 验证状态 |
|---|---|---|
| 原版 Markdown 扩展、公式标记、TOC、YAML、任务列表 | Hoedown 3.0.7 + 原版补丁 / Rust core | 核心测试通过 |
| 原子保存、外部修改保护、Unicode、CRLF | DocumentSession | 核心测试通过 |
| 原生文件菜单、多窗口、最近文档、文件关联、拖放 | src-tauri/src/lib.rs | 已接入；对话框/Finder 交互仍需人工逐项验收 |
| 格式、分栏、查找替换、手动渲染、同步滚动、主题、字数 | CodeMirror / src/main.ts | 21 种格式菜单、分栏与手动渲染交互测试通过；系统快捷键仍需人工复核 |
| Prism / Mermaid / Graphviz | 原版 vendored 资源 / sandbox preview | 浏览器交互测试通过；原生结果另见 native-smoke.json |
| 五组偏好设置 | src/preferences.ts | 分组及渲染开关保存测试通过 |
| HTML 导出与样式选项 | iframe snapshot + Rust 原生保存 | 页面交互测试通过 |
| PDF、打印、页面设置 | WKWebView / NSPrintOperation | PDF 已通过真实 WKWebView 长文自检：7 页 A4、末尾正文完整；真实打印机未验证 |
| 拼写、语法、替换、系统服务 | WebKit 编辑响应链 / NSApplication | 已转发系统入口，尚未完成原版等效性实测 |
| 终端启动、stdin、草稿恢复 | Rust 生命周期与命令行 | 已接入；恢复草稿、重命名清理和别名路径冲突保护由原生与核心测试覆盖；多实例 stdin 仍需终端人工复核 |
| 用户主题、CSS、Handlebars 模板 | 配置目录资源 + handlebars | 已接入；模板错误会明确返回 |
| 原生插件公开协议 | NSBundle / principalClass / init / plugInDidInitialize / run: | arm64 测试 bundle 的 init / plugInDidInitialize / run: 已通过；第三方真实插件和 Intel-only 插件另行验证 |
| 检查更新、帮助、关于、鸣谢 | GitHub releases / 本地帮助文档 | 已接入；没有公开 Release 时明确显示尚无发布版本 |

## 明确差异与待办

- 本地图片已补齐相对路径、父目录、绝对路径和 file URL；其他本地嵌入媒体类型尚未逐项核验。
- 原生插件基于公开协议，不承诺兼容依赖 MacDown 私有 Objective-C 文档类的插件。
- 字体设置、偏好窗口、格式工具栏采用新 UI 组件，尚未逐像素比对原版原生控件。
- WKWebView 的拼写/替换系统响应链与 CodeMirror 组合需要逐项核验；仅存在菜单不算验证通过。
- MacDown 使用旧 Sparkle 更新链路；新应用改查自己的 GitHub Releases，不使用上游签名或更新源。
- 本机硬件为 Apple M3 Pro，系统为 macOS 27.0。构建目标为 arm64，适用于 M4 架构；尚未在 M4 硬件和 macOS 13/14/15 各版本上实测。
- 构建为本地 ad-hoc 签名，不含 Developer ID 与公证。

只有待办与原生人工验收收敛后，才可宣称完整兼容。当前测试通过项不代表整个原版功能已全部验收。


## 已执行验证

2026-11-11，本机 Apple M3 Pro / macOS 27.0：

- 13 项 Rust 核心测试通过。
- 7 项 Playwright 页面交互测试通过，其中一项覆盖 21 种格式菜单。
- 原生 arm64 应用自检通过：WKWebView、文件保存、Prism、Mermaid、Graphviz、原生插件公开协议。
- 长文 PDF 导出为 7 页，纸张 595 × 842 pt，末尾 `END OF DOCUMENT` 可从 PDFKit 提取。
- APP 和 DMG 均已生成；未配置 Developer ID 或 Apple 公证。

真实结果：[native-smoke.json](native-smoke.json)。浏览器 UA 出于 WebKit 兼容性显示 Intel 字样，CPU 架构以 Mach-O `file` 检查为准。
