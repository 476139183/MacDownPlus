use std::{env, fs, path::PathBuf};
fn main() {
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("include/hoedown");
    fs::create_dir_all(&out).unwrap();
    let mut build = cc::Build::new();
    for entry in fs::read_dir("vendor/hoedown/src").unwrap() {
        let p = entry.unwrap().path();
        match p.extension().and_then(|x| x.to_str()) {
            Some("h") => {
                fs::copy(&p, out.join(p.file_name().unwrap())).unwrap();
            }
            Some("c") => {
                build.file(p);
            }
            _ => {}
        }
    }
    build
        .include(out.parent().unwrap())
        .include("vendor/hoedown/src")
        .include("vendor")
        .file("vendor/hoedown_html_patch.c")
        .file("vendor/bridge.c")
        .warnings(false)
        .compile("macdown_hoedown");
    println!("cargo:rerun-if-changed=vendor");
}
