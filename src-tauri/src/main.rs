#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{State, Manager};
use photo_sorter_v3::state::AppState;
use photo_sorter_v3::database::{ImageRecord, DateRecord};
use photo_sorter_v3::image_loader::{load_and_scale_image, load_image_unscaled, generate_thumbnail};
use photo_sorter_v3::exif::extract_exif;

// --- Helper path to local AppData DB ---
fn get_db_path(app: &tauri::AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("./"));
    path.push("photosorter.db");
    path
}

// --- Tauri Commands ---

#[tauri::command]
fn open_folder(app: tauri::AppHandle, state: State<'_, AppState>, path: String) -> Result<usize, String> {
    let db_path = get_db_path(&app);
    state.load_images(db_path, &path)
}

#[tauri::command]
fn rate_image(state: State<'_, AppState>, path: String, category: Option<String>) -> Result<(), String> {
    state.rate_image(&path, category.as_deref())
}

#[tauri::command]
fn set_star_rating(state: State<'_, AppState>, path: String, stars: i32) -> Result<i32, String> {
    state.set_star_rating(&path, stars)
}

#[tauri::command]
fn set_rotation(state: State<'_, AppState>, path: String, direction: i32) -> Result<i32, String> {
    state.set_rotation(&path, direction)
}

#[tauri::command]
fn toggle_pick(state: State<'_, AppState>, path: String) -> Result<bool, String> {
    state.toggle_pick(&path)
}

#[tauri::command]
fn delete_current_image(state: State<'_, AppState>) -> Result<Option<String>, String> {
    state.delete_current_image()
}

#[tauri::command]
fn undo_last_rating(state: State<'_, AppState>) -> Result<Option<String>, String> {
    state.undo_last_rating()
}

#[tauri::command]
fn finish_sorting(state: State<'_, AppState>) -> Result<(usize, HashMap<String, usize>), String> {
    state.finish_sorting()
}

#[tauri::command]
fn restore_checkpoint(state: State<'_, AppState>) -> Result<i32, String> {
    state.restore_checkpoint()
}

#[tauri::command]
fn get_image_data(_state: State<'_, AppState>, path: String) -> Result<Vec<u8>, String> {
    // Quality-focused culling viewport dimensions
    let decoded = load_and_scale_image(&path, 1920)
        .ok_or_else(|| "Failed to load image data.".to_string())?;
    Ok(decoded.bytes)
}

#[tauri::command]
fn get_full_image_data(_state: State<'_, AppState>, path: String) -> Result<Vec<u8>, String> {
    let decoded = load_image_unscaled(&path)
        .ok_or_else(|| "Failed to load full resolution image.".to_string())?;
    Ok(decoded.bytes)
}

#[tauri::command]
fn get_thumbnail_data(state: State<'_, AppState>, path: String) -> Result<(Vec<u8>, f64), String> {
    let db_opt = state.db.read().unwrap();
    let pid_opt = state.project_id.read().unwrap();
    
    if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
        let record = db.get_image_by_path(*pid, &path)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Image record not found.".to_string())?;
            
        // Check SQLite cache first
        if let Ok(Some(cached_blob)) = db.get_thumbnail(record.id) {
            return Ok((cached_blob, record.blur_score));
        }
        
        // Generate and cache
        let (thumb_bytes, blur_score) = generate_thumbnail(&path, 120)
            .ok_or_else(|| "Failed to generate thumbnail.".to_string())?;
            
        db.save_thumbnail(record.id, &thumb_bytes).unwrap_or(());
        db.set_blur_score(record.id, blur_score).unwrap_or(());
        
        Ok((thumb_bytes, blur_score))
    } else {
        Err("No active database session.".to_string())
    }
}

