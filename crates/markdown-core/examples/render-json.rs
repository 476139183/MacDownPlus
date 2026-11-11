//! Test harness that exercises the production renderer without a desktop IPC mock renderer.
use std::io::{self, Read};
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let request: serde_json::Value = serde_json::from_str(&input).unwrap();
    let mut preferences = macdown_core::Preferences::default();
    if let Some(values) = request.get("preferences").and_then(|v| v.as_object()) {
        preferences
            .merge(values.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap();
    }
    let rendered = macdown_core::render_with_preferences(
        request["content"].as_str().unwrap_or(""),
        None,
        "Test.md",
        &preferences,
        "body { margin: 30px; font: 16px serif; }",
    );
    println!("{}", serde_json::to_string(&rendered).unwrap());
}
