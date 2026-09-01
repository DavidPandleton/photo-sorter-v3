#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{State, Manager};
use photo_sorter_v3::error::{AppError, AppResult};
use photo_sorter_v3::state::AppState;
use photo_sorter_v3::database::{ImageRecord, DateRecord};
use photo_sorter_v3::image_loader::{load_and_scale_image, load_image_unscaled, generate_thumbnail, encode_thumb_response};
use photo_sorter_v3::exif::extract_exif;
use photo_sorter_v3::constants;

// --- Helper path to local AppData DB ---
fn get_db_path(app: &tauri::AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("./"));
    path.push("photosorter.db");
    path
}

// --- Tauri Commands ---

#[tauri::command]
fn open_folder(app: tauri::AppHandle, state: State<'_, AppState>, path: String) -> AppResult<usize> {
    let db_path = get_db_path(&app);
    state.load_images(db_path, &path)
}

#[tauri::command]
fn rate_image(state: State<'_, AppState>, path: String, category: Option<String>) -> AppResult<()> {
    state.rate_image(&path, category.as_deref())
}

#[tauri::command]
fn set_star_rating(state: State<'_, AppState>, path: String, stars: i32) -> AppResult<i32> {
    state.set_star_rating(&path, stars)
}

#[tauri::command]
fn set_rotation(state: State<'_, AppState>, path: String, direction: i32) -> AppResult<i32> {
    state.set_rotation(&path, direction)
}

#[tauri::command]
fn toggle_pick(state: State<'_, AppState>, path: String) -> AppResult<bool> {
    state.toggle_pick(&path)
}

#[tauri::command]
fn delete_current_image(state: State<'_, AppState>) -> AppResult<Option<String>> {
    state.delete_current_image()
}

#[tauri::command]
fn undo_last_rating(state: State<'_, AppState>) -> AppResult<Option<String>> {
    state.undo_last_rating()
}

#[tauri::command]
fn finish_sorting(state: State<'_, AppState>) -> AppResult<(usize, HashMap<String, usize>)> {
    state.finish_sorting()
}

#[tauri::command]
fn restore_checkpoint(state: State<'_, AppState>, root: Option<String>) -> AppResult<i32> {
    if let Some(ref p) = root {
        state.set_root_folder(p);
    }
    state.restore_checkpoint()
}

#[tauri::command]
fn get_image_data(state: State<'_, AppState>, path: String) -> AppResult<tauri::ipc::Response> {
    if let Some(cached) = state.image_cache.get_scaled(&path) {
        return Ok(tauri::ipc::Response::new(cached));
    }
    let decoded = load_and_scale_image(&path, 1920)
        .ok_or_else(|| AppError::msg("Failed to load image data."))?;
    state.image_cache.insert_scaled(&path, decoded.bytes.clone());
    Ok(tauri::ipc::Response::new(decoded.bytes))
}

#[tauri::command]
fn get_full_image_data(state: State<'_, AppState>, path: String) -> AppResult<tauri::ipc::Response> {
    if let Some(cached) = state.image_cache.get_fullres(&path) {
        return Ok(tauri::ipc::Response::new(cached));
    }
    let decoded = load_image_unscaled(&path)
        .ok_or_else(|| AppError::msg("Failed to load full resolution image."))?;
    state.image_cache.insert_fullres(&path, decoded.bytes.clone());
    Ok(tauri::ipc::Response::new(decoded.bytes))
}

#[tauri::command]
fn get_thumbnail_data(state: State<'_, AppState>, path: String) -> AppResult<tauri::ipc::Response> {
    // Snapshot the DB handle + record under the lock, then release it before
    // generating so thumbnail work never blocks other state.db readers.
    let (db, record_id, cached_blob, cached_blur) = {
        let (db, pid) = match state.db_and_pid() {
            Some(pair) => pair,
            None => return Err(AppError::msg("No active database session.")),
        };
        let record = db.get_image_by_path(pid, &path)
            ?
            .ok_or_else(|| AppError::msg("Image record not found."))?;
        let cached = db.get_thumbnail(record.id)?;
        (db, record.id, cached, record.blur_score)
    };

    let (thumb_bytes, blur_score) = match cached_blob {
        Some(blob) => (blob, cached_blur),
        None => {
            let (bytes, score) = generate_thumbnail(&path, 120)
                .ok_or_else(|| AppError::msg("Failed to generate thumbnail."))?;
            db.save_thumbnail(record_id, &bytes).unwrap_or(());
            db.set_blur_score(record_id, score).unwrap_or(());
            (bytes, score)
        }
    };

    Ok(tauri::ipc::Response::new(encode_thumb_response(thumb_bytes, blur_score)))
}

