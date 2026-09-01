use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct UndoAction {
    pub path: String,
    pub old_rating: Option<String>,
}

impl AppState {
    pub fn undo_last_rating(&self) -> AppResult<Option<String>> {
        // Peek first: the entry is only consumed once the DB write succeeds,
        // so a failed undo no longer silently eats the stack (KB bug #4).
        let Some(u) = self.undo_peek() else { return Ok(None) };
        let (db, pid) = self.db_and_pid().ok_or_else(|| AppError::msg("No active project database."))?;
        let record = db
            .get_image_by_path(pid, &u.path)
            ?
            .ok_or_else(|| AppError::msg("Image not found."))?;
        db.set_rating(record.id, u.old_rating.as_deref())
            ?;
        self.undo_pop();
        Ok(Some(u.path))
    }
}
