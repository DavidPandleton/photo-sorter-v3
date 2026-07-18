use std::collections::HashMap;
use std::path::Path;
use std::fs;
use crate::state::AppState;

impl AppState {
    // ponytail: no checkpoint system (YAGNI) — just move files, no undo manifest
    pub fn finish_sorting(&self) -> Result<(usize, HashMap<String, usize>), String> {
        let results_map = self.results.read().unwrap().clone();
        if results_map.is_empty() { return Err("No images have been rated yet.".to_string()); }
        let root_str = self.root_folder.read().unwrap().clone();
        let root = Path::new(&root_str);
        let mut moved_count = 0;
        let mut summary = HashMap::new();
        let cats = self.get_categories().unwrap_or_default();

        for cat in &cats {
            summary.insert(cat.folder_name.clone(), 0);
        }
        if summary.is_empty() {
            for &cat in &["BAD", "OK", "GOOD"] {
                summary.insert(cat.to_string(), 0);
            }
        }

        for (path_str, category) in results_map {
            let path = Path::new(&path_str);
            if !path.exists() { continue; }
            let rel_path = match path.strip_prefix(root) { Ok(r) => r, Err(_) => continue };
            let cat = cats.iter().find(|c| c.key_name == category);
            let folder_name = cat.map(|c| c.folder_name.clone()).unwrap_or_else(|| category.to_uppercase());
            let target_path = root.join(&folder_name).join(rel_path);
            let target_dir = target_path.parent().unwrap();
            if !target_dir.exists() {
                fs::create_dir_all(target_dir).map_err(|e| e.to_string())?;
            }
            let _size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            let move_ok = fs::rename(path, &target_path).is_ok()
                || (fs::copy(path, &target_path).is_ok() && fs::remove_file(path).is_ok());
            if !move_ok { let _ = fs::remove_file(&target_path); }
            if move_ok {
                moved_count += 1;
                *summary.entry(folder_name.clone()).or_insert(0) += 1;
            }
        }

        // ponytail: no checkpoint write — was creating .photosorter_checkpoint.json
        {
            let db_opt = self.db.read().unwrap();
            let pid_opt = self.project_id.read().unwrap();
            if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
                db.clear_ratings(*pid).unwrap_or(());
            }
        }
        self.reset();
        Ok((moved_count, summary))
    }
}
