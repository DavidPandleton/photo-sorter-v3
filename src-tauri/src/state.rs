use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::fs;
use std::sync::{Arc, RwLock};
use rayon::prelude::*;
use crate::database::PhotoDatabase;
use crate::constants;

const IMAGE_CACHE_MAX: usize = 60;
const FULLRES_CACHE_MAX: usize = 20;

pub struct ImageCache {
    pub scaled: RwLock<HashMap<String, Vec<u8>>>,
    pub full_res: RwLock<HashMap<String, Vec<u8>>>,
}

impl ImageCache {
    pub fn new() -> Self {
        ImageCache {
            scaled: RwLock::new(HashMap::new()),
            full_res: RwLock::new(HashMap::new()),
        }
    }

    pub fn get_scaled(&self, path: &str) -> Option<Vec<u8>> {
        self.scaled.read().unwrap().get(path).cloned()
    }

    pub fn insert_scaled(&self, path: &str, bytes: Vec<u8>) {
        let mut map = self.scaled.write().unwrap();
        map.insert(path.to_string(), bytes);
        if map.len() > IMAGE_CACHE_MAX {
            // Drop one entry instead of clearing all — less destructive
            if let Some(key) = map.keys().next().cloned() {
                map.remove(&key);
            }
        }
    }

    pub fn get_fullres(&self, path: &str) -> Option<Vec<u8>> {
        self.full_res.read().unwrap().get(path).cloned()
    }

    pub fn insert_fullres(&self, path: &str, bytes: Vec<u8>) {
        let mut map = self.full_res.write().unwrap();
        map.insert(path.to_string(), bytes);
        if map.len() > FULLRES_CACHE_MAX {
            if let Some(key) = map.keys().next().cloned() {
                map.remove(&key);
            }
        }
    }