#[tauri::command]
fn get_project_stats(state: State<'_, AppState>) -> Result<HashMap<String, usize>, String> {
    let results_map = state.results.read().unwrap();
    let mut stats = HashMap::new();
    stats.insert("BAD".to_string(), 0);
    stats.insert("OK".to_string(), 0);
    stats.insert("GOOD".to_string(), 0);
    
    for val in results_map.values() {
        if stats.contains_key(val) {
            *stats.get_mut(val).unwrap() += 1;
        }
    }
    
    // Add PICKED count
    let db_opt = state.db.read().unwrap();
    let pid_opt = state.project_id.read().unwrap();
    let mut picked_count = 0;
    if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
        if let Ok(records) = db.get_picked_images(*pid) {
            picked_count = records.len();
        }
    }
    stats.insert("PICKED".to_string(), picked_count);
    
    Ok(stats)
}

#[tauri::command]
fn get_date_hierarchy(state: State<'_, AppState>) -> Result<Vec<DateRecord>, String> {
    let db_opt = state.db.read().unwrap();
    let pid_opt = state.project_id.read().unwrap();
    
    if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
        db.get_date_hierarchy(*pid).map_err(|e| e.to_string())
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
fn set_filters(
    state: State<'_, AppState>,
    text: String,
    folder: String,
    date: String,
    mode: String,
) -> Result<(), String> {
    *state.filter_text.write().unwrap() = text;
    *state.filter_folder.write().unwrap() = folder;
    *state.filter_date.write().unwrap() = date;
    *state.filter_mode.write().unwrap() = mode;
    state.apply_filters();
    Ok(())
}

#[tauri::command]
fn get_image_paths(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    Ok(state.image_paths.read().unwrap().clone())
}

#[tauri::command]
fn get_current_index(state: State<'_, AppState>) -> Result<i32, String> {
    Ok(*state.current_index.read().unwrap())
}

#[tauri::command]
fn set_current_index(state: State<'_, AppState>, index: i32) -> Result<(), String> {
    let paths = state.image_paths.read().unwrap();
    if index >= 0 && index < paths.len() as i32 {
        *state.current_index.write().unwrap() = index;
        
        // Asynchronously pre-fetch and extract EXIF if missing
        let path = paths[index as usize].clone();
        let db_opt = state.db.read().unwrap();
        let pid_opt = state.project_id.read().unwrap();
        
        if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
            if let Ok(Some(record)) = db.get_image_by_path(*pid, &path) {
                if record.camera_model.is_none() {
                    // Extract in a background thread to prevent culling UI lag
                    let db_clone = Arc::clone(db);
                    let record_id = record.id;
                    std::thread::spawn(move || {
                        if let Some(meta) = extract_exif(&path) {
                            db_clone.set_exif_data(
                                record_id,
                                meta.iso,
                                meta.aperture.as_deref(),
                                meta.shutter_speed.as_deref(),
                                meta.focal_length.as_deref(),
                                meta.lens.as_deref(),
                                meta.camera_model.as_deref(),
                                meta.date_taken.as_deref(),
                            ).unwrap_or(());
                        }
                    });
                }
            }
        }
        Ok(())
    } else {
        Err("Index out of bounds.".to_string())
    }
}

#[tauri::command]
fn get_image_metadata_info(state: State<'_, AppState>, path: String) -> Result<Option<ImageRecord>, String> {
    let db_opt = state.db.read().unwrap();
    let pid_opt = state.project_id.read().unwrap();
    
    if let (Some(db), Some(pid)) = (db_opt.as_ref(), pid_opt.as_ref()) {
        db.get_image_by_path(*pid, &path).map_err(|e| e.to_string())
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn toggle_filter_mode(state: State<'_, AppState>) -> Result<String, String> {
    let mut mode = state.filter_mode.write().unwrap();
    let new_mode = if mode.as_str() == "unrated" { "all".to_string() } else { "unrated".to_string() };
    *mode = new_mode.clone();
    state.apply_filters();
    Ok(new_mode)
}

#[tauri::command]
fn get_recent_projects(app: tauri::AppHandle) -> Result<Vec<photo_sorter_v3::database::Project>, String> {
    let db_path = get_db_path(&app);
    let db = photo_sorter_v3::database::PhotoDatabase::new(db_path).map_err(|e| e.to_string())?;
    db.get_recent_projects().map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
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
            get_date_hierarchy,
            set_filters,
            get_image_paths,
            get_current_index,
            set_current_index,
            get_image_metadata_info,
            toggle_filter_mode,
            get_recent_projects
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
