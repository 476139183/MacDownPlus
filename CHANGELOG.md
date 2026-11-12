# Changelog

## 0.1.1 — MacDownPlus

- [ci build] 改名为 MacDownPlus，统一应用、仓库、目录及命令行名称，保留原配置身份。
- [ci build] 修复系统冷启动/恢复窗口时在初始化前访问状态导致的闪退，增加真实 LaunchServices 冷热打开测试。
- [ci build] 关闭和退出改为精确内容审批，保护保存期间输入、新修改与新建窗口。
- [ci build] 拆分文档聚合、启动队列、预览快照和应用级动作，修复重叠快照、偏好窗口菜单与打印临时文件清理。
- [ci build] 本地 app 完整 ad-hoc 签名；新增架构审查与验证记录。

## 0.1.0 — 开发版

- [ci build] 新建 Rust + Tauri 的 MacDown 兼容实现，添加原版渲染、编辑器、偏好、原生文件/打印入口及 arm64 构建。
- [ci build] 添加保存冲突、渲染扩展、编辑交互、预览隔离和原生 WebKit 自检；完整兼容状态以 docs/parity 为准。
- [ci build] 修复恢复草稿的路径别名可能绕过外部修改保护的问题，新增回归与原生恢复用例。