    pub fn clear(&self) {
        self.scaled.write().unwrap().clear();
        self.full_res.write().unwrap().clear();
    }
}

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
    pub image_cache: ImageCache,
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
            image_cache: ImageCache::new(),
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
        self.image_cache.clear();
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
                        constants::CATEGORIES.contains(&rel_upper.as_str())
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

        let db_arc = {
            let db_opt = self.db.read().unwrap();
            if let Some(db) = db_opt.as_ref() {
                Arc::clone(db)
            } else {
                let database = PhotoDatabase::new(db_path).map_err(|e| e.to_string())?;
                Arc::new(database)
            }
        };
        // Keep it in the state if it wasn't already initialized
        *self.db.write().unwrap() = Some(Arc::clone(&db_arc));

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

        // Background: batch-generate thumbnails for all images using rayon
        self.spawn_thumbnail_generation();

        Ok(size)
    }

    fn spawn_thumbnail_generation(&self) {
        let db_opt = self.db.read().unwrap().clone();
        let pid = *self.project_id.read().unwrap();
        if db_opt.is_none() || pid.is_none() { return; }

        std::thread::spawn(move || {
            let db = db_opt.unwrap();
            let pid = pid.unwrap();

            let records = match db.get_images(pid) {
                Ok(r) => r,
                Err(_) => return,
            };

            records.par_iter().for_each(|record| {
                if db.get_thumbnail(record.id).ok().flatten().is_some() {
                    return;
                }
                if let Some((thumb, blur)) = crate::image_loader::generate_thumbnail(&record.path, 120) {
                    db.save_thumbnail(record.id, &thumb).unwrap_or(());
                    db.set_blur_score(record.id, blur).unwrap_or(());
                }
            });
        });
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
        if path.exists() && trash::delete(path).is_err() {
            std::fs::remove_file(path).map_err(|e| format!("Failed to delete file: {}", e))?;
        }
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

    pub fn get_categories(&self) -> Result<Vec<crate::database::CategoryRecord>, String> {
        let db_opt = self.db.read().unwrap();
        if let Some(db) = db_opt.as_ref() {
            db.get_categories().map_err(|e| e.to_string())
        } else { Err("No active database connection.".to_string()) }
    }

    pub fn save_category(&self, cat: crate::database::CategoryRecord) -> Result<(), String> {
        let db_opt = self.db.read().unwrap();
        if let Some(db) = db_opt.as_ref() {
            db.save_category(cat).map_err(|e| e.to_string())
        } else { Err("No active database connection.".to_string()) }
    }

    pub fn delete_category(&self, key_name: &str) -> Result<(), String> {
        let db_opt = self.db.read().unwrap();
        if let Some(db) = db_opt.as_ref() {
            db.delete_category(key_name).map_err(|e| e.to_string())?;
            // Reload results in-memory from DB since ratings might have been reset
            let pid_opt = self.project_id.read().unwrap();
            if let Some(pid) = pid_opt.as_ref() {
                let images = db.get_images(*pid).map_err(|e| e.to_string())?;
                let mut results_map = self.results.write().unwrap();
                results_map.clear();
                for img in images {
                    if let Some(r) = img.rating {
                        results_map.insert(img.path, r);
                    }
                }
            }
            Ok(())
        } else { Err("No active database connection.".to_string()) }
    }

    pub fn get_keybindings(&self) -> Result<Vec<crate::database::KeybindingRecord>, String> {
        let db_opt = self.db.read().unwrap();
        if let Some(db) = db_opt.as_ref() {
            db.get_keybindings().map_err(|e| e.to_string())
        } else { Err("No active database connection.".to_string()) }
    }

    pub fn save_keybinding(&self, bind: crate::database::KeybindingRecord) -> Result<(), String> {
        let db_opt = self.db.read().unwrap();
        if let Some(db) = db_opt.as_ref() {
            db.save_keybinding(bind).map_err(|e| e.to_string())
        } else { Err("No active database connection.".to_string()) }
    }

    pub fn get_hud_items(&self) -> Result<Vec<crate::database::HudItemRecord>, String> {
        let db_opt = self.db.read().unwrap();
        if let Some(db) = db_opt.as_ref() {
            db.get_hud_items().map_err(|e| e.to_string())
        } else { Err("No active database connection.".to_string()) }
    }

    pub fn save_hud_items(&self, items: Vec<crate::database::HudItemRecord>) -> Result<(), String> {
        let db_opt = self.db.read().unwrap();
        if let Some(db) = db_opt.as_ref() {
            db.save_hud_items(items).map_err(|e| e.to_string())
        } else { Err("No active database connection.".to_string()) }
    }

    pub fn get_hud_widgets(&self) -> Result<Vec<crate::database::HudWidgetRecord>, String> {
        let db_opt = self.db.read().unwrap();
        if let Some(db) = db_opt.as_ref() {
            db.get_hud_widgets().map_err(|e| e.to_string())
        } else { Err("No active database connection.".to_string()) }
    }

    pub fn save_hud_widgets(&self, widgets: Vec<crate::database::HudWidgetRecord>) -> Result<(), String> {
        let db_opt = self.db.read().unwrap();
        if let Some(db) = db_opt.as_ref() {
            db.save_hud_widgets(widgets).map_err(|e| e.to_string())
        } else { Err("No active database connection.".to_string()) }
    }

    /// Rate all unrated images based on blur_score.
    /// < 150 → BAD, 150-500 → OK, > 500 → GOOD.
    /// ponytail: hardcoded thresholds, configurable if someone asks.
    pub fn auto_grade_unrated(&self) -> Result<usize, String> {
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        let (db, pid) = match (db_opt.as_ref(), pid_opt.as_ref()) {
            (Some(db), Some(pid)) => (Arc::clone(db), *pid),
            _ => return Err("No active project database.".to_string()),
        };
        drop(db_opt);
        drop(pid_opt);
        let all = db.get_images(pid).map_err(|e| e.to_string())?;
        let mut rated: usize = 0;
        for img in &all {
            if img.rating.is_some() { continue; }
            if img.blur_score == 0.0 { continue; } // no thumbnail generated yet
            let cat = if img.blur_score < 150.0 { "bad" }
                      else if img.blur_score < 500.0 { "ok" }
                      else { "good" };
            db.set_rating(img.id, Some(cat)).map_err(|e| e.to_string())?;
            self.results.write().unwrap().insert(img.path.clone(), cat.to_string());
            rated += 1;
        }
        Ok(rated)
    }

    pub fn reset_keybindings(&self) -> Result<(), String> {
        let db_opt = self.db.read().unwrap();
        if let Some(db) = db_opt.as_ref() {
            db.reset_keybindings().map_err(|e| e.to_string())
        } else { Err("No active database connection.".to_string()) }
    }
}
