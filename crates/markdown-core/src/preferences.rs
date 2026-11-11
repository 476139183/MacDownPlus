use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Preferences(pub BTreeMap<String, Value>);
impl Default for Preferences {
    fn default() -> Self {
        serde_json::from_str(include_str!("defaults.json")).expect("valid built-in preferences")
    }
}
impl Preferences {
    pub fn flag(&self, key: &str) -> bool {
        self.0.get(key).and_then(Value::as_bool).unwrap_or(false)
    }
    pub fn number(&self, key: &str) -> f64 {
        self.0.get(key).and_then(Value::as_f64).unwrap_or(0.0)
    }
    pub fn text(&self, key: &str) -> &str {
        self.0.get(key).and_then(Value::as_str).unwrap_or("")
    }
    pub fn set(&mut self, key: &str, value: Value) -> Result<(), String> {
        let defaults = Self::default();
        let default = defaults.0.get(key).ok_or("未知偏好设置")?;
        if (default.is_boolean() && !value.is_boolean())
            || (default.is_string() && !value.is_string())
            || (default.is_number()
                && (!value.is_number() || !value.as_f64().is_some_and(f64::is_finite)))
            || (default.is_object() && !value.is_object())
        {
            return Err("偏好设置类型不正确".into());
        }
        if default.is_number() && !(0.0..=5000.0).contains(&value.as_f64().unwrap_or(-1.0)) {
            return Err("偏好设置数值超出范围".into());
        }
        self.0.insert(key.into(), value);
        Ok(())
    }
    pub fn merge(&mut self, values: BTreeMap<String, Value>) -> Result<(), String> {
        let mut next = self.clone();
        for (k, v) in values {
            next.set(&k, v)?;
        }
        *self = next;
        Ok(())
    }
}
