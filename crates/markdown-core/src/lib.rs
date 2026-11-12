mod preferences;
use base64::{engine::general_purpose::STANDARD, Engine};
pub use preferences::*;
use regex::Regex;
use serde::Serialize;
use std::{
    borrow::Cow,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::OnceLock,
};

#[derive(Debug, Clone, Serialize)]
pub struct Heading {
    pub id: String,
    pub text: String,
    pub level: u8,
}
#[derive(Debug, Clone, Serialize)]
pub struct RenderedDocument {
    pub html: String,
    pub body: String,
    pub headings: Vec<Heading>,
}
#[derive(Debug, Clone, Serialize)]
pub struct DocumentInfo {
    pub path: String,
    pub name: String,
    pub content: String,
}

unsafe extern "C" {
    fn macdown_render(
        text: *const u8,
        size: usize,
        mask: u32,
        flags: i32,
        toc: i32,
        smart: i32,
        length: *mut usize,
    ) -> *mut u8;
    fn macdown_free(pointer: *mut std::ffi::c_void);
}

pub fn compatible_body(markdown: &str, prefs: &Preferences, toc: bool) -> String {
    let features = [
        "extensionTables",
        "extensionFencedCode",
        "extensionFootnotes",
        "extensionAutolink",
        "extensionStrikethough",
        "extensionUnderline",
        "extensionHighlight",
        "extensionQuote",
        "extensionSuperscript",
        "htmlMathJax",
        "!extensionIntraEmphasis",
        "htmlMathJaxInlineDollar",
    ];
    let mask = features.iter().enumerate().fold(0, |mask, (i, key)| {
        let enabled = key
            .strip_prefix('!')
            .map_or_else(|| prefs.flag(key), |k| !prefs.flag(k));
        mask | if enabled { 1 << i } else { 0 }
    });
    let flags = (if prefs.flag("htmlHardWrap") { 2 } else { 0 })
        | (if prefs.flag("htmlTaskList") { 16 } else { 0 })
        | (if prefs.flag("htmlLineNumbers") { 32 } else { 0 })
        | (if prefs.number("htmlCodeBlockAccessory") == 2.0 {
            64
        } else {
            0
        });
    let mut length = 0;
    // Upstream allocates the result; copy the exact byte count, then release it in the same C runtime.
    unsafe {
        let output = macdown_render(
            markdown.as_ptr(),
            markdown.len(),
            mask,
            flags,
            i32::from(toc),
            i32::from(prefs.flag("extensionSmartyPants")),
            &mut length,
        );
        if output.is_null() {
            return String::new();
        }
        let result =
            String::from_utf8_lossy(std::slice::from_raw_parts(output, length)).into_owned();
        macdown_free(output.cast());
        result
    }
}

pub fn escape_html(value: &str) -> String {
    html_escape::encode_double_quoted_attribute(value).into_owned()
}

