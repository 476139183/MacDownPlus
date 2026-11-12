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

- 13 项 Rust 核心测试通过；另有 3 项应用启动/关闭/退出状态单测通过。
- 11 项 Playwright 页面交互测试通过，其中一项覆盖 21 种格式菜单。
- 原生 arm64 应用自检通过：WKWebView、文件保存、Prism、Mermaid、Graphviz、原生插件公开协议。
- 长文 PDF 导出为 7 页，纸张 595 × 842 pt，末尾 `END OF DOCUMENT` 可从 PDFKit 提取。
- APP 和 DMG 均已生成；未配置 Developer ID 或 Apple 公证。

真实结果：[native-smoke.json](native-smoke.json)。浏览器 UA 出于 WebKit 兼容性显示 Intel 字样，CPU 架构以 Mach-O `file` 检查为准。


## 0.1.1：2026-11-12 架构回归

- 应用、仓库、本地目录和 CLI 名称统一为 MacDownPlus/macdownplus，保留配置身份。
- LaunchServices 冷启动/热启动打开中文及空格路径通过；用户实际文档只读测试，内容摘要不变。
- 11 项页面测试通过，包括保存期间新输入、重叠 Copy HTML、预览换代和 Preferences 全局菜单。
- 3 项应用状态测试与 13 项核心测试通过。
- 真实 arm64 应用验证恢复、回退及草稿清理；7 页 A4 PDF 及文末完整性、插件公开协议、打印临时文件清理均通过。
- app 完整本地 ad-hoc 签名并校验；未进行 Developer ID 签名或 Apple 公证。
- 深度 review 结论：[架构审查报告](../reviews/2026-11-12-architecture-review.md)。


## 0.1.2：2026-11-12 系统语言复查

发现并修复原版已有的系统语言跟随缺口。语言按 macOS AppleLanguages（包含应用专用语言设置）首选顺序选择，无法支持时回退英语；重启应用生效。保持菜单动作 ID、偏好字段和值、用户文档内容不变。

- 复用固定上游版本的 25 种语言 `.strings`；原始文件保留在 `third-party/macdown/Localization`，来源见 [localization-provenance.json](localization-provenance.json)。简繁中文补齐新界面的常用文案；其他语言的新增文案仍可能回退英文。
- `python3 scripts/generate-locales.py` 从本地原始资源离线生成 `src/locales` 和 Info.plist，打包时 Rust 和前端共用同一份目录。
- 18 项 Rust 测试通过，含语言选择、中文区域/繁简、原菜单身份保持；13 项页面测试通过，含简繁中文偏好、保存/取消与原文保护。
- 真实 LaunchServices 冷/热启动报告确认本机系统简体中文：原生菜单为“编辑”，WebKit 页面语言为 `zh-Hans`。
- 0.1.2 原生自检确认草稿恢复、保存/回退、Prism/Mermaid/Graphviz、7 页 A4 PDF 文末内容和插件协议通过。

本项不等于所有原版功能已对齐。系统拼写/语法/文本替换、系统服务、真实打印机与不同 macOS/M4 设备等仍按上面的待办执行，不能仅依据菜单存在判为一致。


## 0.1.3：2026-11-12 颜色与格式预览

- 格式菜单与工具栏新增文字颜色、背景颜色、清除颜色，左侧设置后主动更新右侧，包括手动渲染模式下执行格式命令。
- 支持局部改色/清除、文字色和背景色组合、撤销；标题与多段落保留原有 Markdown 结构。
- 颜色以 HTML span 保存在 Markdown 中，HTML/PDF 共用预览；渲染器只接受 span 的十六进制 color/background-color，其余样式、事件与资源请求不放开。
- 删除线默认开启；删除线、下划线和高亮按钮会启用对应解析选项，避免只插入标记而预览仍显示原文。明确保存的用户偏好不自动重置。
- 19 项 Rust 测试、17 项页面测试通过；真实 arm64 WebKit 自检确认颜色样式、文档保存/恢复、7 页 A4 PDF 及插件协议通过。
- 参考方案与行为变化见 [设计记录](../plans/2026-11-12-inline-colors-design.md)。新增功能不代表原版全部功能已完成等效验收。


## 0.1.4：2026-11-12 下划线选区边界

截图问题已复现：整段选择包含回车/空行时，旧命令生成 `_文字。\n\n_`，结束标记落在独立空行，Hoedown 正确地将其保留为原文。

修复统一行内命令：排除选区首尾空白，每个非空行分别包裹，原有空行/换行保留；多行已设置格式时可再次取消。对旧版生成的独立结束标记，完整选中错误段落重新应用可修复。

21 项页面回归通过，覆盖全角空格、中文段尾、空行、多段落、再次取消、旧错误标记修复，以及原有颜色/撤销/导出/保存。真实原生验证记录见 native-smoke.json。不自动改写用户已有文档。
