# 文字颜色与预览一致性

用户要求：左侧设文字色、背景色、删除线等格式，右侧立即显示最终排版；保存与导出后保留效果。

## 参考

- [MarkText #5661](https://github.com/marktext/marktext/pull/5661)：以 `<span style="color:#rrggbb;background-color:#rrggbb">` 存储；支持叠加、局部改色与重置。参考存储与交互设计，自行实现 CodeMirror 适配，未复制其编辑引擎。
- [MacDown 3000 CHANGELOG](https://github.com/schuyler/macdown3000/blob/main/CHANGELOG.md)：删除线默认启用。原版 MacDown 的可选扩展设置导致仅插入标记时无法预览。

## 实现

`colors.ts` 负责选区内的颜色区段，保留选区之外颜色、Markdown 文本与块级前缀；单次编辑使用 CodeMirror transaction，支持撤销。颜色入口放在原生格式菜单与现有可显示的工具栏，选择器支持取色与十六进制输入、应用和取消。

Rust 渲染仅新增 span.style 的 color/background-color 十六进制白名单，布局、URL、脚本及其他样式仍过滤。预览、复制 HTML、HTML 导出和 PDF 使用同一份已过滤结果。

格式命令主动刷新预览，包括手动渲染模式；正常键入仍遵守手动模式。删除线默认开启，明确保存过的偏好不强制重置；使用格式按钮时自动启用对应解析选项。不得改写用户文档、迁移账户或重置配置。

## 验证

先复现颜色被过滤、删除线按钮插入原始标记的失败，再运行 Rust 白名单/安全测试、浏览器实际 CSS/局部改色/清除/撤销/结构测试与原生保存、恢复及 PDF 自检。
