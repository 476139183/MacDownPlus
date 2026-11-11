# Acknowledgements

MacDown Rust is an independent Rust + Tauri implementation of the MacDown editor experience.

We thank **Tzu-ping Chung and the MacDown contributors** for [MacDown](https://github.com/MacDownApp/macdown), the reference for editor behavior, menus and preferences. The frozen compatibility reference is commit `3e2a2bf101c215c143bf00d9f857965f0ee82487`.

This project reuses MacDown's Hoedown rendering patches, editor themes, preview styles, help text and selected browser extensions. Original copyright headers and licenses are retained. MacDown's MIT license is in `third-party/macdown/LICENSE/macdown.txt`; theme and embedded library notices are included alongside it. Reused code is not claimed as a new Rust implementation.

- Hoedown 3.0.7: Markdown compatibility engine, compiled through a small C bridge. See `crates/markdown-core/vendor/hoedown/LICENSE`.
- Prism: syntax highlighting at upstream MacDown submodule revision `bd479f1d5ff0855b4c50168c1a82c91b2db191f2`. See `public/vendor/prism/LICENSE`.
- Mermaid and Viz.js: diagram rendering from MacDown's vendored resources; original notices in `third-party/macdown/LICENSE/`.
- MathJax 2.7.3: loaded from the original generation of CDN distribution when enabled; requires network access. See MathJax's Apache 2.0 notice.
- Rust, Tauri, CodeMirror, Vite and their dependency contributors. Their respective licenses apply to their components.

MacDown Rust is not an official release of MacDown and does not use MacDown's application icon or update feed.
