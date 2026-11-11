# Changelog

## 0.1.0 — 开发版

- [ci build] 新建 Rust + Tauri 的 MacDown 兼容实现，添加原版渲染、编辑器、偏好、原生文件/打印入口及 arm64 构建。
- [ci build] 添加保存冲突、渲染扩展、编辑交互、预览隔离和原生 WebKit 自检；完整兼容状态以 docs/parity 为准。
- [ci build] 修复恢复草稿的路径别名可能绕过外部修改保护的问题，新增回归与原生恢复用例。
