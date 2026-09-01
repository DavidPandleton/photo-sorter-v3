use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::fs;
use std::sync::{Arc, Mutex, RwLock};
use rayon::prelude::*;
use crate::database::PhotoDatabase;
use crate::error::{AppError, AppResult};
use crate::undo::UndoAction;
use crate::constants;

const IMAGE_CACHE_MAX: usize = 30;
const FULLRES_CACHE_MAX: usize = 10;

pub struct ImageCache {
    pub scaled: RwLock<HashMap<String, Vec<u8>>>,
    pub full_res: RwLock<HashMap<String, Vec<u8>>>,
    scaled_order: RwLock<VecDeque<String>>,
    fullres_order: RwLock<VecDeque<String>>,
}

impl ImageCache {
    pub fn new() -> Self {
        ImageCache {
            scaled: RwLock::new(HashMap::new()),
            full_res: RwLock::new(HashMap::new()),
            scaled_order: RwLock::new(VecDeque::new()),
            fullres_order: RwLock::new(VecDeque::new()),
        }
    }

    pub fn get_scaled(&self, path: &str) -> Option<Vec<u8>> {
        let map = self.scaled.read().unwrap();
        if let Some(bytes) = map.get(path) {
            let mut order = self.scaled_order.write().unwrap();
            if let Some(pos) = order.iter().position(|p| p == path) {
                order.remove(pos);
                order.push_back(path.to_string());
            }
            Some(bytes.clone())
        } else {
            None
        }
    }

    pub fn insert_scaled(&self, path: &str, bytes: Vec<u8>) {
        let mut map = self.scaled.write().unwrap();
        let mut order = self.scaled_order.write().unwrap();
        if map.contains_key(path) {
            if let Some(pos) = order.iter().position(|p| p == path) {
                order.remove(pos);
            }
        }
        map.insert(path.to_string(), bytes);
        order.push_back(path.to_string());
        while map.len() > IMAGE_CACHE_MAX {
            if let Some(old) = order.pop_front() {
                map.remove(&old);
            }
        }
    }

    pub fn get_fullres(&self, path: &str) -> Option<Vec<u8>> {
        let map = self.full_res.read().unwrap();
        if let Some(bytes) = map.get(path) {
            let mut order = self.fullres_order.write().unwrap();
            if let Some(pos) = order.iter().position(|p| p == path) {
                order.remove(pos);
                order.push_back(path.to_string());
            }
            Some(bytes.clone())
        } else {
            None
        }
    }

    pub fn insert_fullres(&self, path: &str, bytes: Vec<u8>) {
        let mut map = self.full_res.write().unwrap();
        let mut order = self.fullres_order.write().unwrap();
        if map.contains_key(path) {
            if let Some(pos) = order.iter().position(|p| p == path) {
                order.remove(pos);
            }
        }
        map.insert(path.to_string(), bytes);
        order.push_back(path.to_string());
        while map.len() > FULLRES_CACHE_MAX {
            if let Some(old) = order.pop_front() {
                map.remove(&old);
            }
        }
    }

    pub fn clear(&self) {
        self.scaled.write().unwrap().clear();
        self.full_res.write().unwrap().clear();
        self.scaled_order.write().unwrap().clear();
        self.fullres_order.write().unwrap().clear();
    }
}

/// Session/navigation state only. Per-image state (rating, stars, pick,
/// rotation) lives EXCLUSIVELY in SQLite: the old design duplicated it in
/// AppState.results/rotations maps plus a frontend ratedPaths set, and the
/// three copies drifted (KB bugs #5, #12). One lock, no torn reads between
/// fields; the DB keeps its own internal connection lock.
struct Inner {
    db: Option<Arc<PhotoDatabase>>,
    root_folder: String,
    image_paths: Vec<String>,
    current_index: i32,
    undo_stack: Vec<UndoAction>,
    filter_mode: String,
    filter_folder: String,
    filter_text: String,
    filter_date: String,
    project_id: Option<i64>,
    startup_folder: Option<String>,
}

/// Record ids with an EXIF extraction thread in flight (KB bug #7:
/// set_current_index used to spawn unbounded duplicate threads).
/// Shared Arc so the spawned thread can release its claim without
/// holding AppState itself.
type ExifInFlight = Arc<Mutex<HashSet<i64>>>;

