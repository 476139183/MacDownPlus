use std::{env, fs, path::PathBuf};
fn main() {
    let mut entries = Vec::new();
    for (kind, extension) in [
        ("Styles", "css"),
        ("Themes", "style"),
        ("Templates", "handlebars"),
    ] {
        let dir = PathBuf::from("../public/vendor/macdown").join(kind);
        if let Ok(paths) = fs::read_dir(&dir) {
            for path in paths.flatten() {
                let p = path.path();
                if p.extension().and_then(|x| x.to_str()) == Some(extension) {
                    if let Ok(content) = fs::read_to_string(&p) {
                        entries.push(format!(
                            "({kind:?},{:?},{content:?})",
                            p.file_stem().unwrap().to_string_lossy()
                        ));
                    }
                }
            }
        }
        println!("cargo:rerun-if-changed={}", dir.display());
    }
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("resources.rs"),
        format!(
            "pub const RESOURCES: &[(&str,&str,&str)] = &[{}];",
            entries.join(",")
        ),
    )
    .unwrap();
    let locale_dir = PathBuf::from("../src/locales");
    let mut locales = Vec::new();
    for entry in fs::read_dir(&locale_dir).unwrap().flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|x| x == "json") {
            locales.push(format!(
                "({:?},{:?})",
                path.file_stem().unwrap().to_string_lossy(),
                fs::read_to_string(&path).unwrap()
            ));
        }
    }
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("locales.rs"),
        format!("const LOCALES:&[(&str,&str)]=&[{}];", locales.join(",")),
    )
    .unwrap();
    println!("cargo:rerun-if-changed={}", locale_dir.display());
    tauri_build::build()
}