#[tauri::command]
fn get_project_stats(state: State<'_, AppState>) -> AppResult<HashMap<String, usize>> {
    let results_map = state.get_ratings();
    let mut stats = HashMap::new();
    
    let cats = state.get_categories().unwrap_or_default();
    for cat in &cats {
        stats.insert(cat.key_name.clone(), 0);
    }
    if stats.is_empty() {
        for &cat in &constants::CATEGORIES {
            stats.insert(cat.to_string().to_lowercase(), 0);
        }
    }
    
    for val in results_map.values() {
        let val_lower = val.to_lowercase();
        if stats.contains_key(&val_lower) {
            *stats.get_mut(&val_lower).unwrap() += 1;
        } else {
            *stats.entry(val_lower).or_insert(0) += 1;
        }
    }
    
    stats.insert("PICKED".to_string(), state.get_picked_count());
    
    Ok(stats)
}

/// Path -> rating map straight from the DB. The frontend syncs its
/// ratedPaths set from this on folder load (KB bug #5).
#[tauri::command]
fn get_ratings(state: State<'_, AppState>) -> AppResult<HashMap<String, String>> {
    Ok(state.get_ratings())
}

#[tauri::command]
fn get_date_hierarchy(state: State<'_, AppState>) -> AppResult<Vec<DateRecord>> {
    state.get_date_hierarchy()
}

#[tauri::command]
fn set_filters(
    state: State<'_, AppState>,
    text: String,
    folder: String,
    date: String,
    mode: String,
) -> AppResult<()> {
    state.set_filter_values(&text, &folder, &date, &mode);
    state.apply_filters();
    Ok(())
}

#[tauri::command]
fn get_image_paths(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    Ok(state.image_paths())
}

#[tauri::command]
fn get_current_index(state: State<'_, AppState>) -> AppResult<i32> {
    Ok(state.current_index())
}

#[tauri::command]
fn set_current_index(state: State<'_, AppState>, index: i32) -> AppResult<()> {
    let path = match state.set_current_index(index)? {
        Some(p) => p,
        None => return Ok(()),
    };
    // Asynchronously pre-fetch and extract EXIF if missing
    if let Some(record) = state.record_for_path(&path) {
        if record.camera_model.is_none() {
            // Extract in a background thread to prevent culling UI lag.
            // State<'_, AppState> is not 'static, so hand the thread the DB Arc.
            let db = state.db_arc();
            let record_id = record.id;
            std::thread::spawn(move || {
                if let (Some(db), Some(meta)) = (db, extract_exif(&path)) {
                    db.set_exif_data(
                        record_id,
                        meta.iso,
                        meta.aperture.as_deref(),
                        meta.shutter_speed.as_deref(),
                        meta.focal_length.as_deref(),
                        meta.lens.as_deref(),
                        meta.camera_model.as_deref(),
                        meta.date_taken.as_deref(),
                        meta.orientation,
                    ).unwrap_or(());
                }
            });
        }
    }
    Ok(())
}

#[tauri::command]
fn get_image_metadata_info(state: State<'_, AppState>, path: String) -> AppResult<Option<ImageRecord>> {
    let mut record = match state.record_for_path(&path) {
        Some(r) => r,
        None => return Ok(None),
    };
    if record.camera_model.is_none() {
        if let Some(meta) = extract_exif(&path) {
            let rot_val = meta.orientation.unwrap_or(0);
            state.set_exif_for_record(record.id, &meta);

            // Update returned record fields
            record.iso = meta.iso;
            record.aperture = meta.aperture;
            record.shutter_speed = meta.shutter_speed;
            record.focal_length = meta.focal_length;
            record.lens = meta.lens;
            record.camera_model = meta.camera_model;
            record.date_taken = meta.date_taken;
            record.rotation = rot_val;
        }
    }
    Ok(Some(record))
}

