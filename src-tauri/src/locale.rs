//! macOS language preference selection and the shared upstream localization catalog.
use serde::Deserialize;
use std::{collections::BTreeMap, sync::OnceLock};
include!(concat!(env!("OUT_DIR"), "/locales.rs"));
#[derive(Deserialize, Default)]
struct Catalog {
    #[serde(default)]
    menu: BTreeMap<String, String>,
    #[serde(default)]
    messages: BTreeMap<String, String>,
}
fn catalogs() -> &'static BTreeMap<String, Catalog> {
    static CATALOGS: OnceLock<BTreeMap<String, Catalog>> = OnceLock::new();
    CATALOGS.get_or_init(|| {
        LOCALES
            .iter()
            .map(|(name, data)| {
                (
                    name.to_string(),
                    serde_json::from_str(data).expect("valid locale catalog"),
                )
            })
            .collect()
    })
}
pub fn resolve(preferred: &[String]) -> String {
    for language in preferred {
        let tag = language.replace('_', "-");
        let language =
            if tag.starts_with("zh-TW") || tag.starts_with("zh-HK") || tag.starts_with("zh-MO") {
                "zh-Hant"
            } else if tag.starts_with("zh-CN") || tag.starts_with("zh-SG") {
                "zh-Hans"
            } else {
                tag.as_str()
            };
        if catalogs().contains_key(language) {
            return language.into();
        }
        let mut shortened = language.to_owned();
        while let Some((head, _)) = shortened.rsplit_once('-') {
            shortened = head.to_owned();
            if catalogs().contains_key(&shortened) {
                return shortened;
            }
        }
        let base = language.split('-').next().unwrap_or("en");
        if let Some(name) = catalogs()
            .keys()
            .find(|name| name.split('-').next() == Some(base))
        {
            return name.clone();
        }
    }
    "en".into()
}
pub fn selected() -> &'static str {
    static LANGUAGE: OnceLock<String> = OnceLock::new();
    LANGUAGE.get_or_init(|| {
        #[cfg(target_os = "macos")]
        let preferred = {
            use objc2_foundation::{NSLocale, NSString, NSUserDefaults};
            NSUserDefaults::standardUserDefaults()
                .stringArrayForKey(&NSString::from_str("AppleLanguages"))
                .unwrap_or_else(NSLocale::preferredLanguages)
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        };
        #[cfg(not(target_os = "macos"))]
        let preferred = vec!["en".into()];
        resolve(&preferred)
    })
}
pub fn messages() -> BTreeMap<String, String> {
    let mut result = catalogs()
        .get("en")
        .map(|c| c.messages.clone())
        .unwrap_or_default();
    if let Some(catalog) = catalogs().get(selected()) {
        result.extend(catalog.messages.clone());
    }
    result
}
pub fn text(key: &str) -> String {
    catalogs()
        .get(selected())
        .and_then(|c| c.messages.get(key))
        .or_else(|| catalogs().get("en").and_then(|c| c.messages.get(key)))
        .cloned()
        .unwrap_or_else(|| key.into())
}
pub fn menu(id: &str, fallback: &str) -> String {
    catalogs()
        .get(selected())
        .and_then(|c| c.menu.get(id))
        .cloned()
        .unwrap_or_else(|| fallback.into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn follows_preference_order_and_chinese_script_regions() {
        for (tags, expected) in [
            (vec!["zh-Hans-CN"], "zh-Hans"),
            (vec!["zh-TW"], "zh-Hant"),
            (vec!["zh-Hant-HK"], "zh-Hant"),
            (vec!["en-GB"], "en"),
            (vec!["ja-JP"], "ja"),
            (vec!["xx-ZZ", "fr-CA"], "fr"),
            (vec!["xx"], "en"),
        ] {
            assert_eq!(
                resolve(&tags.into_iter().map(str::to_owned).collect::<Vec<_>>()),
                expected
            );
        }
    }
    #[test]
    fn localized_menus_keep_the_same_action_identity() {
        let zh = &catalogs()["zh-Hans"];
        assert_eq!(zh.menu["5QF-Oa-p0T"], "编辑");
        assert!(zh.messages["Save"].contains("保存"));
        assert!(catalogs()["zh-Hant"].messages["Save"].contains("儲存"));
    }
}
