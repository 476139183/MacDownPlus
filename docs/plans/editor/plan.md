# MacDown Rust 实现计划

> 设计依据：[design.md](design.md)。按当前会话继续执行已授权的新仓库实现。

## 决策映射
- D1/D5 → Task 1、4
- D3/D4 → Task 2
- D2/D4 → Task 3
- D6 → Task 4

## Task 1：构建骨架
```yaml
decides: [D1, D5]
files:
  create: [package.json, Cargo.toml, tsconfig.json, vite.config.ts, src-tauri/Cargo.toml, src-tauri/tauri.conf.json]
steps:
  - 创建 Tauri 2 与 Vite 配置，固定 arm64 构建脚本。
verify:
  - command: npm install
    expect: 锁文件生成，依赖解析成功
```

## Task 2：Rust 渲染与文件会话
```yaml
decides: [D3, D4]
files:
  create: [crates/markdown-core/src/lib.rs, crates/markdown-core/tests/editor.rs, src-tauri/src/lib.rs, src-tauri/resources/preview.css]
steps:
  - 先用失败用例覆盖渲染、目录资源、原子保存、外部冲突与会话不变量。
  - 实现核心并接入原生文件对话框、菜单与退出通知。
verify:
  - command: cargo test -p macdown-core
    expect: 所有核心行为测试通过
```

## Task 3：编辑体验
```yaml
decides: [D2, D4]
files:
  create: [index.html, src/main.ts, src/style.css, tests/editor.spec.ts]
steps:
  - 接入 CodeMirror、Rust 渲染、大纲、布局与同步滚动。
  - 实现保存基线、草稿、未保存对话框、取消和异步保存状态。
verify:
  - command: npm run build
    expect: TypeScript 和前端构建通过
  - command: npm run test:ui
    expect: 编辑、取消、保存及预览隔离用例通过
```

## Task 4：构建与交付
```yaml
decides: [D1, D5, D6]
files:
  create: [README.md, ACKNOWLEDGEMENTS.md, LICENSE, .github/workflows/ci.yml]
steps:
  - 添加独立实现说明、上游鸣谢、运行和构建步骤。
  - 构建 arm64 app/DMG，验证文件架构并进行实际启动检查。
  - 创建公开 GitHub 仓库，提交并推送实际实现。
verify:
  - command: npm run build:mac
    expect: arm64 app 与 DMG 生成
  - command: file target/aarch64-apple-darwin/release/macdown-rust
    expect: Mach-O 64-bit executable arm64
```


## Task 5：完整功能兼容收敛（D2/D3/D4/D6）

- 对照冻结版本的 MainMenu.xib、全部偏好项及公开插件协议，不把菜单存在作为验收通过。
- 保留 Hoedown 3.0.7、原版补丁、主题、CSS 与 Prism/Mermaid/Viz 版本，明确引用与许可证。
- 核验格式、查找替换、原生文件生命周期、取消关闭、异步保存、草稿恢复、多窗口与命令行 stdin。
- 验证预览隔离、公式、图表、高亮及 HTML/PDF 输出，使用真实 WKWebView 补充浏览器自动化。
- 每项真实状态写入 docs/parity/README.md；不宣称未经验证的功能已完整兼容。