pub struct AppState {
    inner: Mutex<Inner>,
    exif_in_flight: ExifInFlight,
    pub image_cache: ImageCache,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            inner: Mutex::new(Inner {
                db: None,
                root_folder: String::new(),
                image_paths: Vec::new(),
                current_index: -1,
                undo_stack: Vec::new(),
                filter_mode: "all".to_string(),
                filter_folder: String::new(),
                filter_text: String::new(),
                filter_date: String::new(),
                project_id: None,
                startup_folder: None,
            }),
            exif_in_flight: Arc::new(Mutex::new(HashSet::new())),
            image_cache: ImageCache::new(),
        }
    }

    pub fn reset(&self) {
        let mut g = self.inner.lock().unwrap();
        g.root_folder.clear();
        g.image_paths.clear();
        g.current_index = -1;
        g.undo_stack.clear();
        g.filter_mode = "all".to_string();
        g.filter_folder.clear();
        g.filter_text.clear();
        g.filter_date.clear();
        g.project_id = None;
        drop(g);
        self.image_cache.clear();
    }

    // --- Accessors (the only way in or out of Inner) ---

    pub fn root_folder(&self) -> String {
        self.inner.lock().unwrap().root_folder.clone()
    }

    pub fn set_root_folder(&self, path: &str) {
        self.inner.lock().unwrap().root_folder = path.to_string();
    }

    pub fn image_paths(&self) -> Vec<String> {
        self.inner.lock().unwrap().image_paths.clone()
    }

    pub fn current_index(&self) -> i32 {
        self.inner.lock().unwrap().current_index
    }

    /// Sets the cursor and returns the newly selected path.
    pub fn set_current_index(&self, index: i32) -> AppResult<Option<String>> {
        let mut g = self.inner.lock().unwrap();
        if index < 0 || index >= g.image_paths.len() as i32 {
            return Err(AppError::msg("Index out of bounds."));
        }
        g.current_index = index;
        Ok(Some(g.image_paths[index as usize].clone()))
    }

    pub fn startup_folder(&self) -> Option<String> {
        self.inner.lock().unwrap().startup_folder.clone()
    }

    pub fn set_startup_folder(&self, folder: String) {
        self.inner.lock().unwrap().startup_folder = Some(folder);
    }

    pub fn filter_mode(&self) -> String {
        self.inner.lock().unwrap().filter_mode.clone()
    }

    pub fn set_filter_values(&self, text: &str, folder: &str, date: &str, mode: &str) {
        let mut g = self.inner.lock().unwrap();
        g.filter_text = text.to_string();
        g.filter_folder = folder.to_string();
        g.filter_date = date.to_string();
        g.filter_mode = mode.to_string();
    }

    pub fn db_arc(&self) -> Option<Arc<PhotoDatabase>> {
        self.inner.lock().unwrap().db.clone()
    }

    pub fn db_and_pid(&self) -> Option<(Arc<PhotoDatabase>, i64)> {
        let g = self.inner.lock().unwrap();
        Some((g.db.as_ref().cloned()?, g.project_id?))
    }

    /// Top of the undo stack without consuming it (undo peeks, then pops
    /// only after the DB write succeeded).
    pub fn undo_peek(&self) -> Option<UndoAction> {
        self.inner.lock().unwrap().undo_stack.last().cloned()
    }

    pub fn undo_pop(&self) {
        self.inner.lock().unwrap().undo_stack.pop();
    }

    fn with_db_pid<T>(&self, f: impl FnOnce(&Arc<PhotoDatabase>, i64) -> AppResult<T>) -> AppResult<T> {
        let (db, pid) = self.db_and_pid().ok_or_else(|| AppError::msg("No active project database found."))?;
        f(&db, pid)
    }

    fn with_db<T>(&self, f: impl FnOnce(&Arc<PhotoDatabase>) -> AppResult<T>) -> AppResult<T> {
        let db = { self.inner.lock().unwrap().db.clone() }
            .ok_or_else(|| AppError::msg("No active database connection."))?;
        f(&db)
    }

    /// Attach a pre-opened database as the active project (used by tests and
    /// by setup() when a DB was opened before any folder was loaded).
    pub fn attach_project(&self, db: Arc<PhotoDatabase>, pid: i64, root: &str) {
        let mut g = self.inner.lock().unwrap();
        g.db = Some(db);
        g.project_id = Some(pid);
        g.root_folder = root.to_string();
    }

    pub fn init_db(&self, db: PhotoDatabase) {
        self.inner.lock().unwrap().db = Some(Arc::new(db));
    }

    // --- Per-image state: SQLite is the source of truth ---

    pub fn get_rating(&self, path: &str) -> Option<String> {
        self.db_and_pid()
            .and_then(|(db, pid)| db.get_image_by_path(pid, path).ok().flatten()?.rating)
    }

    pub fn get_ratings(&self) -> HashMap<String, String> {
        match self.db_and_pid() {
            Some((db, pid)) => db
                .get_images(pid)
                .map(|recs| {
                    recs.into_iter()
                        .filter_map(|r| r.rating.map(|rt| (r.path, rt)))
                        .collect()
                })
                .unwrap_or_default(),
            None => HashMap::new(),
        }
    }

    pub fn get_rotation(&self, path: &str) -> i32 {
        self.db_and_pid()
            .and_then(|(db, pid)| db.get_image_by_path(pid, path).ok().flatten())
            .map(|r| r.rotation)
            .unwrap_or(0)
    }

    pub fn rate_image(&self, path: &str, category: Option<&str>) -> AppResult<()> {
        self.with_db_pid(|db, pid| {
            let record = db
                .get_image_by_path(pid, path)
                ?
                .ok_or_else(|| AppError::msg("Image not found."))?;
            let old_val = record.rating.clone();
            db.set_rating(record.id, category)?;
            // Undo is pushed only after the write succeeded: a failed DB
            // update no longer leaves a ghost entry (KB bug #4).
            self.inner.lock().unwrap().undo_stack.push(UndoAction {
                path: path.to_string(),
                old_rating: old_val,
            });
            Ok(())
        })
    }

    pub fn set_star_rating(&self, path: &str, stars: i32) -> AppResult<i32> {
        self.with_db_pid(|db, pid| {
            let record = db
                .get_image_by_path(pid, path)
                ?
                .ok_or_else(|| AppError::msg("Image not found."))?;
            let new_stars = if record.star_rating == stars { 0 } else { stars };
            db.set_star_rating(record.id, new_stars)?;
            Ok(new_stars)
        })
    }

    pub fn set_rotation(&self, path: &str, direction: i32) -> AppResult<i32> {
        self.with_db_pid(|db, pid| {
            let record = db
                .get_image_by_path(pid, path)
                ?
                .ok_or_else(|| AppError::msg("Image not found."))?;
            let new_rot = (record.rotation + direction * 90).rem_euclid(360);
            db.set_rotation(record.id, new_rot)?;
            Ok(new_rot)
        })
    }

    pub fn toggle_pick(&self, path: &str) -> AppResult<bool> {
        self.with_db_pid(|db, pid| {
            let record = db
                .get_image_by_path(pid, path)
                ?
                .ok_or_else(|| AppError::msg("Image not found."))?;
            let new_val = record.pick == 0;
            db.set_pick(record.id, new_val)?;
            Ok(new_val)
        })
    }

    // --- Folder loading ---

    pub fn load_images(&self, db_path: PathBuf, root: &str) -> AppResult<usize> {
        self.reset();
        let path = PathBuf::from(root);
        let root_abs = path
            .canonicalize()
            ?
            .to_string_lossy()
            .into_owned()
            .replace('\\', "/");

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
                    }) {
                        continue;
                    }
                    if p.is_dir() {
                        walk_dir(&p, root_path, paths, exts);
                    } else if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                        if exts.contains(&ext.to_lowercase().as_str()) {
                            paths.push(p.to_string_lossy().into_owned());
                        }
                    }
                }
            }
        }
        walk_dir(Path::new(&root_abs), Path::new(&root_abs), &mut paths, &exts);
        if paths.is_empty() {
            return Err(AppError::msg("No supported images found in directory."));
        }
        paths.sort();
        for p in &mut paths {
            *p = p.replace('\\', "/");
        }

        let db_arc = match self.inner.lock().unwrap().db.clone() {
            Some(db) => db,
            None => Arc::new(PhotoDatabase::new(db_path)?),
        };

        let pid = db_arc.get_or_create_project(&root_abs)?;
        db_arc.sync_images(pid, &paths)?;

        {
            let mut g = self.inner.lock().unwrap();
            g.db = Some(db_arc);
            g.project_id = Some(pid);
            g.root_folder = root_abs;
            g.image_paths = paths;
            g.current_index = 0;
        }

        // Background: batch-generate thumbnails for all images using rayon
        self.spawn_thumbnail_generation();

        Ok(self.inner.lock().unwrap().image_paths.len())
    }

    fn spawn_thumbnail_generation(&self) {
        let Some((db, pid)) = self.db_and_pid() else { return };
        std::thread::spawn(move || {
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

    pub fn delete_current_image(&self) -> AppResult<Option<String>> {
        let (path_str, idx) = {
            let g = self.inner.lock().unwrap();
            let idx = g.current_index as usize;
            if g.current_index < 0 || idx >= g.image_paths.len() {
                return Ok(None);
            }
            (g.image_paths[idx].clone(), idx)
        };
        // No fs::remove_file fallback: if the trash fails, leave the file
        // alone and tell the user (KB bug #9: silent permanent delete while
        // the toast claimed "moved to Trash"). The path list is only mutated
        // after the delete succeeds, so a failure keeps the image visible.
        if Path::new(&path_str).exists() {
            trash::delete(&path_str)
                .map_err(|e| AppError::msg(format!("Failed to move to trash: {}", e)))?;
        }
        {
            let mut g = self.inner.lock().unwrap();
            // Re-check: the index may have moved between the two locks.
            let idx = g.image_paths.iter().position(|p| p == &path_str).unwrap_or(idx);
            if idx < g.image_paths.len() {
                g.image_paths.remove(idx);
            }
            if g.current_index as usize >= g.image_paths.len() {
                g.current_index = (g.image_paths.len() as i32 - 1).max(0);
            }
        }
        // The row survives sync until the next folder load; just drop the rating.
        if let Some((db, pid)) = self.db_and_pid() {
            if let Ok(Some(record)) = db.get_image_by_path(pid, &path_str) {
                db.set_rating(record.id, None).unwrap_or(());
            }
        }
        Ok(Some(path_str))
    }

    // --- Thin DB passthroughs (categories, keybindings, HUD) ---

    pub fn get_categories(&self) -> AppResult<Vec<crate::database::CategoryRecord>> {
        self.with_db(|db| db.get_categories().map_err(AppError::from))
    }

    pub fn save_category(&self, cat: crate::database::CategoryRecord) -> AppResult<()> {
        self.with_db(|db| db.save_category(cat).map_err(AppError::from))
    }

    pub fn delete_category(&self, key_name: &str) -> AppResult<()> {
        // Ratings live in the DB only now, so deleting a category needs no
        // in-memory reload: delete_category already NULLs matching rows.
        self.with_db(|db| db.delete_category(key_name).map_err(AppError::from))
    }

    pub fn get_keybindings(&self) -> AppResult<Vec<crate::database::KeybindingRecord>> {
        self.with_db(|db| db.get_keybindings().map_err(AppError::from))
    }

    pub fn save_keybinding(&self, bind: crate::database::KeybindingRecord) -> AppResult<()> {
        self.with_db(|db| db.save_keybinding(bind).map_err(AppError::from))
    }

    pub fn get_hud_items(&self) -> AppResult<Vec<crate::database::HudItemRecord>> {
        self.with_db(|db| db.get_hud_items().map_err(AppError::from))
    }

    pub fn save_hud_items(&self, items: Vec<crate::database::HudItemRecord>) -> AppResult<()> {
        self.with_db(|db| db.save_hud_items(items).map_err(AppError::from))
    }

    pub fn reset_keybindings(&self) -> AppResult<()> {
        self.with_db(|db| db.reset_keybindings().map_err(AppError::from))
    }

    pub fn get_date_hierarchy(&self) -> AppResult<Vec<crate::database::DateRecord>> {
        match self.db_and_pid() {
            Some((db, pid)) => db.get_date_hierarchy(pid).map_err(AppError::from),
            None => Ok(Vec::new()),
        }
    }

    pub fn get_picked_count(&self) -> usize {
        match self.db_and_pid() {
            Some((db, pid)) => db.get_picked_images(pid).map(|r| r.len()).unwrap_or(0),
            None => 0,
        }
    }

    /// Claim a record for EXIF extraction; false if a thread already runs.
    pub fn claim_exif(&self, record_id: i64) -> bool {
        self.exif_in_flight.lock().unwrap().insert(record_id)
    }

    pub fn exif_tracker(&self) -> ExifInFlight {
        Arc::clone(&self.exif_in_flight)
    }

    pub fn record_for_path(&self, path: &str) -> Option<crate::database::ImageRecord> {
        let (db, pid) = self.db_and_pid()?;
        db.get_image_by_path(pid, path).ok().flatten()
    }

    pub fn set_exif_for_record(&self, record_id: i64, meta: &crate::exif::ExifMetadata) {
        if let Some(db) = self.inner.lock().unwrap().db.clone() {
            let rot_val = meta.orientation.unwrap_or(0);
            db.set_exif_data(
                record_id,
                meta.iso,
                meta.aperture.as_deref(),
                meta.shutter_speed.as_deref(),
                meta.focal_length.as_deref(),
                meta.lens.as_deref(),
                meta.camera_model.as_deref(),
                meta.date_taken.as_deref(),
                Some(rot_val),
            )
            .unwrap_or(());
        }
    }

    pub fn rated_paths(&self) -> HashSet<String> {
        self.get_ratings().into_keys().collect()
    }

    pub fn filter_values(&self) -> (String, String, String, String) {
        let g = self.inner.lock().unwrap();
        (g.filter_text.clone(), g.filter_folder.clone(), g.filter_date.clone(), g.filter_mode.clone())
    }

    /// Replace the visible path list (after filtering) and clamp the cursor.
    pub fn set_filtered_paths(&self, paths: Vec<String>) {
        let mut g = self.inner.lock().unwrap();
        g.image_paths = paths;
        if g.current_index >= g.image_paths.len() as i32 {
            g.current_index = (g.image_paths.len() as i32 - 1).max(0);
        }
    }
}

#[cfg(test)]
pub(crate) mod test_util {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// A temp project root with the given files (rel path -> content) plus a
    /// database wired into a fresh AppState. Deliberately bypasses
    /// load_images so no background thumbnail thread races the assertions.
    pub fn project_with_files(files: &[(&str, &[u8])]) -> (AppState, PathBuf) {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!("psort_test_{}_{}", std::process::id(), n));
        fs::create_dir_all(&root).unwrap();
        let mut paths = Vec::new();
        for (name, content) in files {
            let p = root.join(name);
            if let Some(parent) = p.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(&p, content).unwrap();
            paths.push(p.to_string_lossy().into_owned());
        }
        let db = PhotoDatabase::new(root.join(".test.db")).unwrap();
        let pid = db.get_or_create_project(&root.to_string_lossy()).unwrap();
        db.sync_images(pid, &paths).unwrap();
        let state = AppState::new();
        state.attach_project(Arc::new(db), pid, &root.to_string_lossy());
        (state, root)
    }

    pub fn cleanup(root: &Path) {
        let _ = fs::remove_dir_all(root);
    }
}

#[cfg(test)]
mod tests {
    use super::test_util::{cleanup, project_with_files};
    use super::*;

    #[test]
    fn rate_then_undo_restores_previous_rating() {
        let (state, root) = project_with_files(&[("a.jpg", b"AAA")]);
        let a = root.join("a.jpg").to_string_lossy().into_owned();

        // ratings store the raw category key_name; only export maps it to
        // the uppercase folder name.
        state.rate_image(&a, Some("good")).unwrap();
        assert_eq!(state.get_rating(&a).as_deref(), Some("good"));

        // re-rate: undo must go back to good, not to unrated
        state.rate_image(&a, Some("bad")).unwrap();
        assert_eq!(state.get_rating(&a).as_deref(), Some("bad"));

        let undone = state.undo_last_rating().unwrap();
        assert_eq!(undone.as_deref(), Some(a.as_str()));
        assert_eq!(state.get_rating(&a).as_deref(), Some("good"));

        // undo the first rating too -> unrated
        state.undo_last_rating().unwrap();
        assert_eq!(state.get_rating(&a), None);
        // empty stack -> Ok(None), no panic
        assert_eq!(state.undo_last_rating().unwrap(), None);
        cleanup(&root);
    }

    #[test]
    fn rating_is_persisted_to_db() {
        let (state, root) = project_with_files(&[("a.jpg", b"AAA")]);
        let a = root.join("a.jpg").to_string_lossy().into_owned();
        state.rate_image(&a, Some("ok")).unwrap();
        let (db, pid) = state.db_and_pid().unwrap();
        let rec = db.get_image_by_path(pid, &a).unwrap().unwrap();
        assert_eq!(rec.rating.as_deref(), Some("ok"));
        cleanup(&root);
    }

    #[test]
    fn rotation_wraps_mod_360_both_directions() {
        let (state, root) = project_with_files(&[("a.jpg", b"AAA")]);
        let a = root.join("a.jpg").to_string_lossy().into_owned();
        assert_eq!(state.set_rotation(&a, 1).unwrap(), 90); // cw
        assert_eq!(state.set_rotation(&a, 1).unwrap(), 180);
        assert_eq!(state.set_rotation(&a, 1).unwrap(), 270);
        assert_eq!(state.set_rotation(&a, 1).unwrap(), 0); // 360 wraps to 0
        assert_eq!(state.set_rotation(&a, -1).unwrap(), 270); // ccw below 0 wraps
        assert_eq!(state.get_rotation(&a), 270);
        cleanup(&root);
    }

    #[test]
    fn star_rating_toggles_off_when_same_value() {
        let (state, root) = project_with_files(&[("a.jpg", b"AAA")]);
        let a = root.join("a.jpg").to_string_lossy().into_owned();
        assert_eq!(state.set_star_rating(&a, 3).unwrap(), 3);
        assert_eq!(state.set_star_rating(&a, 3).unwrap(), 0); // same -> clear
        cleanup(&root);
    }

    #[test]
    fn load_images_walks_filters_and_ratings_survive_reload() {
        let n = {
            use std::sync::atomic::AtomicUsize;
            static EXTRA: AtomicUsize = AtomicUsize::new(0);
            EXTRA.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        };
        let root = std::env::temp_dir().join(format!("psort_load_{}_{}", std::process::id(), n));
        fs::create_dir_all(root.join("vacation")).unwrap();
        fs::create_dir_all(root.join("GOOD")).unwrap();
        fs::write(root.join("vacation/one.jpg"), b"1").unwrap();
        fs::write(root.join("vacation/two.PNG"), b"2").unwrap(); // case-insensitive ext
        fs::write(root.join("vacation/notes.txt"), b"3").unwrap(); // filtered out
        fs::write(root.join("GOOD/already.jpg"), b"4").unwrap(); // category dir skipped

        let state = AppState::new();
        let count = state
            .load_images(root.join(".db").clone(), &root.to_string_lossy())
            .unwrap();
        assert_eq!(count, 2, "only the two images, no txt, no GOOD/");
        {
            let paths = state.image_paths();
            assert!(paths.iter().any(|p| p.ends_with("one.jpg")));
            assert!(paths.iter().any(|p| p.ends_with("two.PNG")));
            assert!(!paths.iter().any(|p| p.contains("/GOOD/")));
        }

        // rate, then reload: the DB is the source of truth, ratings come back
        let one = root.join("vacation/one.jpg").to_string_lossy().into_owned();
        state.rate_image(&one, Some("good")).unwrap();
        assert_eq!(
            state
                .load_images(root.join(".db").clone(), &root.to_string_lossy())
                .unwrap(),
            2
        );
        assert_eq!(state.get_rating(&one).as_deref(), Some("good"));
        cleanup(&root);
    }

    #[test]
    fn failed_rate_on_unknown_path_leaves_no_undo_entry() {
        // KB bug #4 regression: writing a rating for a path that is not in
        // the project must fail WITHOUT pushing an undo entry.
        let (state, root) = project_with_files(&[("a.jpg", b"AAA")]);
        let ghost = root.join("nope.jpg").to_string_lossy().into_owned();
        assert!(state.rate_image(&ghost, Some("good")).is_err());
        assert_eq!(state.undo_last_rating().unwrap(), None);
        cleanup(&root);
    }
}
