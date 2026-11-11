//! Asynchronous, paper-sized PDF export for WKWebView.
//! Keeps PDF generation off NSPrintOperation's blocking web-process handshake.
use objc2::{rc::Retained, AnyThread, MainThreadMarker};
use objc2_foundation::{NSData, NSError, NSPoint, NSRect, NSSize, NSString};
use objc2_pdf_kit::{PDFDisplayBox, PDFDocument};
use objc2_web_kit::{WKPDFConfiguration, WKWebView};
use std::{path::PathBuf, rc::Rc};
use tauri::{Emitter, Manager, WebviewWindow};

#[derive(Clone, Copy)]
struct Paper {
    width: f64,
    height: f64,
    left: f64,
    top: f64,
    content_width: f64,
    content_height: f64,
}
struct Job {
    view: Retained<WKWebView>,
    document: Retained<PDFDocument>,
    window: WebviewWindow,
    source: String,
    path: PathBuf,
    paper: Paper,
    breaks: Vec<f64>,
}
fn finish(job: &Job, result: Result<(), String>) {
    let app = job.window.app_handle();
    if let Some(source) = app.get_webview_window(&job.source) {
        let _ = source.emit("print-result", result.is_ok());
        if let Err(error) = result {
            let _ = source.emit("app-error", error);
        }
    }
    let _ = job.window.destroy();
}
fn fail(window: &WebviewWindow, source: &str, message: &str) {
    if let Some(source) = window.app_handle().get_webview_window(source) {
        let _ = source.emit("print-result", false);
        let _ = source.emit("app-error", message);
    }
    let _ = window.destroy();
}
fn page(job: Rc<Job>, index: usize) {
    unsafe {
        let top = job.breaks[index];
        let height = job.breaks[index + 1] - top;
        let config = WKPDFConfiguration::new(MainThreadMarker::new().unwrap());
        config.setRect(NSRect::new(
            NSPoint::new(0., top),
            NSSize::new(job.paper.content_width, height),
        ));
        let next = job.clone();
        let completed = block2::RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
            if !error.is_null() || data.is_null() {
                finish(&next, Err("WebKit PDF 页面生成失败".into()));
                return;
            }
            let Some(document) = PDFDocument::initWithData(PDFDocument::alloc(), &*data) else {
                finish(&next, Err("PDF 页面数据无效".into()));
                return;
            };
            let Some(page) = document.pageAtIndex(0) else {
                finish(&next, Err("PDF 页面缺失".into()));
                return;
            };
            // Expand the page around the captured content to retain the configured
            // paper dimensions and margins, including a shorter final page.
            let bounds = NSRect::new(
                NSPoint::new(
                    -next.paper.left,
                    height + next.paper.top - next.paper.height,
                ),
                NSSize::new(next.paper.width, next.paper.height),
            );
            page.setBounds_forBox(bounds, PDFDisplayBox::MediaBox);
            page.setBounds_forBox(bounds, PDFDisplayBox::CropBox);
            next.document.insertPage_atIndex(&page, index);
            if index + 2 < next.breaks.len() {
                page_next(next.clone(), index + 1);
            } else {
                let result = next
                    .document
                    .dataRepresentation()
                    .ok_or_else(|| "PDF 合并失败".to_owned())
                    .and_then(|data| macdown_core::atomic_write(&next.path, &data.to_vec()));
                finish(&next, result);
            }
        });
        job.view
            .createPDFWithConfiguration_completionHandler(Some(&config), &completed);
    }
}
// Distinct name avoids shadowing the local PDFPage in the completion block.
fn page_next(job: Rc<Job>, index: usize) {
    page(job, index)
}
pub unsafe fn export(view: &WKWebView, window: WebviewWindow, path: PathBuf, source: String) {
    let info = objc2_app_kit::NSPrintInfo::sharedPrintInfo();
    let size = info.paperSize();
    let paper = Paper {
        width: size.width,
        height: size.height,
        left: info.leftMargin(),
        top: info.topMargin(),
        content_width: (size.width - info.leftMargin() - info.rightMargin()).max(120.),
        content_height: (size.height - info.topMargin() - info.bottomMargin()).max(120.),
    };
    let view = Retained::retain(view as *const _ as *mut WKWebView).unwrap();
    view.setFrameSize(NSSize::new(paper.content_width, 900.));
    // Keep small semantic blocks together, as the original print styles do for
    // tables and preformatted code; large blocks may span more than one page.
    let script = format!(
        r#"(()=>{{const limit={};const total=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);const blocks=[...document.querySelectorAll('p,pre,table,blockquote,img,svg,h1,h2,h3,h4,h5,h6')].map(e=>{{const r=e.getBoundingClientRect();return {{top:r.top+scrollY,bottom:r.bottom+scrollY,height:r.height}};}});const breaks=[0];let offset=0;while(offset<total){{let end=Math.min(total,offset+limit);for(const b of blocks)if(b.top>offset+1&&b.top<end&&b.bottom>end&&b.height<=limit)end=Math.min(end,b.top);if(end<=offset+1)end=Math.min(total,offset+limit);breaks.push(end);offset=end;}}return JSON.stringify({{total,breaks}});}})()"#,
        paper.content_height
    );
    let callback_view = view.clone();
    let measured = block2::RcBlock::new(
        move |value: *mut objc2::runtime::AnyObject, error: *mut NSError| {
            if !error.is_null() || value.is_null() {
                fail(&window, &source, "无法计算 PDF 页面布局");
                return;
            }
            let text = &*(value as *mut NSString);
            let layout: serde_json::Value = match serde_json::from_str(&text.to_string()) {
                Ok(value) => value,
                Err(_) => {
                    fail(&window, &source, "PDF 布局数据无效");
                    return;
                }
            };
            let total = layout["total"].as_f64().unwrap_or(900.);
            callback_view.setFrameSize(NSSize::new(paper.content_width, total.max(900.)));
            let breaks = layout["breaks"]
                .as_array()
                .map(|a| a.iter().filter_map(|n| n.as_f64()).collect::<Vec<_>>())
                .unwrap_or_else(|| vec![0., total]);
            let job = Rc::new(Job {
                view: callback_view.clone(),
                document: PDFDocument::new(),
                window: window.clone(),
                source: source.clone(),
                path: path.clone(),
                paper,
                breaks,
            });
            page(job, 0);
        },
    );
    view.evaluateJavaScript_completionHandler(&NSString::from_str(&script), Some(&measured));
}
pub fn summary(path: &std::path::Path) -> Option<serde_json::Value> {
    unsafe {
        let bytes = std::fs::read(path).ok()?;
        let data = NSData::with_bytes(&bytes);
        let document = PDFDocument::initWithData(PDFDocument::alloc(), &data)?;
        let first = document.pageAtIndex(0)?;
        let bounds = first.boundsForBox(PDFDisplayBox::MediaBox);
        Some(
            serde_json::json!({"pages":document.pageCount(),"width":bounds.size.width,"height":bounds.size.height,"containsEnd":document.string().map(|s|s.to_string().contains("END OF DOCUMENT")).unwrap_or(false)}),
        )
    }
}
