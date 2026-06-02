use std::path::Path;
use crate::state::AppState;

impl AppState {
    pub fn apply_filters(&self) {
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        if db_opt.is_none() || pid_opt.is_none() { return; }
        let db = db_opt.as_ref().unwrap();
        let pid = pid_opt.unwrap();

        let filter_date_val = self.filter_date.read().unwrap().clone();
        let filter_text_val = self.filter_text.read().unwrap().clone();
        let filter_folder_val = self.filter_folder.read().unwrap().clone().replace('\\', "/");
        let filter_mode_val = self.filter_mode.read().unwrap().clone();

        let all_images = if !filter_date_val.is_empty() {
            db.get_images_by_date(pid, &filter_date_val).unwrap_or_default()
        } else {
            db.get_images(pid).unwrap_or_default()
        };

        let results_map = self.results.read().unwrap();
        let mut filtered_paths = Vec::new();
        for img in all_images {
            let path_lower = img.path.to_lowercase();
            if !filter_text_val.is_empty() && !path_lower.contains(&filter_text_val.to_lowercase()) { continue; }
            if !filter_folder_val.is_empty() && !path_lower.starts_with(&filter_folder_val.to_lowercase()) { continue; }
            if filter_mode_val == "unrated" && results_map.contains_key(&img.path) { continue; }
            filtered_paths.push(img.path);
        }
        filtered_paths.sort_by(|a, b| {
            let fa = Path::new(a).file_name().unwrap_or_default();
            let fb = Path::new(b).file_name().unwrap_or_default();
            fa.cmp(fb)
        });

        let mut paths_lock = self.image_paths.write().unwrap();
        *paths_lock = filtered_paths;
        let mut idx_lock = self.current_index.write().unwrap();
        if *idx_lock >= paths_lock.len() as i32 {
            *idx_lock = (paths_lock.len() as i32 - 1).max(0);
        }
    }
}
