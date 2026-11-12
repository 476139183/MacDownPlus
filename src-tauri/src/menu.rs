use serde::Deserialize;
use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Manager, Wry,
};
#[derive(Deserialize)]
struct Entry {
    #[serde(default)]
    separator: bool,
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    action: String,
    #[serde(default)]
    shortcut: String,
    children: Option<Vec<Entry>>,
}
fn item(app: &AppHandle, e: &Entry, recents: &[String]) -> tauri::Result<Box<dyn IsMenuItem<Wry>>> {
    let title = crate::locale::menu(&e.id, &e.title);
    if e.separator {
        return Ok(Box::new(PredefinedMenuItem::separator(app)?));
    }
    if e.title == "Services" {
        return Ok(Box::new(PredefinedMenuItem::services(app, Some(&title))?));
    }
    if let Some(children) = &e.children {
        let submenu = Submenu::with_id(app, &e.id, &title, true)?;
        if e.title == "Open Recent" {
            for (i, path) in recents.iter().enumerate() {
                submenu.append(&MenuItem::with_id(
                    app,
                    format!("recent:{i}"),
                    path,
                    true,
                    None::<&str>,
                )?)?;
            }
        }
        for child in children {
            submenu.append(&*item(app, child, recents)?)?;
        }
        if e.title == "Format" {
            submenu.append(&PredefinedMenuItem::separator(app)?)?;
            for (id, label) in [
                ("textColor", "Text color"),
                ("backgroundColor", "Background color"),
                ("clearColors", "Clear colors"),
            ] {
                submenu.append(&MenuItem::with_id(
                    app,
                    id,
                    crate::locale::text(label),
                    true,
                    None::<&str>,
                )?)?;
            }
        }
        if e.title == "Plug-ins" {
            let state = app.state::<crate::AppState>();
            if let Ok(entries) = std::fs::read_dir(state.directory.join("PlugIns")) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path
                        .extension()
                        .is_some_and(|x| x == "plugin" || x == "bundle")
                    {
                        let name = path.file_name().unwrap().to_string_lossy();
                        submenu.append(&MenuItem::with_id(
                            app,
                            format!("plugin:{name}"),
                            path.file_stem().unwrap().to_string_lossy(),
                            true,
                            None::<&str>,
                        )?)?;
                    }
                }
            }
            submenu.append(&MenuItem::with_id(
                app,
                "plugins",
                crate::locale::text("Manage Plug-ins…"),
                true,
                None::<&str>,
            )?)?;
        }
        return Ok(Box::new(submenu));
    }
    let native = match e.action.as_str() {
        "undo" => Some(PredefinedMenuItem::undo(app, Some(&title))?),
        "redo" => Some(PredefinedMenuItem::redo(app, Some(&title))?),
        "cut" => Some(PredefinedMenuItem::cut(app, Some(&title))?),
        "copy" => Some(PredefinedMenuItem::copy(app, Some(&title))?),
        "paste" => Some(PredefinedMenuItem::paste(app, Some(&title))?),
        "selectAll" => Some(PredefinedMenuItem::select_all(app, Some(&title))?),
        "hide" => Some(PredefinedMenuItem::hide(app, Some(&title))?),
        "hideOtherApplications" => Some(PredefinedMenuItem::hide_others(app, Some(&title))?),
        "unhideAllApplications" => Some(PredefinedMenuItem::show_all(app, Some(&title))?),
        "performMiniaturize" => Some(PredefinedMenuItem::minimize(app, Some(&title))?),
        "performZoom" => Some(PredefinedMenuItem::maximize(app, Some(&title))?),
        _ => None,
    };
    if let Some(native) = native {
        return Ok(Box::new(native));
    }
    if e.title == "Services" {
        return Ok(Box::new(PredefinedMenuItem::services(app, Some(&title))?));
    }
    let id = if e.action.is_empty() {
        e.id.clone()
    } else {
        e.action.clone()
    };
    Ok(Box::new(MenuItem::with_id(
        app,
        id,
        &title,
        true,
        if e.shortcut.is_empty() {
            None
        } else {
            Some(e.shortcut.as_str())
        },
    )?))
}
pub fn rebuild(app: &AppHandle) -> tauri::Result<()> {
    let entries: Vec<Entry> =
        serde_json::from_str(include_str!("../resources/menu.json")).expect("menu baseline");
    let recent = app
        .state::<crate::AppState>()
        .recents
        .lock()
        .unwrap()
        .clone();
    let menu = Menu::new(app)?;
    for e in entries {
        menu.append(&*item(app, &e, &recent)?)?;
    }
    app.set_menu(menu)?;
    Ok(())
}
