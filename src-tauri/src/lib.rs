mod menu;
mod native;
mod pdf;
include!(concat!(env!("OUT_DIR"), "/resources.rs"));
use macdown_core::{atomic_write, DocumentInfo, DocumentSession, Preferences, RenderedDocument};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

struct Document {
    session: DocumentSession,
    text: String,
    dirty: bool,
}
impl Default for Document {
    fn default() -> Self {
        Self {
            session: DocumentSession::default(),
            text: String::new(),
            dirty: false,
        }
    }
}
pub struct AppState {
    docs: Mutex<HashMap<String, Document>>,
    preferences: Mutex<Preferences>,
    pub recents: Mutex<Vec<String>>,
    directory: PathBuf,
    drafts: PathBuf,
    serial: AtomicUsize,
    quit: Mutex<Option<VecDeque<String>>>,
    exit: AtomicBool,
    speech: Mutex<Option<std::process::Child>>,
}
#[derive(Serialize, Deserialize)]
struct Draft {
    path: Option<PathBuf>,
    saved: String,
    text: String,
}
fn resource_path(state: &AppState, kind: &str, name: &str) -> Result<PathBuf, String> {
    let ext = match kind {
        "Styles" => "css",
        "Themes" => "style",
        "Templates" => "handlebars",
        _ => return Err("未知资源类型".into()),
    };
    if name.contains(['/', '\\']) || name == ".." {
        return Err("资源名称无效".into());
    }
    Ok(state.directory.join(kind).join(format!("{name}.{ext}")))
}
fn read_resource(state: &AppState, kind: &str, name: &str) -> String {
    resource_path(state, kind, name)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .or_else(|| {
            RESOURCES
                .iter()
                .find(|(k, n, _)| *k == kind && *n == name)
                .map(|(_, _, v)| v.to_string())
        })
        .unwrap_or_default()
}
fn save_preferences_file(state: &AppState) -> Result<(), String> {
    atomic_write(
        &state.directory.join("preferences.json"),
        serde_json::to_vec_pretty(&*state.preferences.lock().unwrap())
            .map_err(|e| e.to_string())?
            .as_slice(),
    )
}
fn recent(app: &AppHandle, path: &Path) {
    let state = app.state::<AppState>();
    let path = path.to_string_lossy().into_owned();
    let mut list = state.recents.lock().unwrap();
    list.retain(|p| p != &path);
    list.insert(0, path);
    list.truncate(20);
    let _ = atomic_write(
        &state.directory.join("recents.json"),
        serde_json::to_vec(&*list).unwrap().as_slice(),
    );
    drop(list);
    let _ = menu::rebuild(app);
}
fn info(window: &WebviewWindow, state: &AppState) -> Value {
    let mut docs = state.docs.lock().unwrap();
    let doc = docs.entry(window.label().into()).or_default();
    json!({"document":doc.session.info(),"text":doc.text,"dirty":doc.dirty})
}
fn window_for(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    app.get_webview_window(label)
        .ok_or_else(|| "文档窗口已关闭".into())
}
fn create_window(app: &AppHandle, document: Document) -> Result<WebviewWindow, String> {
    let state = app.state::<AppState>();
    let id = format!("doc-{}", state.serial.fetch_add(1, Ordering::SeqCst));
    let name = document.session.info().name;
    state.docs.lock().unwrap().insert(id.clone(), document);
    match WebviewWindowBuilder::new(app, &id, WebviewUrl::App("index.html".into()))
        .title(name)
        .inner_size(1024.0, 650.0)
        .min_inner_size(360.0, 240.0)
        .build()
    {
        Ok(w) => Ok(w),
        Err(e) => {
            state.docs.lock().unwrap().remove(&id);
            Err(e.to_string())
        }
    }
}
fn open_path(app: &AppHandle, path: &Path) -> Result<(), String> {
    let state = app.state::<AppState>();
    if path.parent() == Some(std::env::temp_dir().join("MacDown-Rust-stdin").as_path()) {
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let reuse = state
            .docs
            .lock()
            .unwrap()
            .iter()
            .find(|(_, d)| d.session.current_path().is_none() && d.text.is_empty() && !d.dirty)
            .map(|(k, _)| k.clone());
        let doc = Document {
            session: DocumentSession::default(),
            text,
            dirty: true,
        };
        if let Some(label) = reuse {
            state.docs.lock().unwrap().insert(label.clone(), doc);
            let window = window_for(app, &label)?;
            native::document(&window, "", true);
            let _ = window.emit("document-changed", info(&window, &state));
            let _ = window.show();
            let _ = window.set_focus();
        } else {
            create_window(app, doc)?;
        }
        let _ = fs::remove_file(path);
        return Ok(());
    }
    let mut session = DocumentSession::default();
    let loaded = session.open(path)?;
    let duplicate = state
        .docs
        .lock()
        .unwrap()
        .iter()
        .find(|(_, d)| d.session.current_path() == session.current_path())
        .map(|(k, _)| k.clone());
    if let Some(id) = duplicate {
        let _ = window_for(app, &id)?.set_focus();
        return Ok(());
    }
    let reuse = state
        .docs
        .lock()
        .unwrap()
        .iter()
        .find(|(_, d)| d.session.current_path().is_none() && d.text.is_empty() && !d.dirty)
        .map(|(k, _)| k.clone());
    let document = Document {
        session,
        text: loaded.content.clone(),
        dirty: false,
    };
    if let Some(id) = reuse {
        state.docs.lock().unwrap().insert(id.clone(), document);
        let w = window_for(app, &id)?;
        let _ = w.set_title(&loaded.name);
        native::document(&w, &loaded.path, false);
        let _ = w.emit("document-changed", info(&w, &state));
        let _ = w.show();
        let _ = w.set_focus();
    } else {
        let w = create_window(app, document)?;
        native::document(&w, &loaded.path, false);
    }
    recent(app, path);
    Ok(())
}
fn start_quit(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut quit = state.quit.lock().unwrap();
    if quit.is_some() {
        return;
    }
    *quit = Some(state.docs.lock().unwrap().keys().cloned().collect());
    drop(quit);
    continue_quit(app);
}
fn continue_quit(app: &AppHandle) {
    let state = app.state::<AppState>();
    let next = state
        .quit
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|q| q.front().cloned());
    if let Some(label) = next {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.set_focus();
            let _ = w.emit("menu-action", "quit-confirm");
        } else {
            if let Some(q) = state.quit.lock().unwrap().as_mut() {
                q.pop_front();
            }
            continue_quit(app);
        }
    } else {
        state.exit.store(true, Ordering::SeqCst);
        if let Ok(entries) = fs::read_dir(&state.drafts) {
            for e in entries.flatten() {
                let _ = fs::remove_file(e.path());
            }
        }
        app.exit(0);
    }
}
#[tauri::command]
fn bootstrap(window: WebviewWindow, state: State<AppState>) -> Value {
    if std::env::var_os("MACDOWN_TEST_DIR").is_some() {
        eprintln!("native-smoke: bootstrap {}", window.label());
    }
    let mut result = if window.label() == "preferences" {
        json!({})
    } else {
        info(&window, &state)
    };
    result["selfTest"] =
        json!(window.label() == "main" && std::env::var_os("MACDOWN_TEST_DIR").is_some());
    result["preferences"] = serde_json::to_value(&*state.preferences.lock().unwrap()).unwrap();
    result["resources"] = json!({"Styles":resource_names(&state,"Styles"),"Themes":resource_names(&state,"Themes"),"Templates":resource_names(&state,"Templates")});
    result
}
fn resource_names(state: &AppState, kind: &str) -> Vec<String> {
    let mut names: Vec<String> = RESOURCES
        .iter()
        .filter(|(k, _, _)| *k == kind)
        .map(|(_, n, _)| n.to_string())
        .collect();
    if let Ok(entries) = fs::read_dir(state.directory.join(kind)) {
        for e in entries.flatten() {
            if e.path().is_file() {
                if let Some(name) = e.path().file_stem() {
                    names.push(name.to_string_lossy().into_owned());
                }
            }
        }
    }
    names.sort();
    names.dedup();
    names
}
#[tauri::command]
fn get_resource(state: State<AppState>, kind: String, name: String) -> String {
    read_resource(&state, &kind, &name)
}
#[tauri::command]
fn set_preferences(
    app: AppHandle,
    state: State<AppState>,
    values: BTreeMap<String, Value>,
) -> Result<Preferences, String> {
    state.preferences.lock().unwrap().merge(values)?;
    save_preferences_file(&state)?;
    let prefs = state.preferences.lock().unwrap().clone();
    let _ = app.emit("preferences-changed", &prefs);
    Ok(prefs)
}
#[tauri::command]
async fn new_document(app: AppHandle) -> Result<(), String> {
    create_window(&app, Document::default())?;
    Ok(())
}
#[tauri::command]
async fn show_help(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let path = state.directory.join("MacDown Help.md");
    if !path.exists() {
        atomic_write(&path, include_bytes!("../../public/vendor/macdown/help.md"))?;
    }
    open_path(&app, &path)
}
#[tauri::command]
async fn open_documents(app: AppHandle) -> Result<(), String> {
    let selected = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "mdown", "mkd", "txt"])
        .blocking_pick_files();
    if let Some(paths) = selected {
        for path in paths {
            open_path(&app, &path.into_path().map_err(|e| e.to_string())?)?;
        }
    }
    Ok(())
}
#[tauri::command]
async fn save_document(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    content: String,
    save_as: bool,
) -> Result<Option<DocumentInfo>, String> {
    let current = state
        .docs
        .lock()
        .unwrap()
        .get(window.label())
        .and_then(|d| d.session.current_path().map(Path::to_path_buf));
    let path = if save_as || current.is_none() {
        let mut dialog = app
            .dialog()
            .file()
            .add_filter("Markdown", &["md", "markdown"]);
        if let Some(p) = &current {
            dialog = dialog.set_file_name(p.file_name().unwrap().to_string_lossy());
        } else {
            dialog = dialog.set_file_name("Untitled.md");
        }
        match dialog.blocking_save_file() {
            Some(p) => p.into_path().map_err(|e| e.to_string())?,
            None => return Ok(None),
        }
    } else {
        current.unwrap()
    };
    let mut docs = state.docs.lock().unwrap();
    let doc = docs.get_mut(window.label()).ok_or("文档已关闭")?;
    let result = doc.session.save(&path, &content)?;
    doc.dirty = doc.text != content;
    let dirty = doc.dirty;
    drop(docs);
    recent(&app, &path);
    native::document(&window, &result.path, dirty);
    let _ = window.set_title(&result.name);
    Ok(Some(result))
}
#[tauri::command]
fn update_document(
    window: WebviewWindow,
    state: State<AppState>,
    text: String,
    dirty: bool,
) -> Result<(), String> {
    let mut docs = state.docs.lock().unwrap();
    let doc = docs.get_mut(window.label()).ok_or("文档已关闭")?;
    doc.text = text.clone();
    doc.dirty = dirty;
    let loaded = doc.session.info();
    let draft = Draft {
        path: doc.session.current_path().map(Path::to_path_buf),
        saved: loaded.content,
        text,
    };
    drop(docs);
    let path = state.drafts.join(format!("{}.json", window.label()));
    if dirty {
        atomic_write(
            &path,
            serde_json::to_vec(&draft)
                .map_err(|e| e.to_string())?
                .as_slice(),
        )?;
    } else if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    native::document(&window, &loaded.path, dirty);
    Ok(())
}
#[tauri::command]
fn mark_document(window: WebviewWindow, state: State<AppState>, text: String, dirty: bool) {
    if let Some(doc) = state.docs.lock().unwrap().get_mut(window.label()) {
        doc.text = text;
        doc.dirty = dirty;
    }
}
#[tauri::command]
fn self_test_report(
    app: AppHandle,
    state: State<AppState>,
    mut report: Value,
) -> Result<(), String> {
    let dir = std::env::var_os("MACDOWN_TEST_DIR").ok_or("非测试运行")?;
    if let Some(summary) = pdf::summary(&PathBuf::from(&dir).join("preview.pdf")) {
        report["pdfSummary"] = summary;
    }
    atomic_write(
        &PathBuf::from(dir).join("report.json"),
        serde_json::to_string_pretty(&report).unwrap().as_bytes(),
    )?;
    state.exit.store(true, Ordering::SeqCst);
    app.exit(if report["passed"] == true { 0 } else { 1 });
    Ok(())
}
#[tauri::command]
fn render_document(
    window: WebviewWindow,
    state: State<AppState>,
    content: String,
) -> Result<RenderedDocument, String> {
    let prefs = state.preferences.lock().unwrap().clone();
    let docs = state.docs.lock().unwrap();
    let doc = docs.get(window.label()).ok_or("文档已关闭")?;
    let name = doc.session.info().name;
    let base = doc
        .session
        .current_path()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .or_else(|| Some(PathBuf::from(prefs.text("htmlDefaultDirectoryUrl"))));
    drop(docs);
    let style = read_resource(&state, "Styles", prefs.text("htmlStyleName"));
    let mut rendered =
        macdown_core::render_with_preferences(&content, base.as_deref(), &name, &prefs, &style);
    let template = read_resource(&state, "Templates", prefs.text("htmlTemplateName"));
    if !template.is_empty() {
        let registry = handlebars::Handlebars::new();
        let title_tag = format!("<title>{}</title>", macdown_core::escape_html(&name));
        let html=registry.render_template(&template,&json!({"title":name,"titleTag":title_tag,"styleTags":[format!("<style>{style}</style>")],"body":rendered.body,"scriptTags":[]})).map_err(|e|format!("HTML 模板错误: {e}"))?;
        let csp="<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https:; font-src data: https:; script-src 'none'; base-uri 'none'\">";
        rendered.html = html.replacen("<head>", &format!("<head>{csp}"), 1);
    }
    Ok(rendered)
}
#[tauri::command]
async fn export_document(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    html: String,
) -> Result<Option<String>, String> {
    let current = state
        .docs
        .lock()
        .unwrap()
        .get(window.label())
        .map(|d| d.session.info())
        .ok_or("文档已关闭")?;
    let name = Path::new(&current.name)
        .with_extension("html")
        .to_string_lossy()
        .into_owned();
    let path = match app
        .dialog()
        .file()
        .add_filter("HTML", &["html"])
        .set_file_name(name)
        .blocking_save_file()
    {
        Some(p) => p.into_path().map_err(|e| e.to_string())?,
        None => return Ok(None),
    };
    if !current.path.is_empty()
        && fs::canonicalize(&path).ok() == fs::canonicalize(&current.path).ok()
    {
        return Err("不能用导出文件覆盖当前 Markdown 文档".into());
    }
    atomic_write(&path, html.as_bytes())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
#[tauri::command]
fn revert_document(window: WebviewWindow, state: State<AppState>) -> Result<Value, String> {
    let path = state
        .docs
        .lock()
        .unwrap()
        .get(window.label())
        .and_then(|d| d.session.current_path().map(Path::to_path_buf))
        .ok_or("当前文档尚未保存")?;
    let mut docs = state.docs.lock().unwrap();
    let doc = docs.get_mut(window.label()).unwrap();
    let loaded = doc.session.open(&path)?;
    doc.text = loaded.content;
    doc.dirty = false;
    drop(docs);
    native::document(&window, &path.to_string_lossy(), false);
    Ok(info(&window, &state))
}
#[tauri::command]
fn close_document(window: WebviewWindow, state: State<AppState>) -> Result<(), String> {
    state.docs.lock().unwrap().remove(window.label());
    let path = state.drafts.join(format!("{}.json", window.label()));
    let _ = fs::remove_file(path);
    window.destroy().map_err(|e| e.to_string())
}
#[tauri::command]
fn request_quit(app: AppHandle) {
    start_quit(&app)
}
#[tauri::command]
fn confirm_quit(app: AppHandle, state: State<AppState>, approved: bool) {
    if !approved {
        *state.quit.lock().unwrap() = None;
        return;
    }
    if let Some(q) = state.quit.lock().unwrap().as_mut() {
        q.pop_front();
    }
    continue_quit(&app)
}
#[tauri::command]
fn native_action(app: AppHandle, selector: String) {
    native::action(&app, &selector)
}
#[tauri::command]
fn clipboard_url() -> Option<String> {
    native::clipboard_url()
}
#[tauri::command]
async fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "https" | "http" | "mailto") {
        return Err("不支持此链接类型".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn open_relative(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    link: String,
) -> Result<(), String> {
    let base = state
        .docs
        .lock()
        .unwrap()
        .get(window.label())
        .and_then(|d| {
            d.session
                .current_path()
                .and_then(Path::parent)
                .map(Path::to_path_buf)
        })
        .ok_or("请先保存文档")?;
    let path = if link.starts_with("file:") {
        url::Url::parse(&link)
            .map_err(|e| e.to_string())?
            .to_file_path()
            .map_err(|_| "文件链接无效")?
    } else {
        base.join(link)
    };
    if !path.exists()
        && state
            .preferences
            .lock()
            .unwrap()
            .flag("createFileForLinkTarget")
    {
        atomic_write(&path, b"")?;
    }
    open_path(&app, &path)
}
#[tauri::command]
async fn preferences_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("preferences") {
        return w.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(
        &app,
        "preferences",
        WebviewUrl::App("index.html?preferences".into()),
    )
    .title("Preferences")
    .inner_size(760.0, 600.0)
    .resizable(false)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
async fn reveal_resources(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: String,
) -> Result<(), String> {
    if !["Styles", "Themes", "Templates", "PlugIns"].contains(&kind.as_str()) {
        return Err("未知目录".into());
    }
    let dir = state.directory.join(kind);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn choose_directory(app: AppHandle) -> Result<Option<String>, String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .map(|p| {
            p.into_path()
                .map(|p| p.to_string_lossy().into_owned())
                .map_err(|e| e.to_string())
        })
        .transpose()
}
#[tauri::command]
async fn print_document(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    html: String,
    pdf: bool,
) -> Result<(), String> {
    let path = if pdf {
        if let Some(dir) = std::env::var_os("MACDOWN_TEST_DIR") {
            Some(PathBuf::from(dir).join("preview.pdf"))
        } else {
            match app
                .dialog()
                .file()
                .add_filter("PDF", &["pdf"])
                .set_file_name("document.pdf")
                .blocking_save_file()
            {
                Some(p) => Some(p.into_path().map_err(|e| e.to_string())?),
                None => return Ok(()),
            }
        }
    } else {
        None
    };
    let id = format!("print-{}", state.serial.fetch_add(1, Ordering::SeqCst));
    let file = state.directory.join(format!("{id}.html"));
    let html = if pdf {
        html.replace("@media print", "@media all")
            .replace("@media screen", "@media not all")
    } else {
        html
    };
    let plain = regex::Regex::new(r"(?is)<script\b[^>]*>.*?</script>")
        .unwrap()
        .replace_all(&html, "")
        .to_string();
    atomic_write(&file, plain.as_bytes())?;
    let source = window.label().to_owned();
    let file_url = url::Url::from_file_path(&file).map_err(|_| "打印文件地址无效")?;
    WebviewWindowBuilder::new(&app, &id, WebviewUrl::External(file_url))
        .visible(false)
        .inner_size(800.0, 900.0)
        .on_page_load(move |w, p| {
            if p.event() == tauri::webview::PageLoadEvent::Finished {
                let window = w.clone();
                let path = path.clone();
                let source = source.clone();
                // WebKit must return from didFinishNavigation before a synchronous print
                // operation requests layout from the web process.
                tauri::async_runtime::spawn(async move {
                    let _ = tauri::async_runtime::spawn_blocking(|| {
                        std::thread::sleep(std::time::Duration::from_millis(150))
                    })
                    .await;
                    native::print(window, path, source);
                });
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn page_setup(app: AppHandle) {
    native::page_setup(&app)
}
#[tauri::command]
fn speech(state: State<AppState>, text: Option<String>) -> Result<(), String> {
    use std::io::Write;
    if let Some(mut child) = state.speech.lock().unwrap().take() {
        let _ = child.kill();
    }
    if let Some(text) = text {
        let mut child = std::process::Command::new("/usr/bin/say")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        child
            .stdin
            .take()
            .unwrap()
            .write_all(text.as_bytes())
            .map_err(|e| e.to_string())?;
        *state.speech.lock().unwrap() = Some(child);
    }
    Ok(())
}
#[tauri::command]
async fn install_cli(app: AppHandle) -> Result<Option<String>, String> {
    let Some(folder) = app
        .dialog()
        .file()
        .set_title("选择命令行工具安装目录")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = folder
        .into_path()
        .map_err(|e| e.to_string())?
        .join("macdown-rust");
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let script = format!(
        "#!/bin/sh\nexec '{}' \"$@\"\n",
        executable.to_string_lossy().replace('\'', "'\"'\"'")
    );
    atomic_write(&path, script.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    Ok(Some(path.to_string_lossy().into_owned()))
}
fn route(app: &AppHandle, action: &str) {
    if let Some(name) = action.strip_prefix("plugin:") {
        if !name.contains(['/', '\\']) {
            native::run_plugin(
                app,
                app.state::<AppState>().directory.join("PlugIns").join(name),
            );
        }
        return;
    }
    if let Some(index) = action
        .strip_prefix("recent:")
        .and_then(|v| v.parse::<usize>().ok())
    {
        let path = app
            .state::<AppState>()
            .recents
            .lock()
            .unwrap()
            .get(index)
            .cloned();
        if let Some(path) = path {
            if let Err(e) = open_path(app, Path::new(&path)) {
                if let Some(w) = app
                    .webview_windows()
                    .values()
                    .find(|w| w.is_focused().unwrap_or(false))
                {
                    let _ = w.emit("app-error", e);
                }
            }
        }
        return;
    }
    if action == "newDocument" {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = create_window(&app, Document::default());
        });
        return;
    }
    if action == "terminate" {
        start_quit(app);
        return;
    }
    if action == "showPreferencesWindow" {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = preferences_window(app).await;
        });
        return;
    }
    if action == "openDocument" {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = open_documents(app).await;
        });
        return;
    }
    if action == "clearRecentDocuments" {
        let state = app.state::<AppState>();
        state.recents.lock().unwrap().clear();
        let _ = atomic_write(&state.directory.join("recents.json"), b"[]");
        let _ = menu::rebuild(app);
        return;
    }
    if let Some(window) = app
        .webview_windows()
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
    {
        if window.label() == "preferences" && action == "performClose" {
            let _ = window.close();
        } else {
            let _ = window.emit("menu-action", action);
        }
    }
}
pub fn run() {
    if std::env::args().any(|a| a == "--help" || a == "-h") {
        println!("MacDown Rust 0.1.0\nUsage: macdown-rust [FILE ...]\n       macdown-rust -  (read standard input)");
        return;
    }
    if std::env::args().any(|a| a == "--version") {
        println!("MacDown Rust 0.1.0");
        return;
    }
    let piped: Option<String> = None;
    if std::env::args().any(|a| a == "-" || a == "--stdin") {
        use std::io::Read;
        let mut text = String::new();
        let _ = std::io::stdin().read_to_string(&mut text);
        // A second instance forwards file arguments, not stdin. Re-enter with a temporary
        // text file so stdin also reaches an already running application.
        let folder = std::env::temp_dir().join("MacDown-Rust-stdin");
        if let Err(e) = fs::create_dir_all(&folder) {
            eprintln!("{e}");
            return;
        }
        let filename = format!(
            "stdin-{}-{}.md",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let path = folder.join(filename);
        if let Err(e) = atomic_write(&path, text.as_bytes()) {
            eprintln!("{e}");
            return;
        }
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .arg(path)
            .status();
        if let Err(error) = status {
            eprintln!("{error}");
        }
        return;
    }
    let app=tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app,args,cwd|{for argument in args.iter().skip(1).filter(|s|!s.starts_with('-')){let path=Path::new(argument);let path=if path.is_absolute(){path.to_path_buf()}else{Path::new(&cwd).join(path)};if path.is_file(){let _=open_path(app,&path);}}}))
        .plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_opener::init())
        .on_page_load(|webview,event|{if std::env::var_os("MACDOWN_TEST_DIR").is_some(){eprintln!("native-smoke: page {:?} {}",event.event(),event.url());if event.event()==tauri::webview::PageLoadEvent::Finished&&webview.label()=="main"{let webview=webview.clone();tauri::async_runtime::spawn(async move{let _=tauri::async_runtime::spawn_blocking(||std::thread::sleep(std::time::Duration::from_secs(25))).await;let _=webview.eval("window.__TAURI_INTERNALS__.invoke('self_test_report',{report:{passed:false,diagnostic:{url:location.href,body:document.body.innerText.slice(0,1200),csp:document.querySelector('meta[http-equiv=\\\"Content-Security-Policy\\\"]')?.content,scripts:[...document.scripts].map(s=>s.src)}}})");});}}})
        .setup(move|app|{
            let test_dir=std::env::var_os("MACDOWN_TEST_DIR").map(PathBuf::from);let directory=test_dir.clone().unwrap_or(app.path().app_config_dir()?);let drafts=test_dir.map(|p|p.join("Drafts")).unwrap_or(app.path().app_cache_dir()?.join("Drafts"));fs::create_dir_all(&directory)?;fs::create_dir_all(&drafts)?;
            for kind in ["Styles","Themes","Templates","PlugIns"]{fs::create_dir_all(directory.join(kind))?;}
            for(kind,name,content)in RESOURCES{let ext=match *kind{"Styles"=>"css","Templates"=>"handlebars",_=>"style"};let path=directory.join(kind).join(format!("{name}.{ext}"));if !path.exists(){fs::write(path,content)?;}}
            let mut prefs=Preferences::default();if let Ok(text)=fs::read_to_string(directory.join("preferences.json")){if let Ok(values)=serde_json::from_str(&text){let _=prefs.merge(values);}}
            if prefs.text("htmlDefaultDirectoryUrl").is_empty(){if let Ok(home)=app.path().home_dir(){let _=prefs.set("htmlDefaultDirectoryUrl",json!(home.to_string_lossy()));}}
            let recents=fs::read_to_string(directory.join("recents.json")).ok().and_then(|v|serde_json::from_str::<Vec<String>>(&v).ok()).unwrap_or_default();
            let mut docs=HashMap::new();docs.insert("main".into(),Document::default());
            app.manage(AppState{docs:Mutex::new(docs),preferences:Mutex::new(prefs),recents:Mutex::new(recents),directory,drafts,serial:AtomicUsize::new(1),quit:Mutex::new(None),exit:AtomicBool::new(false),speech:Mutex::new(None)});
            let handle=app.handle().clone();menu::rebuild(&handle)?;if let Some(dir)=std::env::var_os("MACDOWN_TEST_DIR"){let plugin=PathBuf::from(dir).join("PlugIns/Smoke.bundle");if plugin.exists(){native::run_plugin(&handle,plugin);}}
            let state=app.state::<AppState>();let mut recover=Vec::new();let mut old_drafts=Vec::new();for entry in fs::read_dir(&state.drafts)?.flatten(){if let Ok(bytes)=fs::read(entry.path()){if let Ok(draft)=serde_json::from_slice::<Draft>(&bytes){old_drafts.push(entry.path());recover.push(Document{session:DocumentSession::restore(draft.path,draft.saved),text:draft.text,dirty:true});}}}
            if let Some(first)=recover.pop(){state.docs.lock().unwrap().insert("main".into(),first);}for doc in recover{let _=create_window(&handle,doc);}
            if !old_drafts.is_empty(){let docs=state.docs.lock().unwrap();for(label,doc)in docs.iter().filter(|(_,d)|d.dirty){let draft=Draft{path:doc.session.current_path().map(Path::to_path_buf),saved:doc.session.info().content,text:doc.text.clone()};atomic_write(&state.drafts.join(format!("{label}.json")),&serde_json::to_vec(&draft)?)?;}for path in old_drafts{let keep=path.file_stem().and_then(|s|s.to_str()).is_some_and(|label|docs.contains_key(label));if !keep{let _=fs::remove_file(path);}}}
            if let Some(text)=&piped{state.docs.lock().unwrap().insert("main".into(),Document{session:DocumentSession::default(),text:text.clone(),dirty:true});}
            for path in std::env::args().skip(1).filter(|s|!s.starts_with('-')){if Path::new(&path).is_file(){let _=open_path(&handle,Path::new(&path));}}
            if state.preferences.lock().unwrap().flag("supressesUntitledDocumentOnLaunch")&&piped.is_none(){let empty=state.docs.lock().unwrap().get("main").is_some_and(|d|d.text.is_empty()&&d.session.current_path().is_none());if empty{if let Some(window)=handle.get_webview_window("main"){let _=window.hide();}}}
            Ok(())
        }).on_menu_event(|app,event|route(app,event.id().as_ref()))
        .on_window_event(|window,event|{if let tauri::WindowEvent::CloseRequested{api,..}=event{if window.label().starts_with("print-")||window.label()=="preferences"{return;}api.prevent_close();let _=window.emit("menu-action","performClose");}})
        .on_webview_event(|webview,event|{if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop{paths,..})=event{for path in paths{if let Err(error)=open_path(webview.app_handle(),path){let _=webview.emit("app-error",error);}}}})
        .invoke_handler(tauri::generate_handler![bootstrap,get_resource,set_preferences,new_document,show_help,open_documents,save_document,update_document,mark_document,self_test_report,render_document,export_document,revert_document,close_document,request_quit,confirm_quit,native_action,clipboard_url,open_external,open_relative,preferences_window,reveal_resources,choose_directory,print_document,page_setup,speech,install_cli])
        .build(tauri::generate_context!()).expect("Unable to start MacDown Rust");
    app.run(|app, event| match event {
        tauri::RunEvent::ExitRequested { api, .. } => {
            if !app.state::<AppState>().exit.load(Ordering::SeqCst) {
                api.prevent_exit();
                start_quit(app);
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            for u in urls {
                if let Ok(path) = u.to_file_path() {
                    let _ = open_path(app, &path);
                }
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            let _ = create_window(app, Document::default());
        }
        _ => {}
    });
}
