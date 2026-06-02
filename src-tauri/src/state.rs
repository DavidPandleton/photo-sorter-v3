use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::fs;
use std::sync::{Arc, RwLock};
use crate::database::PhotoDatabase;
use crate::constants;

pub struct AppState {
    pub db: RwLock<Option<Arc<PhotoDatabase>>>,
    pub root_folder: RwLock<String>,
    pub image_paths: RwLock<Vec<String>>,
    pub current_index: RwLock<i32>,
    pub results: RwLock<HashMap<String, String>>,
    pub rotations: RwLock<HashMap<String, i32>>,
    pub undo_stack: RwLock<Vec<crate::undo::UndoAction>>,

    pub filter_mode: RwLock<String>,
    pub filter_folder: RwLock<String>,
    pub filter_text: RwLock<String>,
    pub filter_date: RwLock<String>,

    pub project_id: RwLock<Option<i64>>,
    pub startup_folder: RwLock<Option<String>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            db: RwLock::new(None),
            root_folder: RwLock::new(String::new()),
            image_paths: RwLock::new(Vec::new()),
            current_index: RwLock::new(-1),
            results: RwLock::new(HashMap::new()),
            rotations: RwLock::new(HashMap::new()),
            undo_stack: RwLock::new(Vec::new()),
            filter_mode: RwLock::new("all".to_string()),
            filter_folder: RwLock::new(String::new()),
            filter_text: RwLock::new(String::new()),
            filter_date: RwLock::new(String::new()),
            project_id: RwLock::new(None),
            startup_folder: RwLock::new(None),
        }
    }

    pub fn reset(&self) {
        *self.root_folder.write().unwrap() = String::new();
        *self.image_paths.write().unwrap() = Vec::new();
        *self.current_index.write().unwrap() = -1;
        self.results.write().unwrap().clear();
        self.rotations.write().unwrap().clear();
        self.undo_stack.write().unwrap().clear();
        *self.filter_mode.write().unwrap() = "all".to_string();
        *self.filter_folder.write().unwrap() = String::new();
        *self.filter_text.write().unwrap() = String::new();
        *self.filter_date.write().unwrap() = String::new();
        *self.project_id.write().unwrap() = None;
        *self.db.write().unwrap() = None;
    }

    pub fn load_images(&self, db_path: PathBuf, root: &str) -> Result<usize, String> {
        self.reset();
        let path = PathBuf::from(root);
        let root_abs = path.canonicalize().map_err(|e| e.to_string())?.to_string_lossy().into_owned().replace('\\', "/");
        *self.root_folder.write().unwrap() = root_abs.clone();

        let mut paths = Vec::new();
        let exts = constants::SUPPORTED_EXTENSIONS;

        fn walk_dir(dir: &Path, root_path: &Path, paths: &mut Vec<String>, exts: &[&str]) {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    let rel = p.strip_prefix(root_path).unwrap();
                    if rel.components().any(|c| {
                        let rel_upper = c.as_os_str().to_string_lossy().to_uppercase();
                        constants::CATEGORIES.iter().any(|&cat| cat == rel_upper.as_str())
                    }) { continue; }
                    if p.is_dir() { walk_dir(&p, root_path, paths, exts); }
                    else if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                        if exts.contains(&ext.to_lowercase().as_str()) { paths.push(p.to_string_lossy().into_owned()); }
                    }
                }
            }
        }
        walk_dir(Path::new(&root_abs), Path::new(&root_abs), &mut paths, &exts);
        if paths.is_empty() { return Err("No supported images found in directory.".to_string()); }
        paths.sort();
        for p in &mut paths { *p = p.replace('\\', "/"); }

        let database = PhotoDatabase::new(db_path).map_err(|e| e.to_string())?;
        let db_arc = Arc::new(database);
        let pid = db_arc.get_or_create_project(&root_abs).map_err(|e| e.to_string())?;
        db_arc.sync_images(pid, &paths).map_err(|e| e.to_string())?;
        *self.project_id.write().unwrap() = Some(pid);

        if let Ok(records) = db_arc.get_images(pid) {
            let mut results_map = self.results.write().unwrap();
            let mut rotations_map = self.rotations.write().unwrap();
            for img in records {
                if let Some(r) = img.rating { results_map.insert(img.path.clone(), r); }
                if img.rotation != 0 { rotations_map.insert(img.path.clone(), img.rotation); }
            }
        }

        let size = paths.len();
        *self.image_paths.write().unwrap() = paths;
        *self.current_index.write().unwrap() = 0;
        *self.db.write().unwrap() = Some(db_arc);
        Ok(size)
    }

    pub fn rate_image(&self, path: &str, category: Option<&str>) -> Result<(), String> {
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
            let record = db.get_image_by_path(*pid, path).map_err(|e| e.to_string())?.ok_or_else(|| "Image not found.".to_string())?;
            let old_val = self.results.read().unwrap().get(path).cloned();
            self.undo_stack.write().unwrap().push(crate::undo::UndoAction { path: path.to_string(), old_rating: old_val });
            db.set_rating(record.id, category).map_err(|e| e.to_string())?;
            let mut results_map = self.results.write().unwrap();
            if let Some(cat) = category { results_map.insert(path.to_string(), cat.to_string()); }
            else { results_map.remove(path); }
            Ok(())
        } else { Err("No active project database found.".to_string()) }
    }

    pub fn set_star_rating(&self, path: &str, stars: i32) -> Result<i32, String> {
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
            let record = db.get_image_by_path(*pid, path).map_err(|e| e.to_string())?.ok_or_else(|| "Image not found.".to_string())?;
            let new_stars = if record.star_rating == stars { 0 } else { stars };
            db.set_star_rating(record.id, new_stars).map_err(|e| e.to_string())?;
            Ok(new_stars)
        } else { Err("No active project database found.".to_string()) }
    }

    pub fn set_rotation(&self, path: &str, direction: i32) -> Result<i32, String> {
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
            let record = db.get_image_by_path(*pid, path).map_err(|e| e.to_string())?.ok_or_else(|| "Image not found.".to_string())?;
            let mut rotations_map = self.rotations.write().unwrap();
            let current_rot = rotations_map.get(path).cloned().unwrap_or(record.rotation);
            let new_rot = (current_rot + (direction * 90)).rem_euclid(360);
            db.set_rotation(record.id, new_rot).map_err(|e| e.to_string())?;
            rotations_map.insert(path.to_string(), new_rot);
            Ok(new_rot)
        } else { Err("No active database connection.".to_string()) }
    }

    pub fn toggle_pick(&self, path: &str) -> Result<bool, String> {
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
            let record = db.get_image_by_path(*pid, path).map_err(|e| e.to_string())?.ok_or_else(|| "Image not found.".to_string())?;
            let new_val = record.pick == 0;
            db.set_pick(record.id, new_val).map_err(|e| e.to_string())?;
            Ok(new_val)
        } else { Err("No active database connection.".to_string()) }
    }

    pub fn delete_current_image(&self) -> Result<Option<String>, String> {
        let idx = *self.current_index.read().unwrap();
        let mut paths = self.image_paths.write().unwrap();
        if idx < 0 || idx >= paths.len() as i32 { return Ok(None); }
        let path_str = paths.remove(idx as usize);
        let path = Path::new(&path_str);
        if path.exists() { trash::delete(path).map_err(|e| format!("Failed to move file to trash: {}", e))?; }
        self.results.write().unwrap().remove(&path_str);
        self.rotations.write().unwrap().remove(&path_str);
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
            if let Ok(Some(record)) = db.get_image_by_path(*pid, &path_str) { db.set_rating(record.id, None).unwrap_or(()); }
        }
        let mut idx_lock = self.current_index.write().unwrap();
        if *idx_lock >= paths.len() as i32 { *idx_lock = (paths.len() as i32 - 1).max(0); }
        Ok(Some(path_str))
    }
}
