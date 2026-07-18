use std::collections::HashMap;
use std::path::Path;
use std::fs;
use crate::state::AppState;

impl AppState {
    pub fn finish_sorting(&self) -> Result<(usize, HashMap<String, usize>), String> {
        let r = self.results.read().unwrap().clone();
        if r.is_empty() { return Err("No images rated yet.".to_string()); }
        let root_str = self.root_folder.read().unwrap().clone();
        if root_str.is_empty() { return Err("No active folder.".to_string()); }
        let root = Path::new(&root_str);
        // ponytail: hardcoded 3 categories — no DB CRUD needed
        let folders = ["bad", "ok", "good"];
        let mut summary: HashMap<String, usize> = folders.map(|f| (f.to_uppercase(), 0)).into();
        let mut moved = 0;

        for (path_str, category) in &r {
            let path = Path::new(path_str);
            if !path.exists() { continue; }
            let rel = match path.strip_prefix(root) { Ok(r) => r, Err(_) => continue };
            let folder = category.to_uppercase();
            let dst = root.join(&folder).join(rel);
            if let Some(parent) = dst.parent() { if !parent.exists() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; } }
            if fs::rename(path, &dst).is_ok() || (fs::copy(path, &dst).is_ok() && fs::remove_file(path).is_ok()) {
                moved += 1; *summary.entry(folder).or_insert(0) += 1;
            }
        }

        if let (Some(db), Some(pid)) = (self.db.read().unwrap().as_ref().map(|a| a.clone()), *self.project_id.read().unwrap()) {
            db.clear_ratings(pid).unwrap_or(());
        }
        self.reset();
        Ok((moved, summary))
    }
}
