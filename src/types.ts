// Shared record types mirrored from the Rust backend (src-tauri/src/database.rs).
// Keep in sync with the serde field names on the Rust side.

export interface ImageRecord {
  id: number; project_id: number; path: string; filename: string;
  rating: string | null; pick: number; rotation: number; blur_score: number;
  star_rating: number; file_size: number | null; width: number | null; height: number | null;
  iso: number | null; aperture: string | null; shutter_speed: string | null;
  focal_length: string | null; lens: string | null; camera_model: string | null;
  date_taken: string | null;
}

export interface DateRecord { year: string; month: string; day: string; }

export interface Project { id: number; name: string; root_path: string; created_at: string; updated_at: string; }

export interface ProjectStats { [key: string]: number; PICKED: number; }

export interface CategoryRecord {
  id: number;
  key_name: string;
  label: string;
  folder_name: string;
  shortcut_key: string | null;
  flash_color: string;
  sort_order: number;
}

export interface KeybindingRecord {
  action_name: string;
  shortcut_key: string;
}

export interface HudItemRecord {
  action_name: string;
  visible: number;
  sort_order: number;
  group_name: string | null;
}
