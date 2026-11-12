//! Document state and exit approvals are independent of windows and native dialogs.
use macdown_core::DocumentSession;
use std::collections::HashMap;
#[derive(Default)]
pub struct Document {
    pub session: DocumentSession,
    pub text: String,
}
impl Document {
    pub fn dirty(&self) -> bool {
        self.text != self.session.saved_text()
    }
    pub fn allows_close(&self, approved: &str) -> bool {
        self.text == approved
    }
}
#[derive(Default)]
pub struct QuitReview {
    approved: HashMap<String, String>,
    active: Option<String>,
}
impl QuitReview {
    pub fn next(&mut self, documents: &[(String, String)]) -> Option<String> {
        let next = documents
            .iter()
            .find(|(label, text)| self.approved.get(label) != Some(text))
            .map(|(label, _)| label.clone());
        self.active = next.clone();
        next
    }
    pub fn confirm(&mut self, label: &str, content: String) -> bool {
        if self.active.as_deref() != Some(label) {
            return false;
        }
        self.approved.insert(label.into(), content);
        self.active = None;
        true
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn changed_and_new_documents_require_another_exit_confirmation() {
        let mut q = QuitReview::default();
        let mut docs = vec![("one".into(), "old".into()), ("two".into(), "text".into())];
        assert_eq!(q.next(&docs), Some("one".into()));
        assert!(q.confirm("one", "old".into()));
        assert_eq!(q.next(&docs), Some("two".into()));
        assert!(!q.confirm("one", "wrong".into()));
        assert!(q.confirm("two", "text".into()));
        assert_eq!(q.next(&docs), None);
        docs[0].1 = "new edits".into();
        assert_eq!(q.next(&docs), Some("one".into()));
        assert!(q.confirm("one", "new edits".into()));
        docs.push(("three".into(), "new document".into()));
        assert_eq!(q.next(&docs), Some("three".into()));
    }
    #[test]
    fn close_approval_cannot_discard_later_edits() {
        let mut d = Document::default();
        d.text = "approved text".into();
        assert!(d.allows_close("approved text"));
        d.text.push_str(" new input");
        assert!(!d.allows_close("approved text"));
        assert!(d.dirty());
    }
}
