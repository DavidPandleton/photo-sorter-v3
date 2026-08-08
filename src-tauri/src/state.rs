use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::fs;
use std::sync::{Arc, RwLock};
use crate::database::PhotoDatabase;

const IMAGE_CACHE_MAX: usize = 60;
const FULLRES_CACHE_MAX: usize = 20;

pub struct ImageCache {
    pub scaled: RwLock<HashMap<String, Vec<u8>>>,
    pub full_res: RwLock<HashMap<String, Vec<u8>>>,
}

impl ImageCache {
    pub fn new() -> Self { Self { scaled: RwLock::new(HashMap::new()), full_res: RwLock::new(HashMap::new()) } }
    pub fn get_scaled(&self, path: &str) -> Option<Vec<u8>> { self.scaled.read().unwrap().get(path).cloned() }
    pub fn insert_scaled(&self, path: &str, bytes: Vec<u8>) {
        let mut m = self.scaled.write().unwrap(); m.insert(path.to_string(), bytes);
        if m.len() > IMAGE_CACHE_MAX { if let Some(k) = m.keys().next().cloned() { m.remove(&k); } }
    }
    pub fn get_fullres(&self, path: &str) -> Option<Vec<u8>> { self.full_res.read().unwrap().get(path).cloned() }
    pub fn insert_fullres(&self, path: &str, bytes: Vec<u8>) {
        let mut m = self.full_res.write().unwrap(); m.insert(path.to_string(), bytes);
        if m.len() > FULLRES_CACHE_MAX { if let Some(k) = m.keys().next().cloned() { m.remove(&k); } }
    }
    pub fn clear(&self) { self.scaled.write().unwrap().clear(); self.full_res.write().unwrap().clear(); }
}

