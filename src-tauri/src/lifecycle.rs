//! File events can precede Tauri Ready, including LaunchServices and a second process.
use std::{path::PathBuf, sync::Mutex};
#[derive(Default)]
pub struct OpenRequests(Mutex<OpenPhase>);
#[derive(Default)]
enum OpenPhase {
    #[default]
    Starting,
    Queued(Vec<PathBuf>),
    Ready,
}
impl OpenRequests {
    pub fn submit(&self, path: PathBuf) -> Option<PathBuf> {
        let mut phase = self.0.lock().unwrap();
        match &mut *phase {
            OpenPhase::Starting => {
                *phase = OpenPhase::Queued(vec![path]);
                None
            }
            OpenPhase::Queued(paths) => {
                paths.push(path);
                None
            }
            OpenPhase::Ready => Some(path),
        }
    }
    pub fn ready(&self) -> Vec<PathBuf> {
        match std::mem::replace(&mut *self.0.lock().unwrap(), OpenPhase::Ready) {
            OpenPhase::Queued(paths) => paths,
            _ => Vec::new(),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_files_are_retained_until_ready() {
        let queue = OpenRequests::default();
        assert!(queue.submit("中文.md".into()).is_none());
        assert!(queue.submit("second.md".into()).is_none());
        assert_eq!(
            queue.ready(),
            vec![PathBuf::from("中文.md"), PathBuf::from("second.md")]
        );
        assert!(queue.ready().is_empty());
        assert_eq!(queue.submit("later.md".into()), Some("later.md".into()));
    }
}
