use macdown_core::{render_markdown, DocumentSession};
use std::fs;
use tempfile::tempdir;

#[cfg(unix)]
#[test]
fn restored_drafts_keep_external_conflict_protection_through_path_aliases() {
    let tmp = tempdir().unwrap();
    let real = tmp.path().join("real");
    fs::create_dir(&real).unwrap();
    let alias = tmp.path().join("alias");
    std::os::unix::fs::symlink(&real, &alias).unwrap();
    let file = real.join("note.md");
    fs::write(&file, "saved baseline").unwrap();
    let mut session =
        DocumentSession::restore(Some(alias.join("note.md")), "saved baseline".into());
    fs::write(&file, "external edit after crash").unwrap();
    assert!(session
        .save(&alias.join("note.md"), "recovered draft")
        .is_err());
    assert_eq!(
        fs::read_to_string(file).unwrap(),
        "external edit after crash"
    );
}

#[test]
fn renders_gfm_and_distinct_unicode_heading_targets() {
    let result = render_markdown("# 中文标题\n\n# 中文标题\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n```rust\nfn main() {}\n```", None, "Test", false);
    assert_eq!(result.headings.len(), 2);
    assert_ne!(result.headings[0].id, result.headings[1].id);
    assert!(result.html.contains("<table>"));
    assert!(result.html.contains("checkbox"));
    assert!(result.html.contains("language-rust"));
    assert!(result
        .html
        .contains(&format!("id=\"{}\"", result.headings[0].id)));
}

#[test]
fn document_html_cannot_run_scripts_or_inject_title_markup() {
    let result = render_markdown("<script>window.pwned=1</script><img src=x onerror=alert(1)>\n\n[attack](javascript:alert(1))\n\n<a href=\"data:text/html,attack\">link</a>", None, "</title><script>bad()</script>", false);
    assert!(!result.html.contains("<script>"));
    assert!(!result.html.contains("onerror="));
    assert!(!result.html.contains("href=\"javascript:"));
    assert!(!result.html.contains("href=\"data:text/html"));
    assert!(result.html.contains("script-src 'none'"));
    assert!(result.html.contains("&lt;/title&gt;"));
}

#[test]
fn embeds_relative_parent_absolute_and_file_url_images_but_rejects_non_images() {
    let tmp = tempdir().unwrap();
    let folder = tmp.path().join("notes");
    fs::create_dir(&folder).unwrap();
    let image = b"\x89PNG\r\n\x1a\ninside";
    fs::write(folder.join("picture.png"), image).unwrap();
    let shared = tmp.path().join("shared.png");
    fs::write(&shared, image).unwrap();
    let secret = tmp.path().join("not-an-image.png");
    fs::write(&secret, b"PRIVATE_NON_IMAGE").unwrap();
    let markdown=format!("![local](picture.png)\n\n![parent](../shared.png)\n\n![absolute]({})\n\n![file](file://{})\n\n![invalid](../not-an-image.png)",shared.display(),shared.display());
    let result = render_markdown(&markdown, Some(&folder), "Images", false);
    assert_eq!(result.html.matches("data:image/png;base64,").count(), 4);
    assert!(!result.html.contains("PRIVATE_NON_IMAGE"));
}

#[test]
fn save_preserves_unicode_crlf_and_survives_a_fresh_session() {
    let tmp = tempdir().unwrap();
    let path = tmp.path().join("中文.md");
    let mut session = DocumentSession::default();
    let info = session
        .save(&path, "# 文档\r\n\r\n保存测试 😀\r\n")
        .unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), info.content);
    assert_eq!(info.name, "中文.md");
    let mut next = DocumentSession::default();
    assert_eq!(next.open(&path).unwrap().content, info.content);
}

#[test]
fn external_changes_are_not_silently_overwritten() {
    let tmp = tempdir().unwrap();
    let path = tmp.path().join("note.md");
    fs::write(&path, "before").unwrap();
    let mut session = DocumentSession::default();
    session.open(&path).unwrap();
    fs::write(&path, "changed by another app").unwrap();
    assert!(session.save(&path, "our text").is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "changed by another app");
    let copy = tmp.path().join("copy.md");
    session.save(&copy, "our text").unwrap();
    assert_eq!(fs::read_to_string(copy).unwrap(), "our text");
}

#[test]
fn failed_open_preserves_the_current_session() {
    let tmp = tempdir().unwrap();
    let path = tmp.path().join("note.md");
    fs::write(&path, "keep").unwrap();
    let mut session = DocumentSession::default();
    session.open(&path).unwrap();
    assert!(session.open(&tmp.path().join("missing.md")).is_err());
    assert_eq!(
        session.current_path().unwrap(),
        fs::canonicalize(path).unwrap()
    );
}

#[test]
fn failed_save_does_not_switch_the_current_file() {
    let tmp = tempdir().unwrap();
    let path = tmp.path().join("note.md");
    fs::write(&path, "keep").unwrap();
    let mut session = DocumentSession::default();
    session.open(&path).unwrap();
    assert!(session
        .save(&tmp.path().join("missing/fail.md"), "new")
        .is_err());
    assert_eq!(
        session.current_path().unwrap(),
        fs::canonicalize(&path).unwrap()
    );
    assert_eq!(fs::read_to_string(path).unwrap(), "keep");
}

#[test]
fn html_export_does_not_overwrite_the_open_markdown_file() {
    let tmp = tempdir().unwrap();
    let path = tmp.path().join("note.md");
    fs::write(&path, "# Original").unwrap();
    let mut session = DocumentSession::default();
    session.open(&path).unwrap();
    assert!(session.export_html(&path, "# Other", false).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "# Original");
    let html = tmp.path().join("note.html");
    session.export_html(&html, "# Exported", true).unwrap();
    let exported = fs::read_to_string(html).unwrap();
    assert!(exported.contains("Exported"));
    assert!(exported.contains("theme-dark"));
}
