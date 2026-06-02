use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::fs;
use serde::{Serialize, Deserialize};
use crate::state::AppState;
use crate::constants;

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

impl AppState {
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
        if cp_path.exists() {
            if let Ok(content) = fs::read_to_string(&cp_path) {
                if let Ok(existing) = serde_json::from_str::<Checkpoint>(&content) {
                    if existing.version == "2.0" {
                        for f in existing.created_folders {
                            if !cp_data.created_folders.contains(&f) {
                                cp_data.created_folders.push(f);
                            }
                        }
                        let mut op_map: HashMap<String, Operation> = cp_data.operations.iter().cloned().map(|o| (o.original_path.clone(), o)).collect();
                        for op in existing.operations { op_map.entry(op.original_path.clone()).or_insert(op); }
                        cp_data.operations = op_map.into_values().collect();
                    }
                }
            }
        }
        let json_str = serde_json::to_string_pretty(&cp_data).map_err(|e| e.to_string())?;
        let tmp_path = cp_path.with_extension("json.tmp");
        fs::write(&tmp_path, json_str).map_err(|e| e.to_string())?;
        fs::rename(tmp_path, cp_path).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn restore_checkpoint(&self) -> Result<i32, String> {
        let root_str = self.root_folder.read().unwrap().clone();
        if root_str.is_empty() { return Err("No active folder.".to_string()); }
        let cp_path = Path::new(&root_str).join(".photosorter_checkpoint.json");
        if !cp_path.exists() { return Err("No checkpoint file found.".to_string()); }
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
                    if fs::rename(exp, orig).is_ok() { restored += 1; }
                }
            }
        } else { return Err("Unsupported checkpoint version. Must be 2.0".to_string()); }
        let mut folders = cp_data.created_folders.clone();
        folders.sort_by_key(|b| std::cmp::Reverse(b.len()));
        for folder in folders {
            let fpath = Path::new(&root_str).join(&folder);
            if fpath.exists() && fpath.is_dir() {
                if let Ok(entries) = fs::read_dir(&fpath) {
                    if entries.count() == 0 { fs::remove_dir(&fpath).unwrap_or(()); }
                }
            }
        }
        {
            let db_opt = self.db.read().unwrap();
            let pid_opt = self.project_id.read().unwrap();
            if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) { db.clear_ratings(*pid).unwrap_or(()); }
        }
        self.results.write().unwrap().clear();
        Ok(restored)
    }

    pub fn finish_sorting(&self) -> Result<(usize, HashMap<String, usize>), String> {
        let results_map = self.results.read().unwrap().clone();
        if results_map.is_empty() { return Err("No images have been rated yet.".to_string()); }
        let root_str = self.root_folder.read().unwrap().clone();
        let root = Path::new(&root_str);
        let mut moved_count = 0;
        let mut newly_created = Vec::new();
        let mut operations = Vec::new();
        let mut summary = HashMap::new();
        for &cat in &constants::CATEGORIES {
            summary.insert(cat.to_string(), 0);
        }
        for (path_str, category) in results_map {
            let path = Path::new(&path_str);
            if !path.exists() { continue; }
            let rel_path = match path.strip_prefix(root) { Ok(r) => r, Err(_) => continue };
            let target_path = root.join(&category).join(rel_path);
            let target_dir = target_path.parent().unwrap();
            if !target_dir.exists() {
                fs::create_dir_all(target_dir).map_err(|e| e.to_string())?;
                let rel_target_dir = target_dir.strip_prefix(root).unwrap();
                let mut accum = PathBuf::new();
                for comp in rel_target_dir.components() {
                    accum.push(comp);
                    let folder_rel = accum.to_string_lossy().into_owned();
                    if !newly_created.contains(&folder_rel) { newly_created.push(folder_rel); }
                }
            }
            let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            let move_ok = fs::rename(path, &target_path).is_ok()
                || (fs::copy(path, &target_path).is_ok() && fs::remove_file(path).is_ok());
            if !move_ok { let _ = fs::remove_file(&target_path); }
            if move_ok {
                moved_count += 1;
                *summary.entry(category.clone()).or_insert(0) += 1;
                operations.push(Operation {
                    original_path: path_str.clone(),
                    exported_path: target_path.to_string_lossy().into_owned(),
                    category,
                    status: "completed".to_string(),
                    size,
                    sha1: String::new(),
                });
            }
        }
        self.create_checkpoint(newly_created, operations)?;
        {
            let db_opt = self.db.read().unwrap();
            let pid_opt = self.project_id.read().unwrap();
            if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) { db.clear_ratings(*pid).unwrap_or(()); }
        }
        self.reset();
        Ok((moved_count, summary))
    }
}
