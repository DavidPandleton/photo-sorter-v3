use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::fs;
use serde::{Serialize, Deserialize};
use crate::state::AppState;
use crate::constants;

/// If the export target already exists, pick "name (1).ext", "name (2).ext"...
/// Never overwrite an existing file: the whole point of the checkpoint is
/// that export is reversible, and clobbering destroys unrelated data.
fn unique_target(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let dir = path.parent().unwrap_or(Path::new("")).to_path_buf();
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file").to_string();
    let ext = path.extension().and_then(|s| s.to_str()).map(|e| format!(".{}", e)).unwrap_or_default();
    let mut n = 1u32;
    loop {
        let cand = dir.join(format!("{} ({}){}", stem, n, ext));
        if !cand.exists() {
            return cand;
        }
        n += 1;
    }
}

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
        let root_str = self.root_folder();
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
        let root_str = self.root_folder();
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
                    // Never clobber whatever sits at the original path: if the
                    // user put a new file there after exporting, skip instead
                    // of silently destroying it.
                    if orig.exists() { continue; }
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
        if let Some((db, pid)) = self.db_and_pid() {
            db.clear_ratings(pid).unwrap_or(());
        }
        Ok(restored)
    }

    pub fn finish_sorting(&self) -> Result<(usize, HashMap<String, usize>), String> {
        let results_map = self.get_ratings();
        if results_map.is_empty() { return Err("No images have been rated yet.".to_string()); }
        let root_str = self.root_folder();
        let root = Path::new(&root_str);
        let mut moved_count = 0;
        let mut newly_created = Vec::new();
        let mut operations = Vec::new();
        let mut summary = HashMap::new();
        let cats = self.get_categories().unwrap_or_default();
        let cat_folder_map: HashMap<String, String> = cats.iter().map(|c| (c.key_name.clone(), c.folder_name.clone())).collect();
        for cat in &cats {
            summary.insert(cat.folder_name.clone(), 0);
        }
        if summary.is_empty() {
            for &cat in &constants::CATEGORIES {
                summary.insert(cat.to_string(), 0);
            }
        }
        for (path_str, category) in results_map {
            let path = Path::new(&path_str);
            if !path.exists() { continue; }
            let rel_path = match path.strip_prefix(root) { Ok(r) => r, Err(_) => continue };
            let folder_name = cat_folder_map.get(&category).cloned().unwrap_or_else(|| category.to_uppercase());
            let target_path = root.join(&folder_name).join(rel_path);
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
            let target_path = unique_target(target_path);
            let move_ok = fs::rename(path, &target_path).is_ok()
                || (fs::copy(path, &target_path).is_ok() && fs::remove_file(path).is_ok());
            if !move_ok { let _ = fs::remove_file(&target_path); }
            if move_ok {
                moved_count += 1;
                *summary.entry(folder_name.clone()).or_insert(0) += 1;
                operations.push(Operation {
                    original_path: path_str.clone(),
                    exported_path: target_path.to_string_lossy().into_owned(),
                    category: folder_name,
                    status: "completed".to_string(),
                    size,
                    sha1: String::new(),
                });
            }
        }
        self.create_checkpoint(newly_created, operations)?;
        if let Some((db, pid)) = self.db_and_pid() {
            db.clear_ratings(pid).unwrap_or(());
        }
        self.reset();
        Ok((moved_count, summary))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::test_util::{cleanup, project_with_files};

    fn read(p: &Path) -> Vec<u8> {
        fs::read(p).unwrap()
    }

    #[test]
    fn finish_sorting_moves_rated_into_category_folders() {
        let (state, root) = project_with_files(&[("a.jpg", b"AAA"), ("b.jpg", b"BBB")]);
        let a = root.join("a.jpg").to_string_lossy().into_owned();
        let b = root.join("b.jpg").to_string_lossy().into_owned();
        state.rate_image(&a, Some("good")).unwrap();
        state.rate_image(&b, Some("bad")).unwrap();

        let (moved, summary) = state.finish_sorting().unwrap();
        assert_eq!(moved, 2);
        assert_eq!(*summary.get("GOOD").unwrap(), 1);
        assert_eq!(*summary.get("BAD").unwrap(), 1);
        assert_eq!(read(&root.join("GOOD/a.jpg")), b"AAA");
        assert_eq!(read(&root.join("BAD/b.jpg")), b"BBB");
        assert!(!root.join("a.jpg").exists());
        cleanup(&root);
    }

    #[test]
    fn finish_sorting_never_clobbers_existing_target() {
        // A GOOD/a.jpg already exists (from a prior export). Exporting a new
        // a.jpg must NOT overwrite it — the old file is someone's keeper.
        let (state, root) = project_with_files(&[("a.jpg", b"NEW")]);
        fs::create_dir_all(root.join("GOOD")).unwrap();
        fs::write(root.join("GOOD/a.jpg"), b"OLD").unwrap();
        let a = root.join("a.jpg").to_string_lossy().into_owned();
        state.rate_image(&a, Some("good")).unwrap();

        let (moved, _) = state.finish_sorting().unwrap();
        assert_eq!(moved, 1);
        assert_eq!(read(&root.join("GOOD/a.jpg")), b"OLD"); // untouched
        assert!(root.join("GOOD/a (1).jpg").exists()); // new one relocated
        cleanup(&root);
    }

    #[test]
    fn finish_sorting_errors_when_nothing_rated() {
        let (state, root) = project_with_files(&[("a.jpg", b"AAA")]);
        assert!(state.finish_sorting().is_err());
        cleanup(&root);
    }

    #[test]
    fn restore_reverses_a_full_export() {
        let (state, root) = project_with_files(&[("a.jpg", b"AAA"), ("sub/b.jpg", b"BBB")]);
        let a = root.join("a.jpg").to_string_lossy().into_owned();
        let b = root.join("sub/b.jpg").to_string_lossy().into_owned();
        state.rate_image(&a, Some("good")).unwrap();
        state.rate_image(&b, Some("ok")).unwrap();
        state.finish_sorting().unwrap();
        assert!(!root.join("a.jpg").exists());
        // finish_sorting resets state; reopening the folder is what the UI does
        state.set_root_folder(&root.to_string_lossy());

        let restored = state.restore_checkpoint().unwrap();
        assert_eq!(restored, 2);
        assert_eq!(read(&root.join("a.jpg")), b"AAA");
        assert_eq!(read(&root.join("sub/b.jpg")), b"BBB");
        cleanup(&root);
    }

    #[test]
    fn restore_does_not_clobber_a_file_placed_at_the_original_path() {
        // After export, the user drops a fresh file where the old one lived.
        // Restore must skip that op rather than silently overwrite it.
        let (state, root) = project_with_files(&[("a.jpg", b"ORIGINAL")]);
        let a = root.join("a.jpg").to_string_lossy().into_owned();
        state.rate_image(&a, Some("good")).unwrap();
        state.finish_sorting().unwrap();
        fs::write(root.join("a.jpg"), b"USER_NEW").unwrap();
        state.set_root_folder(&root.to_string_lossy());

        let restored = state.restore_checkpoint().unwrap();
        assert_eq!(restored, 0); // skipped, not clobbered
        assert_eq!(read(&root.join("a.jpg")), b"USER_NEW");
        assert!(root.join("GOOD/a.jpg").exists()); // exported copy still there
        cleanup(&root);
    }

    #[test]
    fn restore_rejects_unknown_checkpoint_version() {
        let (state, root) = project_with_files(&[("a.jpg", b"AAA")]);
        fs::write(
            root.join(".photosorter_checkpoint.json"),
            r#"{"version":"9.9","root":"","created_by":"","created_at":"","created_folders":[],"operations":[]}"#,
        )
        .unwrap();
        assert!(state.restore_checkpoint().is_err());
        cleanup(&root);
    }

    #[test]
    fn unique_target_leaves_free_paths_alone() {
        let (_state, root) = project_with_files(&[("x.jpg", b"X")]);
        let free = root.join("y.jpg");
        assert_eq!(unique_target(free.clone()), free);
        let taken = root.join("x.jpg");
        assert_eq!(unique_target(taken.clone()), root.join("x (1).jpg"));
        cleanup(&root);
    }
}