#[tauri::command]
fn toggle_filter_mode(state: State<'_, AppState>) -> AppResult<String> {
    let new = if state.filter_mode() == "unrated" { "all".to_string() } else { "unrated".to_string() };
    let (text, folder, date, _) = state.filter_values();
    state.set_filter_values(&text, &folder, &date, &new);
    state.apply_filters();
    Ok(new)
}

#[tauri::command]
fn get_recent_projects(app: tauri::AppHandle) -> AppResult<Vec<photo_sorter_v3::database::Project>> {
    let db_path = get_db_path(&app);
    let db = photo_sorter_v3::database::PhotoDatabase::new(db_path)?;
    db.get_recent_projects()
}

#[tauri::command]
fn get_startup_folder(state: State<'_, AppState>) -> Option<String> {
    state.startup_folder()
}

#[tauri::command]
fn get_categories(state: State<'_, AppState>) -> AppResult<Vec<photo_sorter_v3::database::CategoryRecord>> {
    state.get_categories()
}

#[tauri::command]
fn save_category(state: State<'_, AppState>, cat: photo_sorter_v3::database::CategoryRecord) -> AppResult<()> {
    state.save_category(cat)
}

#[tauri::command]
fn delete_category(state: State<'_, AppState>, key_name: String) -> AppResult<()> {
    state.delete_category(&key_name)
}

#[tauri::command]
fn get_keybindings(state: State<'_, AppState>) -> AppResult<Vec<photo_sorter_v3::database::KeybindingRecord>> {
    state.get_keybindings()
}

#[tauri::command]
fn save_keybinding(state: State<'_, AppState>, bind: photo_sorter_v3::database::KeybindingRecord) -> AppResult<()> {
    state.save_keybinding(bind)
}

#[tauri::command]
fn get_hud_items(state: State<'_, AppState>) -> AppResult<Vec<photo_sorter_v3::database::HudItemRecord>> {
    state.get_hud_items()
}

#[tauri::command]
fn save_hud_items(state: State<'_, AppState>, items: Vec<photo_sorter_v3::database::HudItemRecord>) -> AppResult<()> {
    state.save_hud_items(items)
}

#[tauri::command]
fn reset_keybindings(state: State<'_, AppState>) -> AppResult<Vec<photo_sorter_v3::database::KeybindingRecord>> {
    state.reset_keybindings()?;
    state.get_keybindings()
}

fn main() {
    let mut startup_folder = None;
    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        if (args[i] == "--folder" || args[i] == "-f") && i + 1 < args.len() {
            startup_folder = Some(args[i + 1].clone());
            i += 2;
        } else {
            let path = PathBuf::from(&args[i]);
            if path.is_dir() {
                startup_folder = Some(args[i].clone());
            }
            i += 1;
        }
    }

    let state = AppState::new();
    if let Some(folder) = startup_folder {
        state.set_startup_folder(folder);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .setup(|app| {
            let app_handle = app.handle().clone();
            
            // Initialize global database connection on launch
            let db_path = get_db_path(&app_handle);
            let state = app.state::<AppState>();
            match photo_sorter_v3::database::PhotoDatabase::new(db_path) {
                Ok(db) => {
                    state.init_db(db);
                }
                Err(e) => {
                    eprintln!("Failed to initialize database: {}", e);
                }
            }

            std::thread::spawn(move || {
                photo_sorter_v3::gamepad::start_gamepad_loop(app_handle);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_folder,
            rate_image,
            set_star_rating,
            set_rotation,
            toggle_pick,
            delete_current_image,
            undo_last_rating,
            finish_sorting,
            restore_checkpoint,
            get_image_data,
            get_full_image_data,
            get_thumbnail_data,
            get_project_stats,
            get_ratings,
            get_date_hierarchy,
            set_filters,
            get_image_paths,
            get_current_index,
            set_current_index,
            get_image_metadata_info,
            toggle_filter_mode,
            get_recent_projects,
            get_startup_folder,
            get_categories,
            save_category,
            delete_category,
            get_keybindings,
            save_keybinding,
            get_hud_items,
            save_hud_items,
            reset_keybindings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
