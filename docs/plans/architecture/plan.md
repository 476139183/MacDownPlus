# MacDownPlus 架构执行计划

设计依据：[design.md](design.md)。用户授权包含崩溃修复、改名、深度 review 和架构优化。

## 1. 启动与打开链路（A1/A7）

```yaml
files:
  create: [src-tauri/src/lifecycle.rs, scripts/test-open-events.py]
  modify: [src-tauri/src/lib.rs]
steps:
  - 用原安装版复现冷启动 panic，保留 stderr 证据。
  - 先注册文件请求队列，Ready 后统一主线程消费；保护 Reopen 和早期退出。
  - 把 setup_app 提为可审查的初始化函数。
verify:
  - cargo test -p macdownplus --lib
  - python3 scripts/test-open-events.py
```

## 2. 文档与确认（A2/A3）

```yaml
files:
  create: [src-tauri/src/documents.rs]
  modify: [src-tauri/src/lib.rs, crates/markdown-core/src/lib.rs, src/main.ts]
steps:
  - 删除重复 dirty 状态，关闭/退出按具体文本审批。
  - stdin 先持久化；Revert 原子更新后清理旧草稿。
  - 前端订阅先于快照，屏蔽加载导致的编辑副作用。
verify:
  - cargo test -p macdown-core
  - cargo test -p macdownplus --lib
  - npm run test:ui
```

## 3. 预览、应用级动作与任务清理（A4/A5/A6）

```yaml
files:
  create: [src/preview.ts, src/application.ts, src/dialogs.ts]
  modify: [src/main.ts, src/preferences.ts, src-tauri/src/lib.rs, tests/editor.spec.ts]
steps:
  - 快照共享单次请求，超时和换代结束全部调用者。
  - 全局动作与文档动作分离，偏好窗口可消费全局菜单。
  - 打印任务统一清理中间 HTML。
verify:
  - npm run test:ui
  - python3 scripts/native-smoke.py
```

## 4. 改名与安装

```yaml
files:
  modify: [package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json, README.md, CHANGELOG.md]
steps:
  - 仓库/目录/应用改名，保持原 Bundle Identifier 的配置身份。
  - 构建并验证资源签名、实际文档 cold/warm、原生导出。
  - 安装 MacDownPlus，打开用户指定文档，保留其内容不变。
  - 提交、推送并记录已验证项目及仍需实机验证的范围。
verify:
  - CI=true npm run build:mac
  - codesign --verify --deep --strict "MacDownPlus.app"
```
