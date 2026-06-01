use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use serde::{Serialize, Deserialize};
use crate::database::PhotoDatabase;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Operation {
    pub original_path: String,
    pub exported_path: String,
    pub category: String,
    pub status: String,
    pub size: u64,
    pub sha1: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Checkpoint {
    pub version: String,
    pub root: String,
    pub created_by: String,
    pub created_at: String,
    pub created_folders: Vec<String>,
    pub operations: Vec<Operation>,
}

#[derive(Debug, Clone)]
pub struct UndoAction {
    pub path: String,
    pub old_rating: Option<String>,
}

pub struct AppState {
    pub db: RwLock<Option<Arc<PhotoDatabase>>>,
    pub root_folder: RwLock<String>,
    pub image_paths: RwLock<Vec<String>>,
    pub current_index: RwLock<i32>,
    pub results: RwLock<HashMap<String, String>>, // path -> category
    pub rotations: RwLock<HashMap<String, i32>>, // path -> angle
    pub undo_stack: RwLock<Vec<UndoAction>>,
    
    // Filters
    pub filter_mode: RwLock<String>, // "all" or "unrated"
    pub filter_folder: RwLock<String>,
    pub filter_text: RwLock<String>,
    pub filter_date: RwLock<String>,
    
    pub project_id: RwLock<Option<i64>>,
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
        let root_abs = path.canonicalize()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into_owned();
            
        *self.root_folder.write().unwrap() = root_abs.clone();
        
        // Scan folder for supported images recursively, ignoring BAD, OK, GOOD subfolders
        let mut paths = Vec::new();
        let exts = ["jpg", "jpeg", "png", "webp", "nef", "cr2", "arw", "dng", "cr3", "orf", "rw2", "pef"];
        
        fn walk_dir(dir: &Path, root_path: &Path, paths: &mut Vec<String>, exts: &[&str]) {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let rel_path = path.strip_prefix(root_path).unwrap();
                    
                    // Skip managed subfolders BAD, OK, GOOD at any depth
                    let is_managed = rel_path.components().any(|c| {
                        let name = c.as_os_str().to_string_lossy().to_uppercase();
                        matches!(name.as_str(), "BAD" | "OK" | "GOOD")
                    });
                    
                    if is_managed {
                        continue;
                    }
                    
                    if path.is_dir() {
                        walk_dir(&path, root_path, paths, exts);
                    } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                        if exts.contains(&ext.to_lowercase().as_str()) {
                            paths.push(path.to_string_lossy().into_owned());
                        }
                    }
                }
            }
        }
        
        walk_dir(Path::new(&root_abs), Path::new(&root_abs), &mut paths, &exts);
        
        if paths.is_empty() {
            return Err("No supported images found in directory.".to_string());
        }
        
        // Sort image names naturally (or alphabetically)
        paths.sort_by(|a, b| {
            let filename_a = Path::new(a).file_name().unwrap_or_default();
            let filename_b = Path::new(b).file_name().unwrap_or_default();
            filename_a.cmp(filename_b)
        });
        
        // Initialize SQLite DB
        let database = PhotoDatabase::new(db_path).map_err(|e| e.to_string())?;
        let db_arc = Arc::new(database);
        
        let pid = db_arc.get_or_create_project(&root_abs).map_err(|e| e.to_string())?;
        db_arc.sync_images(pid, &paths).map_err(|e| e.to_string())?;
        
        *self.project_id.write().unwrap() = Some(pid);
        
        // Load ratings and rotations from DB
        let mut results_map = self.results.write().unwrap();
        let mut rotations_map = self.rotations.write().unwrap();
        
        if let Ok(records) = db_arc.get_images(pid) {
            for img in records {
                if let Some(r) = img.rating {
                    results_map.insert(img.path.clone(), r);
                }
                if img.rotation != 0 {
                    rotations_map.insert(img.path.clone(), img.rotation);
                }
            }
        }
        
        let size = paths.len();
        *self.image_paths.write().unwrap() = paths;
        *self.current_index.write().unwrap() = 0;
        *self.db.write().unwrap() = Some(db_arc);
        
        Ok(size)
    }

    pub fn apply_filters(&self) {
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        if db_opt.is_none() || pid_opt.is_none() {
            return;
        }
        
        let db = db_opt.as_ref().unwrap();
        let pid = pid_opt.unwrap();
        
        let filter_date_val = self.filter_date.read().unwrap().clone();
        let filter_text_val = self.filter_text.read().unwrap().clone();
        let filter_folder_val = self.filter_folder.read().unwrap().clone();
        let filter_mode_val = self.filter_mode.read().unwrap().clone();
        
        let all_images = if !filter_date_val.is_empty() {
            db.get_images_by_date(pid, &filter_date_val).unwrap_or_default()
        } else {
            db.get_images(pid).unwrap_or_default()
        };
        
        let results_map = self.results.read().unwrap();
        
        // Apply text and folder filters
        let mut filtered_paths = Vec::new();
        for img in all_images {
            let path_lower = img.path.to_lowercase();
            
            // Text filter matches complete filename / path
            if !filter_text_val.is_empty() && !path_lower.contains(&filter_text_val.to_lowercase()) {
                continue;
            }
            
            // Folder filter matches start of path
            if !filter_folder_val.is_empty() && !path_lower.starts_with(&filter_folder_val.to_lowercase()) {
                continue;
            }
            
            // Mode filter filters unrated images
            if filter_mode_val == "unrated" && results_map.contains_key(&img.path) {
                continue;
            }
            
            filtered_paths.push(img.path);
        }
        
        filtered_paths.sort_by(|a, b| {
            let filename_a = Path::new(a).file_name().unwrap_or_default();
            let filename_b = Path::new(b).file_name().unwrap_or_default();
            filename_a.cmp(filename_b)
        });
        
        let mut paths_lock = self.image_paths.write().unwrap();
        *paths_lock = filtered_paths;
        
        let mut idx_lock = self.current_index.write().unwrap();
        if *idx_lock >= paths_lock.len() as i32 {
            *idx_lock = (paths_lock.len() as i32 - 1).max(0);
        }
    }

    pub fn rate_image(&self, path: &str, category: Option<&str>) -> Result<(), String> {
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        
        if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
            let record = db.get_image_by_path(*pid, path)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Image not found in database.".to_string())?;
                
            let old_val = self.results.read().unwrap().get(path).cloned();
            self.undo_stack.write().unwrap().push(UndoAction {
                path: path.to_string(),
                old_rating: old_val,
            });
            
            db.set_rating(record.id, category).map_err(|e| e.to_string())?;
            
            let mut results_map = self.results.write().unwrap();
            if let Some(cat) = category {
                results_map.insert(path.to_string(), cat.to_string());
            } else {
                results_map.remove(path);
            }
            Ok(())
        } else {
            Err("No active project database found.".to_string())
        }
    }

    pub fn set_star_rating(&self, path: &str, stars: i32) -> Result<i32, String> {
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        
        if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
            let record = db.get_image_by_path(*pid, path)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Image not found.".to_string())?;
                
            let new_stars = if record.star_rating == stars { 0 } else { stars };
            db.set_star_rating(record.id, new_stars).map_err(|e| e.to_string())?;
            Ok(new_stars)
        } else {
            Err("No active project database found.".to_string())
        }
    }

    pub fn set_rotation(&self, path: &str, direction: i32) -> Result<i32, String> {
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        
        if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
            let record = db.get_image_by_path(*pid, path)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Image not found.".to_string())?;
                
            let current_rot = self.rotations.read().unwrap().get(path).cloned().unwrap_or(0);
            let new_rot = (current_rot + (direction * 90)).rem_euclid(360);
            
            db.set_rotation(record.id, new_rot).map_err(|e| e.to_string())?;
            self.rotations.write().unwrap().insert(path.to_string(), new_rot);
            Ok(new_rot)
        } else {
            Err("No active database connection.".to_string())
        }
    }

    pub fn toggle_pick(&self, path: &str) -> Result<bool, String> {
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        
        if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
            let record = db.get_image_by_path(*pid, path)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Image not found.".to_string())?;
                
            let new_val = record.pick == 0;
            db.set_pick(record.id, new_val).map_err(|e| e.to_string())?;
            Ok(new_val)
        } else {
            Err("No active database connection.".to_string())
        }
    }

    pub fn delete_current_image(&self) -> Result<Option<String>, String> {
        let idx = *self.current_index.read().unwrap();
        let mut paths = self.image_paths.write().unwrap();
        
        if idx < 0 || idx >= paths.len() as i32 {
            return Ok(None);
        }
        
        let path_str = paths.remove(idx as usize);
        let path = Path::new(&path_str);
        
        if path.exists() {
            // Delete file using system trash bin (so users can restore it!)
            trash::delete(path).map_err(|e| format!("Failed to move file to trash: {}", e))?;
        }
        
        // Remove from memory state
        self.results.write().unwrap().remove(&path_str);
        self.rotations.write().unwrap().remove(&path_str);
        
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
            if let Ok(Some(record)) = db.get_image_by_path(*pid, &path_str) {
                db.set_rating(record.id, None).unwrap_or(());
            }
        }
        
        // Fix index bounds
        let mut idx_lock = self.current_index.write().unwrap();
        if *idx_lock >= paths.len() as i32 {
            *idx_lock = (paths.len() as i32 - 1).max(0);
        }
        
        Ok(Some(path_str))
    }

    pub fn undo_last_rating(&self) -> Result<Option<String>, String> {
        let mut stack = self.undo_stack.write().unwrap();
        let undo = stack.pop();
        if undo.is_none() {
            return Ok(None);
        }
        
        let u = undo.unwrap();
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        
        if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
            let record = db.get_image_by_path(*pid, &u.path)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Image not found.".to_string())?;
                
            db.set_rating(record.id, u.old_rating.as_deref()).map_err(|e| e.to_string())?;
            
            let mut results_map = self.results.write().unwrap();
            if let Some(ref r) = u.old_rating {
                results_map.insert(u.path.clone(), r.clone());
            } else {
                results_map.remove(&u.path);
            }
            Ok(Some(u.path))
        } else {
            Err("No active project database.".to_string())
        }
    }

    // --- Checkpoint ---
    pub fn create_checkpoint(&self, created_folders: Vec<String>, operations: Vec<Operation>) -> Result<(), String> {
        let root_str = self.root_folder.read().unwrap().clone();
        if root_str.is_empty() {
            return Err("No active folder.".to_string());
        }
        
        let cp_path = Path::new(&root_str).join(".photosorter_checkpoint.json");
        let mut cp_data = Checkpoint {
            version: "2.0".to_string(),
            root: root_str.clone(),
            created_by: "PhotoSorterV3".to_string(),
            created_at: chrono::Local::now().to_rfc3339(),
            created_folders,
            operations,
        };
        
        // Merge with existing checkpoint if present
        if cp_path.exists() {
            if let Ok(content) = fs::read_to_string(&cp_path) {
                if let Ok(existing) = serde_json::from_str::<Checkpoint>(&content) {
                    if existing.version == "2.0" {
                        // Merge created folders
                        for f in existing.created_folders {
                            if !cp_data.created_folders.contains(&f) {
                                cp_data.created_folders.push(f);
                            }
                        }
                        // Merge operations
                        let mut op_map: HashMap<String, Operation> = cp_data.operations
                            .iter()
                            .cloned()
                            .map(|o| (o.original_path.clone(), o))
                            .collect();
                            
                        for op in existing.operations {
                            op_map.entry(op.original_path.clone()).or_insert(op);
                        }
                        cp_data.operations = op_map.into_values().collect();
                    }
                }
            }
        }
        
        let json_str = serde_json::to_string_pretty(&cp_data).map_err(|e| e.to_string())?;
        fs::write(cp_path, json_str).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn restore_checkpoint(&self) -> Result<i32, String> {
        let root_str = self.root_folder.read().unwrap().clone();
        if root_str.is_empty() {
            return Err("No active folder.".to_string());
        }
        
        let cp_path = Path::new(&root_str).join(".photosorter_checkpoint.json");
        if !cp_path.exists() {
            return Err("No checkpoint file found.".to_string());
        }
        
        let content = fs::read_to_string(&cp_path).map_err(|e| e.to_string())?;
        let cp_data: Checkpoint = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        
        let mut restored = 0;
        if cp_data.version == "2.0" {
            for op in &cp_data.operations {
                let orig = Path::new(&op.original_path);
                let exp = Path::new(&op.exported_path);
                
                if exp.exists() {
                    let parent = orig.parent().unwrap();
                    fs::create_dir_all(parent).unwrap_or(());
                    
                    if fs::rename(exp, orig).is_ok() {
                        restored += 1;
                    }
                }
            }
        } else {
            return Err("Unsupported checkpoint version. Must be 2.0".to_string());
        }
        
        // Remove empty directories created during export in reverse depth order
        let mut folders = cp_data.created_folders.clone();
        folders.sort_by(|a, b| b.len().cmp(&a.len())); // deeper folders first
        
        for folder in folders {
            let fpath = Path::new(&root_str).join(&folder);
            if fpath.exists() && fpath.is_dir() {
                if let Ok(entries) = fs::read_dir(&fpath) {
                    if entries.count() == 0 {
                        fs::remove_dir(&fpath).unwrap_or(());
                    }
                }
            }
        }
        
        // Clear ratings in SQLite
        let db_opt = self.db.read().unwrap();
        let pid_opt = self.project_id.read().unwrap();
        if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
            db.clear_ratings(*pid).unwrap_or(());
        }
        
        // Clear local results hashmap
        self.results.write().unwrap().clear();
        
        Ok(restored)
    }

    pub fn finish_sorting(&self) -> Result<(usize, HashMap<String, usize>), String> {
        let results_map = self.results.read().unwrap().clone();
        if results_map.is_empty() {
            return Err("No images have been rated yet.".to_string());
        }
        
        let root_str = self.root_folder.read().unwrap().clone();
        let root = Path::new(&root_str);
        
        let mut moved_count = 0;
        let mut newly_created = Vec::new();
        let mut operations = Vec::new();
        let mut summary = HashMap::new();
        summary.insert("BAD".to_string(), 0);
        summary.insert("OK".to_string(), 0);
        summary.insert("GOOD".to_string(), 0);
        
        for (path_str, category) in results_map {
            let path = Path::new(&path_str);
            if !path.exists() {
                continue;
            }
            
            let rel_path = match path.strip_prefix(root) {
                Ok(r) => r,
                Err(_) => continue,
            };
            
            let target_path = root.join(&category).join(rel_path);
            let target_dir = target_path.parent().unwrap();
            
            if !target_dir.exists() {
                fs::create_dir_all(target_dir).map_err(|e| e.to_string())?;
                
                let rel_target_dir = target_dir.strip_prefix(root).unwrap();
                let mut accum = PathBuf::new();
                for comp in rel_target_dir.components() {
                    accum.push(comp);
                    let folder_rel = accum.to_string_lossy().into_owned();
                    if !newly_created.contains(&folder_rel) {
                        newly_created.push(folder_rel);
                    }
                }
            }
            
            // Get file metadata for operations log
            let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            
            // Perform safe move
            if fs::rename(path, &target_path).is_ok() {
                moved_count += 1;
                *summary.entry(category.clone()).or_insert(0) += 1;
                
                operations.push(Operation {
                    original_path: path_str.clone(),
                    exported_path: target_path.to_string_lossy().into_owned(),
                    category,
                    status: "completed".to_string(),
                    size,
                    sha1: String::new(), // omitted for speed, or can be computed if needed
                });
            }
        }
        
        // Save checkpoint
        self.create_checkpoint(newly_created, operations)?;
        
        // Clear ratings in SQLite (block scope to drop locks before reset)
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
