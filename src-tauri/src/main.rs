#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{State, Manager};
use photo_sorter_v3::state::AppState;
use photo_sorter_v3::database::{ImageRecord, DateRecord};
use photo_sorter_v3::image_loader::{load_and_scale_image, load_image_unscaled, generate_thumbnail};
use photo_sorter_v3::exif::extract_exif;

fn get_db_path(app: &tauri::AppHandle) -> PathBuf {
    let mut p = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("./"));
    p.push("photosorter.db"); p
}

#[tauri::command] fn open_folder(app: tauri::AppHandle, s: State<'_, AppState>, path: String) -> Result<usize, String> {
    s.load_images(get_db_path(&app), &path)
}
#[tauri::command] fn rate_image(s: State<'_, AppState>, path: String, category: Option<String>) -> Result<(), String> { s.rate_image(&path, category.as_deref()) }
#[tauri::command] fn set_star_rating(s: State<'_, AppState>, path: String, stars: i32) -> Result<i32, String> { s.set_star_rating(&path, stars) }
#[tauri::command] fn set_rotation(s: State<'_, AppState>, path: String, direction: i32) -> Result<i32, String> { s.set_rotation(&path, direction) }
#[tauri::command] fn toggle_pick(s: State<'_, AppState>, path: String) -> Result<bool, String> { s.toggle_pick(&path) }
#[tauri::command] fn delete_current_image(s: State<'_, AppState>) -> Result<Option<String>, String> { s.delete_current_image() }
#[tauri::command] fn undo_last_rating(s: State<'_, AppState>) -> Result<Option<String>, String> { s.undo_last_rating() }
#[tauri::command] fn finish_sorting(s: State<'_, AppState>) -> Result<(usize, HashMap<String, usize>), String> { s.finish_sorting() }

#[tauri::command]
fn get_image_data(s: State<'_, AppState>, path: String) -> Result<Vec<u8>, String> {
    if let Some(c) = s.image_cache.get_scaled(&path) { return Ok(c); }
    let d = load_and_scale_image(&path, 1920).ok_or_else(|| "Failed to load image.".to_string())?;
    s.image_cache.insert_scaled(&path, d.bytes.clone());
    Ok(d.bytes)
}

#[tauri::command]
fn get_full_image_data(s: State<'_, AppState>, path: String) -> Result<Vec<u8>, String> {
    if let Some(c) = s.image_cache.get_fullres(&path) { return Ok(c); }
    let d = load_image_unscaled(&path).ok_or_else(|| "Failed to load full res.".to_string())?;
    s.image_cache.insert_fullres(&path, d.bytes.clone());
    Ok(d.bytes)
}

#[tauri::command]
fn get_thumbnail_data(s: State<'_, AppState>, path: String) -> Result<Vec<u8>, String> {
    let db = s.db.read().unwrap().clone().ok_or("No DB session.")?;
    let pid = s.project_id.read().unwrap().ok_or("No project.")?;
    let record = db.get_image_by_path(pid, &path).map_err(|e| e.to_string())?.ok_or("Not found.")?;
    if let Ok(Some(b)) = db.get_thumbnail(record.id) { return Ok(b); }
    let t = generate_thumbnail(&path, 120).ok_or("Thumbnail failed.")?;
    db.save_thumbnail(record.id, &t).unwrap_or(());
    Ok(t)
}

#[tauri::command]
fn get_project_stats(s: State<'_, AppState>) -> Result<HashMap<String, usize>, String> {
    let r = s.results.read().unwrap();
    let mut stats: HashMap<String, usize> = [("bad",0),("ok",0),("good",0)].map(|(k,v)| (k.to_string(),v)).into();
    for v in r.values() { *stats.entry(v.to_lowercase()).or_insert(0) += 1; }
    drop(r);
    if let Ok(records) = s.db.read().unwrap().as_ref().unwrap().get_picked_images(s.project_id.read().unwrap().unwrap()) {
        stats.insert("PICKED".to_string(), records.len());
    }
    Ok(stats)
}

