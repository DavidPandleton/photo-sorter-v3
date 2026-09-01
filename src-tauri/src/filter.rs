use std::path::Path;
use crate::state::AppState;

impl AppState {
    pub fn apply_filters(&self) {
        let Some((db, pid)) = self.db_and_pid() else { return };
        let (filter_text_val, filter_folder_val, filter_date_val, filter_mode_val) = self.filter_values();
        let filter_folder_val = filter_folder_val.replace('\\', "/");

        let all_images = if !filter_date_val.is_empty() {
            db.get_images_by_date(pid, &filter_date_val).unwrap_or_default()
        } else {
            db.get_images(pid).unwrap_or_default()
        };

        // "unrated" mode consults the DB directly; there is no in-memory
        // results map anymore (KB bug #5: three sources of truth).
        let rated = if filter_mode_val == "unrated" {
            self.rated_paths()
        } else {
            Default::default()
        };

        let mut filtered_paths = Vec::new();
        for img in all_images {
            let path_lower = img.path.to_lowercase();
            if !filter_text_val.is_empty() && !path_lower.contains(&filter_text_val.to_lowercase()) { continue; }
            if !filter_folder_val.is_empty() && !path_lower.starts_with(&filter_folder_val.to_lowercase()) { continue; }
            if filter_mode_val == "unrated" && rated.contains(&img.path) { continue; }
            filtered_paths.push(img.path);
        }
        filtered_paths.sort_by(|a, b| {
            let fa = Path::new(a).file_name().unwrap_or_default();
            let fb = Path::new(b).file_name().unwrap_or_default();
            fa.cmp(fb)
        });

        self.set_filtered_paths(filtered_paths);
    }
}
