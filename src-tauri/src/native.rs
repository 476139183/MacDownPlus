use tauri::{AppHandle, Manager, WebviewWindow};
#[cfg(target_os = "macos")]
pub fn document(window: &WebviewWindow, path: &str, dirty: bool) {
    let window = window.clone();
    let path = path.to_owned();
    let _ = window.clone().run_on_main_thread(move || unsafe {
        if let Ok(pointer) = window.ns_window() {
            let native = &*(pointer as *const objc2_app_kit::NSWindow);
            native.setDocumentEdited(dirty);
            native.setRepresentedFilename(&objc2_foundation::NSString::from_str(&path));
        }
    });
}
#[cfg(not(target_os = "macos"))]
pub fn document(_: &WebviewWindow, _: &str, _: bool) {}

#[cfg(target_os = "macos")]
pub fn action(app: &AppHandle, selector: &str) {
    let name = selector.to_owned();
    let _ = app.run_on_main_thread(move || unsafe {
        use objc2::{runtime::Sel, MainThreadMarker};
        use objc2_app_kit::NSApplication;
        if let (Some(main), Ok(name)) = (
            MainThreadMarker::new(),
            std::ffi::CString::new(format!("{name}:")),
        ) {
            let application = NSApplication::sharedApplication(main);
            let _ = application.sendAction_to_from(Sel::register(&name), None, None);
        }
    });
}
#[cfg(not(target_os = "macos"))]
pub fn action(_: &AppHandle, _: &str) {}

pub fn clipboard_url() -> Option<String> {
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
        let text = NSPasteboard::generalPasteboard()
            .stringForType(NSPasteboardTypeString)?
            .to_string();
        let url = url::Url::parse(text.trim()).ok()?;
        return Some(url.to_string());
    }
    #[cfg(not(target_os = "macos"))]
    None
}

pub fn print(window: WebviewWindow, pdf: Option<std::path::PathBuf>, source: String) {
    let app = window.app_handle().clone();
    let callback_window = window.clone();
    let _ = window.with_webview(move |webview| {
        #[cfg(target_os = "macos")]
        unsafe {
            use objc2::{msg_send, rc::Retained};
            use objc2_app_kit::NSPrintInfo;
            let view = &*(webview.inner() as *const objc2_web_kit::WKWebView);
            if let Some(path) = pdf {
                crate::pdf::export(view, callback_window.clone(), path, source.clone());
                return;
            }
            let info: Retained<NSPrintInfo> = msg_send![&*NSPrintInfo::sharedPrintInfo(), copy];
            let operation = view.printOperationWithPrintInfo(&info);
            operation.setShowsPrintPanel(true);
            operation.setShowsProgressPanel(false);
            let success = operation.runOperation();
            if let Some(source) = app.get_webview_window(&source) {
                use tauri::Emitter;
                let _ = source.emit("print-result", success);
            }
        }
        let _ = callback_window.destroy();
    });
}

#[cfg(target_os = "macos")]
pub fn page_setup(app: &AppHandle) {
    let _ = app.run_on_main_thread(|| {
        if let Some(main) = objc2::MainThreadMarker::new() {
            let panel = objc2_app_kit::NSPageLayout::pageLayout(main);
            panel.runModalWithPrintInfo(&objc2_app_kit::NSPrintInfo::sharedPrintInfo());
        }
    });
}
#[cfg(not(target_os = "macos"))]
pub fn page_setup(_: &AppHandle) {}

#[cfg(target_os = "macos")]
thread_local! {static PLUGINS:std::cell::RefCell<std::collections::HashMap<std::path::PathBuf,objc2::rc::Retained<objc2::runtime::AnyObject>>>=std::cell::RefCell::new(std::collections::HashMap::new());}
/// Public MacDown plug-in protocol: init, optional name/plugInDidInitialize, run: -> BOOL.
#[cfg(target_os = "macos")]
pub fn run_plugin(app: &AppHandle, path: std::path::PathBuf) {
    let handle = app.clone();
    let _=app.run_on_main_thread(move||{
        let result=(||->Result<(),String>{unsafe{
            use objc2::{msg_send,sel,rc::Retained,runtime::{AnyObject,Bool}};use objc2_foundation::{NSBundle,NSString};
            let plugin=PLUGINS.with(|plugins|->Result<Retained<AnyObject>,String>{
                let mut plugins=plugins.borrow_mut();if let Some(plugin)=plugins.get(&path){return Ok(plugin.clone());}
                let bundle=NSBundle::bundleWithPath(&NSString::from_str(&path.to_string_lossy())).ok_or("插件不是有效的 macOS bundle")?;
                bundle.loadAndReturnError().map_err(|e|format!("插件加载失败（请检查 arm64 架构）: {e}"))?;
                let class=bundle.principalClass().ok_or("插件没有 principal class")?;
                let allocated:*mut AnyObject=msg_send![class,alloc];let initialized:*mut AnyObject=msg_send![allocated,init];let object=Retained::from_raw(initialized).ok_or("插件初始化失败")?;
                let responds:Bool=msg_send![&*object,respondsToSelector:sel!(plugInDidInitialize)];if responds.as_bool(){let _:()=msg_send![&*object,plugInDidInitialize];}
                plugins.insert(path.clone(),object.clone());Ok(object)
            })?;
            let responds:Bool=msg_send![&*plugin,respondsToSelector:sel!(run:)];if !responds.as_bool(){return Err("插件没有实现 run: 方法".into());}
            let name=path.file_stem().unwrap_or_default().to_string_lossy();let title=NSString::from_str(&name);let empty=NSString::from_str("");
            let allocated:*mut objc2_app_kit::NSMenuItem=msg_send![objc2::class!(NSMenuItem),alloc];let initialized:*mut objc2_app_kit::NSMenuItem=msg_send![allocated,initWithTitle:&*title,action:None::<objc2::runtime::Sel>,keyEquivalent:&*empty];let item=Retained::from_raw(initialized).ok_or("无法创建插件菜单项")?;
            let success:Bool=msg_send![&*plugin,run:&*item];if !success.as_bool(){return Err("插件报告执行失败".into());}Ok(())
        }})();if let Err(error)=result{use tauri::Emitter;let _=handle.emit("app-error",error);}
    });
}
#[cfg(not(target_os = "macos"))]
pub fn run_plugin(_: &AppHandle, _: std::path::PathBuf) {}