#[tauri::command]
fn get_date_hierarchy(s: State<'_, AppState>) -> Result<Vec<DateRecord>, String> {
    let db = s.db.read().unwrap().clone().ok_or("No DB.")?;
    let pid = s.project_id.read().unwrap().ok_or("No project.")?;
    db.get_date_hierarchy(pid).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_filters(s: State<'_, AppState>, text: String, folder: String, date: String, mode: String) -> Result<(), String> {
    *s.filter_text.write().unwrap() = text; *s.filter_folder.write().unwrap() = folder;
    *s.filter_date.write().unwrap() = date; *s.filter_mode.write().unwrap() = mode;
    s.apply_filters(); Ok(())
}

#[tauri::command] fn get_image_paths(s: State<'_, AppState>) -> Result<Vec<String>, String> { Ok(s.image_paths.read().unwrap().clone()) }
#[tauri::command] fn get_current_index(s: State<'_, AppState>) -> Result<i32, String> { Ok(*s.current_index.read().unwrap()) }

#[tauri::command]
fn set_current_index(s: State<'_, AppState>, index: i32) -> Result<(), String> {
    let p = s.image_paths.read().unwrap();
    if index >= 0 && index < p.len() as i32 { *s.current_index.write().unwrap() = index; Ok(()) }
    else { Err("Index out of bounds.".to_string()) }
}

#[tauri::command]
fn get_image_metadata_info(s: State<'_, AppState>, path: String) -> Result<Option<ImageRecord>, String> {
    let db = s.db.read().unwrap().clone().ok_or("No DB.")?;
    let pid = s.project_id.read().unwrap().ok_or("No project.")?;
    let mut record = db.get_image_by_path(pid, &path).map_err(|e| e.to_string())?;
    if let Some(ref mut rec) = record {
        if rec.camera_model.is_none() {
            if let Some(meta) = extract_exif(&path) {
                db.set_exif_data(rec.id, meta.iso, meta.aperture.as_deref(), meta.shutter_speed.as_deref(),
                    meta.focal_length.as_deref(), meta.lens.as_deref(), meta.camera_model.as_deref(),
                    meta.date_taken.as_deref(), meta.orientation).unwrap_or(());
                rec.iso = meta.iso; rec.aperture = meta.aperture; rec.shutter_speed = meta.shutter_speed;
                rec.focal_length = meta.focal_length; rec.lens = meta.lens; rec.camera_model = meta.camera_model;
                rec.date_taken = meta.date_taken; rec.rotation = meta.orientation.unwrap_or(0);
            }
        }
    }
    Ok(record)
}

#[tauri::command] fn toggle_filter_mode(s: State<'_, AppState>) -> Result<String, String> {
    let mut m = s.filter_mode.write().unwrap();
    *m = if m.as_str() == "unrated" { "all".to_string() } else { "unrated".to_string() };
    let n = m.clone(); drop(m); s.apply_filters(); Ok(n)
}

#[tauri::command]
fn get_recent_projects(app: tauri::AppHandle) -> Result<Vec<photo_sorter_v3::database::Project>, String> {
    let db = photo_sorter_v3::database::PhotoDatabase::new(get_db_path(&app)).map_err(|e| e.to_string())?;
    db.get_recent_projects().map_err(|e| e.to_string())
}

#[tauri::command] fn get_startup_folder(s: State<'_, AppState>) -> Option<String> { s.startup_folder.read().unwrap().clone() }

fn main() {
    let mut startup_folder = None;
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && (args[1] == "--help" || args[1] == "-h") {
        println!("Photo Sorter v{}", env!("CARGO_PKG_VERSION"));
        println!("Fast photo culling tool. Usage: photo-sorter-v3 [--folder <PATH>]");
        std::process::exit(0);
    }
    if args.len() > 1 && (args[1] == "--version" || args[1] == "-v") {
        println!("Photo Sorter v{}", env!("CARGO_PKG_VERSION")); std::process::exit(0);
    }
    let mut i = 1;
    while i < args.len() {
        if (args[i] == "--folder" || args[i] == "-f") && i + 1 < args.len() {
            startup_folder = Some(args[i + 1].clone()); i += 2;
        } else {
            let p = PathBuf::from(&args[i]);
            if p.is_dir() { startup_folder = Some(args[i].clone()); } i += 1;
        }
    }
    let state = AppState::new();
    if let Some(f) = startup_folder { *state.startup_folder.write().unwrap() = Some(f); }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .setup(|app| {
            let db_path = get_db_path(&app.handle());
            let state = app.state::<AppState>();
            match photo_sorter_v3::database::PhotoDatabase::new(db_path) {
                Ok(db) => { *state.db.write().unwrap() = Some(Arc::new(db)); }
                Err(e) => { eprintln!("DB init failed: {}", e); }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_folder, rate_image, set_star_rating, set_rotation, toggle_pick,
            delete_current_image, undo_last_rating, finish_sorting,
            get_image_data, get_full_image_data, get_thumbnail_data,
            get_project_stats, get_date_hierarchy, set_filters,
            get_image_paths, get_current_index, set_current_index,
            get_image_metadata_info, toggle_filter_mode,
            get_recent_projects, get_startup_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
