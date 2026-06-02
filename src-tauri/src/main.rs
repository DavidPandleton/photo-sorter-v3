#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{State, Manager};
use photo_sorter_v3::state::AppState;
use photo_sorter_v3::database::{ImageRecord, DateRecord};
use photo_sorter_v3::image_loader::{load_and_scale_image, load_image_unscaled, generate_thumbnail};
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
fn restore_checkpoint(state: State<'_, AppState>, root: Option<String>) -> Result<i32, String> {
    if let Some(ref p) = root {
        *state.root_folder.write().unwrap() = p.clone();
    }
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
    {
        *state.filter_text.write().unwrap() = text;
        *state.filter_folder.write().unwrap() = folder;
        *state.filter_date.write().unwrap() = date;
        *state.filter_mode.write().unwrap() = mode;
    }
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
                                meta.orientation,
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
        let mut record = db.get_image_by_path(*pid, &path).map_err(|e| e.to_string())?;
        if let Some(ref mut rec) = record {
            if rec.camera_model.is_none() {
                if let Some(meta) = extract_exif(&path) {
                    let rot_val = meta.orientation.unwrap_or(0);
                    db.set_exif_data(
                        rec.id,
                        meta.iso,
                        meta.aperture.as_deref(),
                        meta.shutter_speed.as_deref(),
                        meta.focal_length.as_deref(),
                        meta.lens.as_deref(),
                        meta.camera_model.as_deref(),
                        meta.date_taken.as_deref(),
                        Some(rot_val),
                    ).unwrap_or(());
                    
                    // Update returned record fields
                    rec.iso = meta.iso;
                    rec.aperture = meta.aperture.clone();
                    rec.shutter_speed = meta.shutter_speed.clone();
                    rec.focal_length = meta.focal_length.clone();
                    rec.lens = meta.lens.clone();
                    rec.camera_model = meta.camera_model.clone();
                    rec.date_taken = meta.date_taken.clone();
                    rec.rotation = rot_val;
                    
                    // Update the in-memory AppState.rotations map if rotation is non-zero
                    if rot_val != 0 {
                        state.rotations.write().unwrap().insert(path.clone(), rot_val);
                    }
                }
            }
        }
        Ok(record)
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn toggle_filter_mode(state: State<'_, AppState>) -> Result<String, String> {
    let new_mode = {
        let mut mode = state.filter_mode.write().unwrap();
        let new = if mode.as_str() == "unrated" { "all".to_string() } else { "unrated".to_string() };
        *mode = new.clone();
        new
    };
    state.apply_filters();
    Ok(new_mode)
}

#[tauri::command]
fn get_recent_projects(app: tauri::AppHandle) -> Result<Vec<photo_sorter_v3::database::Project>, String> {
    let db_path = get_db_path(&app);
    let db = photo_sorter_v3::database::PhotoDatabase::new(db_path).map_err(|e| e.to_string())?;
    db.get_recent_projects().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_startup_folder(state: State<'_, AppState>) -> Option<String> {
    state.startup_folder.read().unwrap().clone()
}

#[tauri::command]
fn get_categories(state: State<'_, AppState>) -> Result<Vec<photo_sorter_v3::database::CategoryRecord>, String> {
    state.get_categories()
}

#[tauri::command]
fn save_category(state: State<'_, AppState>, cat: photo_sorter_v3::database::CategoryRecord) -> Result<(), String> {
    state.save_category(cat)
}

#[tauri::command]
fn delete_category(state: State<'_, AppState>, key_name: String) -> Result<(), String> {
    state.delete_category(&key_name)
}

#[tauri::command]
fn get_keybindings(state: State<'_, AppState>) -> Result<Vec<photo_sorter_v3::database::KeybindingRecord>, String> {
    state.get_keybindings()
}

#[tauri::command]
fn save_keybinding(state: State<'_, AppState>, bind: photo_sorter_v3::database::KeybindingRecord) -> Result<(), String> {
    state.save_keybinding(bind)
}

#[tauri::command]
fn get_hud_items(state: State<'_, AppState>) -> Result<Vec<photo_sorter_v3::database::HudItemRecord>, String> {
    state.get_hud_items()
}

#[tauri::command]
fn save_hud_items(state: State<'_, AppState>, items: Vec<photo_sorter_v3::database::HudItemRecord>) -> Result<(), String> {
    state.save_hud_items(items)
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
        *state.startup_folder.write().unwrap() = Some(folder);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .setup(|app| {
            let app_handle = app.handle().clone();
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
            save_hud_items
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
