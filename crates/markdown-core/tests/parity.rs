use macdown_core::{compatible_body, render_with_preferences, Preferences};
use serde_json::json;
#[test]
fn default_extensions_and_opt_in_extensions_follow_macdown() {
    let mut p = Preferences::default();
    let input = "~~gone~~ ==marked== _under_ x^2\n\n- [x] task\n\n| a | b |\n|---|---|\n| 1 | 2 |";
    let defaults = compatible_body(input, &p, false);
    assert!(defaults.contains("<table>"));
    assert!(!defaults.contains("<del>"));
    assert!(!defaults.contains("<mark>"));
    assert!(!defaults.contains("checkbox"));
    for key in [
        "extensionStrikethough",
        "extensionHighlight",
        "extensionUnderline",
        "extensionSuperscript",
        "htmlTaskList",
    ] {
        p.set(key, json!(true)).unwrap();
    }
    let enabled = compatible_body(input, &p, false);
    for token in ["<del>", "<mark>", "<u>", "<sup>", "checkbox"] {
        assert!(enabled.contains(token), "missing {token}: {enabled}");
    }
    p.set("extensionTables", json!(false)).unwrap();
    assert!(!compatible_body(input, &p, false).contains("<table>"));
}
#[test]
fn toc_and_front_matter_remain_in_preview() {
    let mut p = Preferences::default();
    p.set("htmlRendersTOC", json!(true)).unwrap();
    p.set("htmlDetectFrontMatter", json!(true)).unwrap();
    let result = render_with_preferences(
        "---\ntitle: 测试\nauthor: Ada\n---\n\n[TOC]\n\n# Heading\n\nText",
        None,
        "Test",
        &p,
        "",
    );
    assert!(result.body.contains("front-matter"));
    assert!(result.body.contains("测试"));
    assert!(result.body.contains("href=\"#toc_0\""));
    assert_eq!(result.headings.len(), 1);
}
#[test]
fn math_and_custom_code_info_survive_cleaning() {
    let mut p = Preferences::default();
    p.set("htmlMathJax", json!(true)).unwrap();
    p.set("htmlMathJaxInlineDollar", json!(true)).unwrap();
    p.set("htmlCodeBlockAccessory", json!(2)).unwrap();
    let output = render_with_preferences(
        "$x^2$\n\n$$y = 2$$\n\n```rust:Example\nfn main() {}\n```",
        None,
        "Test",
        &p,
        "",
    );
    assert!(output.body.contains("x^2"));
    assert!(output.body.contains("y = 2"));
    assert!(
        output.body.contains("data-information=\"Example\""),
        "{}",
        output.body
    );
}
#[test]
fn preference_schema_rejects_unknown_or_invalid_fields() {
    let mut p = Preferences::default();
    assert!(p.set("nonexistent", json!(true)).is_err());
    assert!(p.set("htmlMathJax", json!("true")).is_err());
    assert!(p.set("editorHorizontalInset", json!(-10)).is_err());
}