pub struct AppState {
    pub db: RwLock<Option<Arc<PhotoDatabase>>>,
    pub root_folder: RwLock<String>,
    pub image_paths: RwLock<Vec<String>>,
    pub current_index: RwLock<i32>,
    pub results: RwLock<HashMap<String, String>>,
    pub rotations: RwLock<HashMap<String, i32>>,
    pub undo_stack: RwLock<Vec<(String, Option<String>)>>,
    pub filter_mode: RwLock<String>, pub filter_folder: RwLock<String>,
    pub filter_text: RwLock<String>, pub filter_date: RwLock<String>,
    pub project_id: RwLock<Option<i64>>,
    pub startup_folder: RwLock<Option<String>>,
    pub image_cache: ImageCache,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            db: RwLock::new(None), root_folder: RwLock::new(String::new()),
            image_paths: RwLock::new(Vec::new()),
            current_index: RwLock::new(-1), results: RwLock::new(HashMap::new()),
            rotations: RwLock::new(HashMap::new()), undo_stack: RwLock::new(Vec::new()),
            filter_mode: RwLock::new("all".to_string()), filter_folder: RwLock::new(String::new()),
            filter_text: RwLock::new(String::new()), filter_date: RwLock::new(String::new()),
            project_id: RwLock::new(None), startup_folder: RwLock::new(None),
            image_cache: ImageCache::new(),
        }
    }

    pub fn reset(&self) {
        *self.root_folder.write().unwrap() = String::new();
        *self.image_paths.write().unwrap() = Vec::new();
        *self.current_index.write().unwrap() = -1;
        self.results.write().unwrap().clear(); self.rotations.write().unwrap().clear();
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
        let root_abs = PathBuf::from(root).canonicalize().map_err(|e| e.to_string())?.to_string_lossy().into_owned().replace('\\', "/");
        *self.root_folder.write().unwrap() = root_abs.clone();

        let mut paths = Vec::new();
        fn walk(dir: &Path, p: &mut Vec<String>) {
            if let Ok(entries) = fs::read_dir(dir) {
                for e in entries.flatten() {
                    let pth = e.path();
                    if pth.is_dir() { walk(&pth, p); }
                    else if let Some(ext) = pth.extension().and_then(|e| e.to_str()) {
                        if matches!(ext.to_lowercase().as_str(), "jpg"|"jpeg"|"png"|"webp"|"nef"|"cr2"|"arw"|"dng"|"cr3"|"orf"|"rw2"|"pef") {
                            p.push(pth.to_string_lossy().into_owned());
                        }
                    }
                }
            }
        }
        walk(Path::new(&root_abs), &mut paths);
        if paths.is_empty() { return Err("No supported images found.".to_string()); }
        paths.sort();
        for p in &mut paths { *p = p.replace('\\', "/"); }

        let db_arc = {
            let db_opt = self.db.read().unwrap();
            if let Some(db) = db_opt.as_ref() { Arc::clone(db) }
            else { Arc::new(PhotoDatabase::new(db_path).map_err(|e| e.to_string())?) }
        };
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
        self.spawn_thumbnail_generation();
        Ok(size)
    }

    fn spawn_thumbnail_generation(&self) {
        let db_o = self.db.read().unwrap().clone();
        let pid = *self.project_id.read().unwrap();
        if db_o.is_none() || pid.is_none() { return; }
        std::thread::spawn(move || {
            let db = db_o.unwrap(); let pid = pid.unwrap();
            if let Ok(records) = db.get_images(pid) {
                for r in &records {
                    if db.get_thumbnail(r.id).ok().flatten().is_some() { continue; }
                    if let Some(t) = crate::image_loader::generate_thumbnail(&r.path, 120) { db.save_thumbnail(r.id, &t).unwrap_or(()); }
                    if r.camera_model.is_none() {
                        if let Some(m) = crate::exif::extract_exif(&r.path) {
                            db.set_exif_data(r.id, m.iso, m.aperture.as_deref(), m.shutter_speed.as_deref(),
                                m.focal_length.as_deref(), m.lens.as_deref(), m.camera_model.as_deref(),
                                m.date_taken.as_deref(), m.orientation).unwrap_or(());
                        }
                    }
                }
            }
        });
    }

    pub fn rate_image(&self, path: &str, category: Option<&str>) -> Result<(), String> {
        let (db, pid) = self.get_db_pid()?;
        let record = db.get_image_by_path(pid, path).map_err(|e| e.to_string())?.ok_or_else(|| "Image not found.".to_string())?;
        let old = self.results.read().unwrap().get(path).cloned();
        self.undo_stack.write().unwrap().push((path.to_string(), old));
        db.set_rating(record.id, category).map_err(|e| e.to_string())?;
        let mut m = self.results.write().unwrap();
        if let Some(cat) = category { m.insert(path.to_string(), cat.to_string()); } else { m.remove(path); }
        Ok(())
    }

    pub fn set_star_rating(&self, path: &str, stars: i32) -> Result<i32, String> {
        let (db, pid) = self.get_db_pid()?;
        let record = db.get_image_by_path(pid, path).map_err(|e| e.to_string())?.ok_or_else(|| "Image not found.".to_string())?;
        let n = if record.star_rating == stars { 0 } else { stars };
        db.set_star_rating(record.id, n).map_err(|e| e.to_string())?;
        Ok(n)
    }

    pub fn set_rotation(&self, path: &str, direction: i32) -> Result<i32, String> {
        let (db, pid) = self.get_db_pid()?;
        let record = db.get_image_by_path(pid, path).map_err(|e| e.to_string())?.ok_or_else(|| "Image not found.".to_string())?;
        let mut m = self.rotations.write().unwrap();
        let cur = m.get(path).cloned().unwrap_or(record.rotation);
        let n = (cur + (direction * 90)).rem_euclid(360);
        db.set_rotation(record.id, n).map_err(|e| e.to_string())?;
        m.insert(path.to_string(), n);
        Ok(n)
    }

    pub fn toggle_pick(&self, path: &str) -> Result<bool, String> {
        let (db, pid) = self.get_db_pid()?;
        let record = db.get_image_by_path(pid, path).map_err(|e| e.to_string())?.ok_or_else(|| "Image not found.".to_string())?;
        let n = record.pick == 0;
        db.set_pick(record.id, n).map_err(|e| e.to_string())?;
        Ok(n)
    }

    pub fn delete_current_image(&self) -> Result<Option<String>, String> {
        let idx = *self.current_index.read().unwrap();
        let mut paths = self.image_paths.write().unwrap();
        if idx < 0 || idx >= paths.len() as i32 { return Ok(None); }
        let path = paths.remove(idx as usize);
        let _ = fs::remove_file(Path::new(&path));
        self.results.write().unwrap().remove(&path);
        self.rotations.write().unwrap().remove(&path);
        let mut idx_lock = self.current_index.write().unwrap();
        if *idx_lock >= paths.len() as i32 { *idx_lock = (paths.len() as i32 - 1).max(0); }
        Ok(Some(path))
    }

    pub fn undo_last_rating(&self) -> Result<Option<String>, String> {
        let u = self.undo_stack.write().unwrap().pop();
        if u.is_none() { return Ok(None); }
        let (path, old) = u.unwrap();
        let (db, pid) = self.get_db_pid()?;
        let record = db.get_image_by_path(pid, &path).map_err(|e| e.to_string())?.ok_or_else(|| "Image not found.".to_string())?;
        db.set_rating(record.id, old.as_deref()).map_err(|e| e.to_string())?;
        let mut m = self.results.write().unwrap();
        if let Some(ref r) = old { m.insert(path.clone(), r.clone()); } else { m.remove(&path); }
        Ok(Some(path))
    }

    pub fn apply_filters(&self) {
        let (db, pid) = match self.get_db_pid() { Ok(v) => v, Err(_) => return };
        let fd = self.filter_date.read().unwrap().clone();
        let ft = self.filter_text.read().unwrap().clone();
        let ff = self.filter_folder.read().unwrap().clone().replace('\\', "/");
        let fm = self.filter_mode.read().unwrap().clone();

        let all = if fd.is_empty() { db.get_images(pid).unwrap_or_default() }
                  else { db.get_images_by_date(pid, &fd).unwrap_or_default() };

        let rmap = self.results.read().unwrap();
        let mut fpaths: Vec<String> = all.into_iter()
            .filter(|img| {
                let l = img.path.to_lowercase();
                (ft.is_empty() || l.contains(&ft.to_lowercase())) &&
                (ff.is_empty() || l.starts_with(&ff.to_lowercase())) &&
                !(fm == "unrated" && rmap.contains_key(&img.path))
            })
            .map(|img| img.path)
            .collect();
        fpaths.sort_by(|a, b| Path::new(a).file_name().cmp(&Path::new(b).file_name()));

        *self.image_paths.write().unwrap() = fpaths;
        let mut idx = self.current_index.write().unwrap();
        let len = self.image_paths.read().unwrap().len();
        if *idx >= len as i32 { *idx = (len as i32 - 1).max(0); }
    }

    // ponytail: get_db_pid replaces copy-paste lock pattern in every method
    fn get_db_pid(&self) -> Result<(Arc<PhotoDatabase>, i64), String> {
        let db_opt = self.db.read().unwrap().clone();
        let pid_opt = *self.project_id.read().unwrap();
        match (db_opt, pid_opt) {
            (Some(db), Some(pid)) => Ok((db, pid)),
            _ => Err("No active project database.".to_string()),
        }
    }
}
