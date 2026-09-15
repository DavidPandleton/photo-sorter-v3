use serde::ser::Serializer;

/// One error type across the backend (KB structural bug #19: everything was
/// Result<_, String> with ad-hoc map_err(|e| e.to_string()) everywhere).
/// Serialized as a plain string over IPC so the frontend's existing
/// `catch (err) -> showToast(err)` keeps working unchanged.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Db(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Msg(String),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }
}

impl serde::Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_display_string() {
        let e = AppError::msg("No active project database found.");
        let json = serde_json::to_string(&e).unwrap();
        assert_eq!(json, "\"No active project database found.\"");
    }

    #[test]
    fn db_error_converts_and_displays() {
        let io = std::io::Error::new(std::io::ErrorKind::NotFound, "gone");
        let e: AppError = io.into();
        assert!(e.to_string().contains("gone"));
    }
}
