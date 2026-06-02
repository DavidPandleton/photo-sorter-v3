use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct UndoAction {
    pub path: String,
    pub old_rating: Option<String>,
}

impl AppState {
    pub fn undo_last_rating(&self) -> Result<Option<String>, String> {
        let mut stack = self.undo_stack.write().unwrap();
        let undo = stack.pop();
        if undo.is_none() { return Ok(None); }
        let u = undo.unwrap();
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
            let record = db.get_image_by_path(*pid, &u.path)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Image not found.".to_string())?;
            db.set_rating(record.id, u.old_rating.as_deref()).map_err(|e| e.to_string())?;
            let mut results_map = self.results.write().unwrap();
            if let Some(ref r) = u.old_rating { results_map.insert(u.path.clone(), r.clone()); }
            else { results_map.remove(&u.path); }
            Ok(Some(u.path))
        } else { Err("No active project database.".to_string()) }
    }
}