fn embedded_image(url: &str, root: Option<&Path>) -> Option<String> {
    if url.starts_with("https:") || url.starts_with("http:") || url.starts_with("data:image/") {
        return Some(url.to_owned());
    }
    let raw = url.split(['?', '#']).next()?;
    let raw = raw
        .strip_prefix("file://localhost")
        .or_else(|| raw.strip_prefix("file://"))
        .unwrap_or(raw);
    let decoded = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .ok()?;
    let path = if Path::new(decoded.as_ref()).is_absolute() {
        PathBuf::from(decoded.as_ref())
    } else {
        root?.join(decoded.as_ref())
    }
    .canonicalize()
    .ok()?;
    if !path.is_file() {
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else if path
        .extension()
        .is_some_and(|x| x.eq_ignore_ascii_case("svg"))
    {
        "image/svg+xml"
    } else {
        return None;
    };
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

pub fn render_with_preferences(
    markdown: &str,
    root: Option<&Path>,
    title: &str,
    prefs: &Preferences,
    style: &str,
) -> RenderedDocument {
    let mut input = markdown;
    let mut front = String::new();
    if prefs.flag("htmlDetectFrontMatter") && markdown.starts_with("---\n") {
        if let Some(end) = markdown[4..].find("\n---") {
            if let Ok(serde_yaml::Value::Mapping(values)) =
                serde_yaml::from_str::<serde_yaml::Value>(&markdown[4..4 + end])
            {
                front.push_str("<table class=\"front-matter\"><tbody>");
                for (key, value) in values {
                    let text = |v: serde_yaml::Value| {
                        v.as_str().map(str::to_owned).unwrap_or_else(|| {
                            serde_yaml::to_string(&v)
                                .unwrap_or_default()
                                .trim()
                                .to_owned()
                        })
                    };
                    front.push_str(&format!(
                        "<tr><th>{}</th><td>{}</td></tr>",
                        escape_html(&text(key)),
                        escape_html(&text(value))
                    ));
                }
                front.push_str("</tbody></table>\n");
                input = markdown[4 + end + 4..].trim_start_matches(['\r', '\n']);
            }
        }
    }
    let mut body = compatible_body(input, prefs, false);
    if prefs.flag("htmlRendersTOC") {
        let toc = compatible_body(input, prefs, true);
        body = Regex::new(r"(?is)<p[^>]*>\s*\[TOC\]\s*</p>")
            .unwrap()
            .replace_all(&body, |_: &regex::Captures| toc.clone())
            .into_owned();
    }
    body = front + &body;
    let image_root = root.map(Path::to_path_buf);
    let mut cleaner = ammonia::Builder::default();
    cleaner
        .add_tags(["input", "mark", "u", "q", "s", "del", "sup", "span", "div"])
        .add_generic_attributes(["id", "class"])
        .add_tag_attributes("input", ["type", "checked", "disabled"])
        .add_tag_attributes("pre", ["data-information"])
        .add_url_schemes(["data", "file"])
        .attribute_filter(move |tag, attr, value| {
            if attr == "href" && value.trim().to_ascii_lowercase().starts_with("data:") {
                None
            } else if tag == "img" && attr == "src" {
                embedded_image(value, image_root.as_deref()).map(Cow::Owned)
            } else {
                Some(Cow::Borrowed(value))
            }
        });
    body = cleaner.clean(&body).to_string();
    static HEADINGS: OnceLock<Regex> = OnceLock::new();
    static TAGS: OnceLock<Regex> = OnceLock::new();
    let re = HEADINGS.get_or_init(|| {
        Regex::new(r#"(?s)<h([1-6])[^>]*id="([^"]+)"[^>]*>(.*?)</h[1-6]>"#).unwrap()
    });
    let tags = TAGS.get_or_init(|| Regex::new(r"<[^>]*>").unwrap());
    let headings = re
        .captures_iter(&body)
        .map(|c| Heading {
            level: c[1].parse().unwrap_or(1),
            id: c[2].to_owned(),
            text: html_escape::decode_html_entities(&tags.replace_all(&c[3], "")).into_owned(),
        })
        .collect();
    let html = html_document(&body, title, style, "");
    RenderedDocument {
        html,
        body,
        headings,
    }
}

pub fn html_document(body: &str, title: &str, style: &str, extra_head: &str) -> String {
    format!("<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https:; font-src data: https:; script-src 'none'; base-uri 'none'\"><title>{}</title><style>{style}</style>{extra_head}</head><body>{body}</body></html>", escape_html(title))
}

pub fn render_markdown(
    markdown: &str,
    root: Option<&Path>,
    title: &str,
    dark: bool,
) -> RenderedDocument {
    let mut prefs = Preferences::default();
    prefs.set("htmlTaskList", serde_json::json!(true)).unwrap();
    let mut result =
        render_with_preferences(markdown, root, title, &prefs, include_str!("preview.css"));
    result.html = result.html.replace(
        "<body>",
        if dark {
            "<body class=\"theme-dark\">"
        } else {
            "<body class=\"theme-light\">"
        },
    );
    result
}

pub fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("文件目录无效")?;
    if fs::metadata(path).is_ok_and(|m| m.permissions().readonly()) {
        return Err("文件为只读，请另存为。".into());
    }
    let mut pending =
        tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("无法写入目录：{e}"))?;
    if let Ok(metadata) = fs::metadata(path) {
        pending
            .as_file()
            .set_permissions(metadata.permissions())
            .map_err(|e| e.to_string())?;
    }
    pending.write_all(content).map_err(|e| e.to_string())?;
    pending.as_file().sync_all().map_err(|e| e.to_string())?;
    pending
        .persist(path)
        .map_err(|e| format!("无法保存文件：{e}"))?;
    Ok(())
}

fn resolved_path(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        path.canonicalize().map_err(|e| e.to_string())
    } else {
        Ok(path
            .parent()
            .ok_or("文件目录无效")?
            .canonicalize()
            .map_err(|e| e.to_string())?
            .join(path.file_name().ok_or("文件名无效")?))
    }
}

#[derive(Default)]
pub struct DocumentSession {
    path: Option<PathBuf>,
    saved_text: String,
}
impl DocumentSession {
    pub fn from_text(text: String) -> Self {
        Self {
            path: None,
            saved_text: text,
        }
    }
    pub fn restore(path: Option<PathBuf>, saved_text: String) -> Self {
        // Match the identity used by open/save even when a draft was recorded
        // through /var, /tmp or a user-created directory symlink.
        Self {
            path: path.map(|path| path.canonicalize().unwrap_or(path)),
            saved_text,
        }
    }
    pub fn saved_text(&self) -> &str {
        &self.saved_text
    }
    pub fn current_path(&self) -> Option<&Path> {
        self.path.as_deref()
    }
    pub fn info(&self) -> DocumentInfo {
        DocumentInfo {
            path: self
                .path
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default(),
            name: self
                .path
                .as_ref()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Untitled.md".into()),
            content: self.saved_text.clone(),
        }
    }
    pub fn open(&mut self, path: &Path) -> Result<DocumentInfo, String> {
        let path = path
            .canonicalize()
            .map_err(|e| format!("无法打开文件：{e}"))?;
        let content = fs::read_to_string(&path).map_err(|e| format!("无法读取 UTF-8 文本：{e}"))?;
        self.path = Some(path);
        self.saved_text = content;
        Ok(self.info())
    }
    pub fn save(&mut self, path: &Path, content: &str) -> Result<DocumentInfo, String> {
        let path = resolved_path(path)?;
        if self.path.as_ref() == Some(&path) {
            let disk = fs::read_to_string(&path).map_err(|_| "原文件已移动或删除，请另存为。")?;
            if disk != self.saved_text {
                return Err("文件已被其他程序修改。请另存为，避免覆盖外部改动。".into());
            }
        }
        atomic_write(&path, content.as_bytes())?;
        self.path = Some(path);
        self.saved_text = content.to_owned();
        Ok(self.info())
    }
    pub fn export_html(&self, path: &Path, content: &str, dark: bool) -> Result<(), String> {
        let path = resolved_path(path)?;
        if self.path.as_ref() == Some(&path) {
            return Err("导出文件不能覆盖当前 Markdown 文件。".into());
        }
        let root = self.path.as_deref().and_then(Path::parent);
        atomic_write(
            &path,
            render_markdown(content, root, &self.info().name, dark)
                .html
                .as_bytes(),
        )
    }
    pub fn reset(&mut self) {
        self.path = None;
        self.saved_text.clear();
    }
}
