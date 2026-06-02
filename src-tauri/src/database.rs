use rusqlite::{params, Connection, Result};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use serde::{Serialize, Deserialize};

const SCHEMA_VERSION: i32 = 2;

const SCHEMA_SQL: &str = "
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    path TEXT NOT NULL,
    filename TEXT NOT NULL,
    rating TEXT,
    pick INTEGER DEFAULT 0,
    rotation INTEGER DEFAULT 0,
    blur_score REAL DEFAULT 0.0,
    star_rating INTEGER DEFAULT 0,
    file_size INTEGER,
    file_hash TEXT,
    width INTEGER,
    height INTEGER,
    iso INTEGER,
    aperture TEXT,
    shutter_speed TEXT,
    focal_length TEXT,
    lens TEXT,
    camera_model TEXT,
    date_taken TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, path)
);

CREATE TABLE IF NOT EXISTS thumbnail_cache (
    image_id INTEGER PRIMARY KEY,
    jpeg_blob BLOB NOT NULL,
    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_images_project ON images(project_id);
CREATE INDEX IF NOT EXISTS idx_images_rating ON images(rating);
CREATE INDEX IF NOT EXISTS idx_images_path ON images(path);
CREATE INDEX IF NOT EXISTS idx_images_date ON images(date_taken);
";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub root_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageRecord {
    pub id: i64,
    pub project_id: i64,
    pub path: String,
    pub filename: String,
    pub rating: Option<String>,
    pub pick: i32,
    pub rotation: i32,
    pub blur_score: f64,
    pub star_rating: i32,
    pub file_size: Option<i64>,
    pub file_hash: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub iso: Option<i32>,
    pub aperture: Option<String>,
    pub shutter_speed: Option<String>,
    pub focal_length: Option<String>,
    pub lens: Option<String>,
    pub camera_model: Option<String>,
    pub date_taken: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DateRecord {
    pub year: String,
    pub month: String,
    pub day: String,
}

pub struct PhotoDatabase {
    conn: Mutex<Connection>,
}

impl PhotoDatabase {
    pub fn new<P: AsRef<Path>>(db_path: P) -> Result<Self> {
        let parent = db_path.as_ref().parent().unwrap();
        std::fs::create_dir_all(parent).unwrap_or(());
        
        let conn = Connection::open(db_path)?;
        
        // WAL mode for parallel speed
        conn.execute_batch("
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
        ")?;
        
        let db = PhotoDatabase {
            conn: Mutex::new(conn),
        };
        db.init_db()?;
        Ok(db)
    }

    fn init_db(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(SCHEMA_SQL)?;
        
        let current_ver: i32 = conn
            .query_row(
                "SELECT MAX(version) FROM schema_version",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
            
        if current_ver < SCHEMA_VERSION {
            conn.execute(
                "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
                params![SCHEMA_VERSION],
            )?;
        }
        Ok(())
    }

    // --- Projects ---
    pub fn get_or_create_project(&self, root_path: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let path_norm = PathBuf::from(root_path).canonicalize().unwrap_or_else(|_| PathBuf::from(root_path));
        let root_str = path_norm.to_string_lossy().into_owned();
        
        let project_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM projects WHERE root_path = ?",
                params![root_str],
                |row| row.get(0),
            )
            .ok();
            
        if let Some(id) = project_id {
            return Ok(id);
        }
        
        let now = chrono::Local::now().to_rfc3339();
        let name = Path::new(&root_str)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Untitled Project")
            .to_string();
            
        conn.execute(
            "INSERT INTO projects (name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?)",
            params![name, root_str, now, now],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_recent_projects(&self) -> Result<Vec<Project>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM projects ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    // --- Images ---
    pub fn sync_images(&self, project_id: i64, paths: &[String]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        
        let now = chrono::Local::now().to_rfc3339();
        
        // Find existing paths in project
        let existing_paths: std::collections::HashSet<String> = tx
            .prepare("SELECT path FROM images WHERE project_id = ?")?
            .query_map(params![project_id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
            
        let new_set: std::collections::HashSet<String> = paths.iter().cloned().collect();
        
        // Delete missing files
        for p in &existing_paths {
            if !new_set.contains(p) {
                tx.execute(
                    "DELETE FROM images WHERE project_id = ? AND path = ?",
                    params![project_id, p],
                )?;
            }
        }
        
        // Insert new ones
        {
            let mut insert_stmt = tx.prepare(
                "INSERT OR IGNORE INTO images (project_id, path, filename, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
            )?;
            
            for p in paths {
                if !existing_paths.contains(p) {
                    let filename = Path::new(p)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string();
                    insert_stmt.execute(params![project_id, p, filename, now, now])?;
                }
            }
        }
        
        tx.commit()?;
        Ok(())
    }

    pub fn get_image_by_path(&self, project_id: i64, path: &str) -> Result<Option<ImageRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM images WHERE project_id = ? AND path = ?")?;
        let record = stmt
            .query_row(params![project_id, path], |row| {
                Ok(ImageRecord {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    path: row.get(2)?,
                    filename: row.get(3)?,
                    rating: row.get(4)?,
                    pick: row.get(5)?,
                    rotation: row.get(6)?,
                    blur_score: row.get(7)?,
                    star_rating: row.get(8)?,
                    file_size: row.get(9)?,
                    file_hash: row.get(10)?,
                    width: row.get(11)?,
                    height: row.get(12)?,
                    iso: row.get(13)?,
                    aperture: row.get(14)?,
                    shutter_speed: row.get(15)?,
                    focal_length: row.get(16)?,
                    lens: row.get(17)?,
                    camera_model: row.get(18)?,
                    date_taken: row.get(19)?,
                    created_at: row.get(20)?,
                    updated_at: row.get(21)?,
                })
            })
            .ok();
        Ok(record)
    }

    pub fn get_images(&self, project_id: i64) -> Result<Vec<ImageRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM images WHERE project_id = ? ORDER BY filename")?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(ImageRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                path: row.get(2)?,
                filename: row.get(3)?,
                rating: row.get(4)?,
                pick: row.get(5)?,
                rotation: row.get(6)?,
                blur_score: row.get(7)?,
                star_rating: row.get(8)?,
                file_size: row.get(9)?,
                file_hash: row.get(10)?,
                width: row.get(11)?,
                height: row.get(12)?,
                iso: row.get(13)?,
                aperture: row.get(14)?,
                shutter_speed: row.get(15)?,
                focal_length: row.get(16)?,
                lens: row.get(17)?,
                camera_model: row.get(18)?,
                date_taken: row.get(19)?,
                created_at: row.get(20)?,
                updated_at: row.get(21)?,
            })
        })?;
        
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn set_rating(&self, image_id: i64, rating: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "UPDATE images SET rating = ?, updated_at = ? WHERE id = ?",
            params![rating, now, image_id],
        )?;
        Ok(())
    }

    pub fn set_pick(&self, image_id: i64, picked: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "UPDATE images SET pick = ?, updated_at = ? WHERE id = ?",
            params![if picked { 1 } else { 0 }, now, image_id],
        )?;
        Ok(())
    }

    pub fn set_star_rating(&self, image_id: i64, stars: i32) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Local::now().to_rfc3339();
        let stars = stars.clamp(0, 5);
        conn.execute(
            "UPDATE images SET star_rating = ?, updated_at = ? WHERE id = ?",
            params![stars, now, image_id],
        )?;
        Ok(())
    }

    pub fn set_rotation(&self, image_id: i64, rotation: i32) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "UPDATE images SET rotation = ?, updated_at = ? WHERE id = ?",
            params![rotation, now, image_id],
        )?;
        Ok(())
    }

    pub fn set_blur_score(&self, image_id: i64, score: f64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE images SET blur_score = ? WHERE id = ?",
            params![score, image_id],
        )?;
        Ok(())
    }

    pub fn set_exif_data(
        &self,
        image_id: i64,
        iso: Option<i32>,
        aperture: Option<&str>,
        shutter_speed: Option<&str>,
        focal_length: Option<&str>,
        lens: Option<&str>,
        camera_model: Option<&str>,
        date_taken: Option<&str>,
        rotation: Option<i32>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Local::now().to_rfc3339();
        if let Some(rot) = rotation {
            conn.execute(
                "UPDATE images SET 
                    iso = ?, aperture = ?, shutter_speed = ?,
                    focal_length = ?, lens = ?, camera_model = ?,
                    date_taken = ?, rotation = ?, updated_at = ?
                WHERE id = ?",
                params![
                    iso, aperture, shutter_speed,
                    focal_length, lens, camera_model,
                    date_taken, rot, now, image_id
                ],
            )?;
        } else {
            conn.execute(
                "UPDATE images SET 
                    iso = ?, aperture = ?, shutter_speed = ?,
                    focal_length = ?, lens = ?, camera_model = ?,
                    date_taken = ?, updated_at = ?
                WHERE id = ?",
                params![
                    iso, aperture, shutter_speed,
                    focal_length, lens, camera_model,
                    date_taken, now, image_id
                ],
            )?;
        }
        Ok(())
    }

    pub fn get_picked_images(&self, project_id: i64) -> Result<Vec<ImageRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM images WHERE project_id = ? AND pick = 1 ORDER BY filename")?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(ImageRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                path: row.get(2)?,
                filename: row.get(3)?,
                rating: row.get(4)?,
                pick: row.get(5)?,
                rotation: row.get(6)?,
                blur_score: row.get(7)?,
                star_rating: row.get(8)?,
                file_size: row.get(9)?,
                file_hash: row.get(10)?,
                width: row.get(11)?,
                height: row.get(12)?,
                iso: row.get(13)?,
                aperture: row.get(14)?,
                shutter_speed: row.get(15)?,
                focal_length: row.get(16)?,
                lens: row.get(17)?,
                camera_model: row.get(18)?,
                date_taken: row.get(19)?,
                created_at: row.get(20)?,
                updated_at: row.get(21)?,
            })
        })?;
        
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_images_by_date(&self, project_id: i64, date_prefix: &str) -> Result<Vec<ImageRecord>> {
        let conn = self.conn.lock().unwrap();
        let pattern = format!("{}%", date_prefix);
        let mut stmt = conn.prepare("SELECT * FROM images WHERE project_id = ? AND date_taken LIKE ? ORDER BY date_taken")?;
        let rows = stmt.query_map(params![project_id, pattern], |row| {
            Ok(ImageRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                path: row.get(2)?,
                filename: row.get(3)?,
                rating: row.get(4)?,
                pick: row.get(5)?,
                rotation: row.get(6)?,
                blur_score: row.get(7)?,
                star_rating: row.get(8)?,
                file_size: row.get(9)?,
                file_hash: row.get(10)?,
                width: row.get(11)?,
                height: row.get(12)?,
                iso: row.get(13)?,
                aperture: row.get(14)?,
                shutter_speed: row.get(15)?,
                focal_length: row.get(16)?,
                lens: row.get(17)?,
                camera_model: row.get(18)?,
                date_taken: row.get(19)?,
                created_at: row.get(20)?,
                updated_at: row.get(21)?,
            })
        })?;
        
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_date_hierarchy(&self, project_id: i64) -> Result<Vec<DateRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT 
                SUBSTR(date_taken, 1, 4) as year,
                SUBSTR(date_taken, 6, 2) as month,
                SUBSTR(date_taken, 9, 2) as day
             FROM images 
             WHERE project_id = ? AND date_taken IS NOT NULL
             ORDER BY year DESC, month DESC, day DESC"
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(DateRecord {
                year: row.get(0)?,
                month: row.get(1)?,
                day: row.get(2)?,
            })
        })?;
        
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn clear_ratings(&self, project_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "UPDATE images SET rating = NULL, updated_at = ? WHERE project_id = ?",
            params![now, project_id],
        )?;
        Ok(())
    }

    // --- Thumbnail Cache ---
    pub fn save_thumbnail(&self, image_id: i64, jpeg_blob: &[u8]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO thumbnail_cache (image_id, jpeg_blob) VALUES (?, ?)",
            params![image_id, jpeg_blob],
        )?;
        Ok(())
    }

    pub fn get_thumbnail(&self, image_id: i64) -> Result<Option<Vec<u8>>> {
        let conn = self.conn.lock().unwrap();
        let blob: Option<Vec<u8>> = conn
            .query_row(
                "SELECT jpeg_blob FROM thumbnail_cache WHERE image_id = ?",
                params![image_id],
                |row| row.get(0),
            )
            .ok();
        Ok(blob)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    fn setup_db() -> (PhotoDatabase, std::path::PathBuf) {
        let temp_dir = std::env::temp_dir();
        let count = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let db_path = temp_dir.join(format!("test_photosorter_{}_{}.db", std::process::id(), count));
        let _ = std::fs::remove_file(&db_path);
        let db = PhotoDatabase::new(&db_path).unwrap();
        (db, db_path)
    }

    fn seed_image(db: &PhotoDatabase, pid: i64, path: &str) -> ImageRecord {
        db.sync_images(pid, &[path.to_string()]).unwrap();
        db.get_image_by_path(pid, path).unwrap().unwrap()
    }

    #[test]
    fn test_create_project() {
        let (db, db_path) = setup_db();
        let pid = db.get_or_create_project("/test/photos").unwrap();
        assert!(pid > 0);
        let projects = db.get_recent_projects().unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].id, pid);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_sync_images() {
        let (db, db_path) = setup_db();
        let pid = db.get_or_create_project("/test/photos").unwrap();
        let paths = vec!["/test/photos/a.jpg".to_string(), "/test/photos/b.jpg".to_string()];
        db.sync_images(pid, &paths).unwrap();
        let images = db.get_images(pid).unwrap();
        assert_eq!(images.len(), 2);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_sync_removes_deleted() {
        let (db, db_path) = setup_db();
        let pid = db.get_or_create_project("/test/photos").unwrap();
        db.sync_images(pid, &["/test/photos/a.jpg".to_string(), "/test/photos/b.jpg".to_string()]).unwrap();
        db.sync_images(pid, &["/test/photos/a.jpg".to_string()]).unwrap();
        assert_eq!(db.get_images(pid).unwrap().len(), 1);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_set_rating() {
        let (db, db_path) = setup_db();
        let pid = db.get_or_create_project("/test").unwrap();
        let img = seed_image(&db, pid, "/test/img.jpg");
        db.set_rating(img.id, Some("GOOD")).unwrap();
        let updated = db.get_image_by_path(pid, "/test/img.jpg").unwrap().unwrap();
        assert_eq!(updated.rating.as_deref(), Some("GOOD"));
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_unrate() {
        let (db, db_path) = setup_db();
        let pid = db.get_or_create_project("/test").unwrap();
        let img = seed_image(&db, pid, "/test/img.jpg");
        db.set_rating(img.id, Some("GOOD")).unwrap();
        db.set_rating(img.id, None).unwrap();
        let updated = db.get_image_by_path(pid, "/test/img.jpg").unwrap().unwrap();
        assert_eq!(updated.rating, None);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_pick_flag() {
        let (db, db_path) = setup_db();
        let pid = db.get_or_create_project("/test").unwrap();
        let img = seed_image(&db, pid, "/test/img.jpg");
        db.set_pick(img.id, true).unwrap();
        assert_eq!(db.get_image_by_path(pid, "/test/img.jpg").unwrap().unwrap().pick, 1);
        db.set_pick(img.id, false).unwrap();
        assert_eq!(db.get_image_by_path(pid, "/test/img.jpg").unwrap().unwrap().pick, 0);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_star_rating() {
        let (db, db_path) = setup_db();
        let pid = db.get_or_create_project("/test").unwrap();
        let img = seed_image(&db, pid, "/test/img.jpg");
        db.set_star_rating(img.id, 3).unwrap();
        let updated = db.get_image_by_path(pid, "/test/img.jpg").unwrap().unwrap();
        assert_eq!(updated.star_rating, 3);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_clear_ratings() {
        let (db, db_path) = setup_db();
        let pid = db.get_or_create_project("/test").unwrap();
        let img = seed_image(&db, pid, "/test/img.jpg");
        db.set_rating(img.id, Some("GOOD")).unwrap();
        db.clear_ratings(pid).unwrap();
        let updated = db.get_image_by_path(pid, "/test/img.jpg").unwrap().unwrap();
        assert_eq!(updated.rating, None);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_picked_images() {
        let (db, db_path) = setup_db();
        let pid = db.get_or_create_project("/test").unwrap();
        let img = seed_image(&db, pid, "/test/img.jpg");
        db.set_pick(img.id, true).unwrap();
        let picked = db.get_picked_images(pid).unwrap();
        assert_eq!(picked.len(), 1);
        let _ = std::fs::remove_file(&db_path);
    }
}

