# MacDownPlus 设计

## 1. 决策表
| ID | 决策点 | 候选 | 选定 | Why |
|---|---|---|---|---|
| D1 | 桌面运行时 | Swift / Tauri | Rust + Tauri 2 | 用户确认；首发 Apple Silicon |
| D2 | 编辑区 | textarea / CodeMirror | CodeMirror 6 + TypeScript | 支持撤销、查找、语法和大文档视口 |
| D3 | Markdown | 前端引擎 / Rust 引擎 | 兼容 Hoedown 3.0.7 + 原补丁 + Rust 会话逻辑 | 预览与导出共用渲染，隔离文档脚本 |
| D4 | 文件生命周期 | 任意路径 IPC / 原生选择 | Rust 原生对话框与文档会话 | 明确文件来源并保护未保存内容 |
| D5 | 发布 | Intel / ARM64 | aarch64-apple-darwin | 覆盖 M4 原生运行 |
| D6 | 上游关系 | 移植原码 / 新实现 | Rust 桌面重写，复用有许可证的兼容依赖与主题 | 保留功能行为与许可声明 |

## 2. 契约边界
- 渲染输入为 Markdown、当前文件资源目录、标题、主题；输出完整 HTML 与带唯一 ID 的大纲。
- 预览与 HTML 导出使用同一 Rust 渲染器和样式。
- 新建与打开使用独立文档窗口，保留已有修改；关闭、退出和回退前处理未保存内容，取消保持内容。
- 保存使用同目录临时文件与原子替换；检测当前文件被外部修改；失败不更新保存基线。
- 保存过程中继续编辑时，后续文字仍标记为未保存。
- 本地图片支持文档相对目录、父目录、绝对路径和 file URL；只嵌入识别的图片格式。文档脚本清理，受控图表脚本在隔离 iframe 中运行。
- 现有 MacDown 仓库不修改或删除。

## 3. Trade-off
### D2
- TypeScript 仅承担编辑器与界面；Rust 承担 Markdown 渲染、文件选择和读写。
### D5
- 首版提供本地 arm64 app/DMG；未配置 Developer ID 时不声称已签名公证。

## 4. 验收指标
- GFM 表格、任务列表、代码块、脚注和中文标题可预览；重复标题定位准确。
- 内容保存与导出可复现，文件冲突不覆盖外部改动。
- 新建/打开/退出的取消操作不丢内容；草稿可恢复。
- 实际编译 Apple Silicon 应用，验证 Mach-O 架构为 arm64。
- README 与关于页面链接到 MacDown 官方项目，声明独立实现。

## 5. 范围
- in scope: 对齐上游 3e2a2bf101c215c143bf00d9f857965f0ee82487 的菜单、偏好、Markdown 扩展、主题、图表、数学、HTML/PDF 导出、打印、多文档、终端入口和插件公开协议；逐项见 docs/parity/baseline.json。
- out of scope: 非 macOS 平台发布；没有 Developer ID 凭据时不宣称已签名公证。
