# MacDownPlus

使用 **Rust + Tauri 2 + TypeScript / CodeMirror 6** 重写 MacDown，优先支持 Apple Silicon（包括 M4）原生运行。功能对齐原版 MacDown；兼容基线、验证记录和尚未验证的系统行为见 [兼容清单](docs/parity/README.md)。

感谢 [MacDownApp/macdown](https://github.com/MacDownApp/macdown) 及 Tzu-ping Chung。保留原版渲染补丁、主题和第三方许可证，详见 [鸣谢](ACKNOWLEDGEMENTS.md)。原有 MacDown 仓库独立保留。

## 开发

需要 macOS 13 或更新版本、Xcode Command Line Tools、Node.js 22.12+、Rust 稳定版（当前使用 1.98）。

```sh
npm ci
npm run desktop
```

若 Cargo 不在 PATH，先执行 `export PATH="$HOME/.cargo/bin:$PATH"`。

## 构建 Apple Silicon 应用

```sh
rustup target add aarch64-apple-darwin
CI=true npm run build:mac
```

产物：`target/aarch64-apple-darwin/release/bundle/macos/MacDownPlus.app` 和 `bundle/dmg/*.dmg`。CI 模式只跳过 Finder 对安装磁盘窗口的自动排版。

本地构建不包含 Developer ID 签名与 Apple 公证。最低系统版本是构建配置，并不等于已经在每个 macOS 版本上完成实机验证。

## 功能

- 原生菜单、多窗口、最近文档、文件关联、打开/另存/回退、外部修改冲突检测。
- 分栏编辑/预览、原版主题与 CSS、格式快捷键、搜索替换、同步滚动、字数统计。
- 原版 Hoedown 3.0.7 与 MacDown 补丁；Markdown 扩展按原版默认值和开关处理。
- Prism 代码高亮、任务列表、TOC、YAML 前置信息、Mermaid、Graphviz、MathJax（公式需要网络）。
- HTML 导出（样式选项）、PDF 导出、系统打印与页面设置。
- 五组偏好设置、用户主题/样式/Handlebars 模板、草稿恢复、终端入口和原生插件公开协议。

预览在独立的 opaque-origin sandbox iframe 中运行受控渲染脚本，无法使用桌面 IPC。文档中的脚本和事件属性会清理；本地图片支持相对路径、父目录、绝对路径与 file URL，仅读取识别为图片的文件。

## 测试

```sh
cargo test --workspace
npm run test:ui
```

系统文件打开回归：`python3 scripts/test-open-events.py`。审查结论见 [架构 review](docs/reviews/2026-11-12-architecture-review.md)。

UI 测试需要本机 Google Chrome，使用真实 Rust 渲染器，文件选择对话框通过 IPC 测试替身覆盖；它不能代替原生对话框的人工验收。原生自检由 `scripts/native-smoke.py` 在隔离目录中运行实际 arm64 应用，检查 WKWebView、文件保存、Prism、Mermaid、Graphviz、原生插件协议及 PDF 长文分页。

通过偏好设置的 Terminal 页安装 `macdownplus` 到 PATH 中的目录后：

```sh
macdownplus README.md
cat README.md | macdownplus -
```

许可：新实现为 MIT；复用资源遵循各自原始许可证。
