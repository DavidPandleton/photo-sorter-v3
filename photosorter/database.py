import datetime
import sqlite3
import threading
from pathlib import Path
from typing import Optional

SCHEMA_VERSION = 1

SCHEMA_SQL = """
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

CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    is_smart INTEGER DEFAULT 0,
    filter_rule TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS image_collections (
    image_id INTEGER NOT NULL,
    collection_id INTEGER NOT NULL,
    PRIMARY KEY (image_id, collection_id),
    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
    FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS image_tags (
    image_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (image_id, tag_id),
    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_images_project ON images(project_id);
CREATE INDEX IF NOT EXISTS idx_images_rating ON images(rating);
CREATE INDEX IF NOT EXISTS idx_images_path ON images(path);
CREATE INDEX IF NOT EXISTS idx_images_date ON images(date_taken);
CREATE INDEX IF NOT EXISTS idx_collections_project ON collections(project_id);
"""


class PhotoDatabase:
    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        self._local = threading.local()
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(
                str(self.db_path), check_same_thread=False
            )
            self._local.conn.row_factory = sqlite3.Row
            self._local.conn.execute("PRAGMA journal_mode=WAL")
            self._local.conn.execute("PRAGMA foreign_keys=ON")
        return self._local.conn

    def _init_db(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = self._get_conn()
        conn.executescript(SCHEMA_SQL)
        row = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
        current_ver = row[0] if row[0] else 0
        if current_ver < SCHEMA_VERSION:
            conn.execute(
                "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
                (SCHEMA_VERSION,),
            )
        conn.commit()

    def close(self):
        if hasattr(self._local, "conn") and self._local.conn:
            self._local.conn.close()
            self._local.conn = None

    # --- Projects ---

    def get_or_create_project(self, root_path: str) -> int:
        conn = self._get_conn()
        root_path = str(Path(root_path).resolve())
        row = conn.execute(
            "SELECT id FROM projects WHERE root_path = ?", (root_path,)
        ).fetchone()
        if row:
            return row["id"]
        now = datetime.datetime.now().isoformat()
        name = Path(root_path).name
        cur = conn.execute(
            "INSERT INTO projects (name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (name, root_path, now, now),
        )
        conn.commit()
        return cur.lastrowid

    def get_project(self, project_id: int) -> Optional[dict]:
        row = self._get_conn().execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        return dict(row) if row else None

    def get_all_projects(self) -> list[dict]:
        rows = self._get_conn().execute(
            "SELECT * FROM projects ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    # --- Images ---

    def sync_images(self, project_id: int, paths: list[str]) -> None:
        conn = self._get_conn()
        now = datetime.datetime.now().isoformat()
        existing = {
            r["path"]
            for r in conn.execute(
                "SELECT path FROM images WHERE project_id = ?", (project_id,)
            ).fetchall()
        }
        new_paths = set(paths)
        removed = existing - new_paths
        for path in removed:
            conn.execute(
                "DELETE FROM images WHERE project_id = ? AND path = ?",
                (project_id, path),
            )
        for path in new_paths:
            if path not in existing:
                conn.execute(
                    """INSERT OR IGNORE INTO images
                    (project_id, path, filename, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)""",
                    (project_id, path, Path(path).name, now, now),
                )
        conn.commit()

    def set_rating(self, image_id: int, rating: str | None) -> None:
        now = datetime.datetime.now().isoformat()
        self._get_conn().execute(
            "UPDATE images SET rating = ?, updated_at = ? WHERE id = ?",
            (rating, now, image_id),
        )
        self._get_conn().commit()

    def set_pick(self, image_id: int, picked: bool) -> None:
        now = datetime.datetime.now().isoformat()
        self._get_conn().execute(
            "UPDATE images SET pick = ?, updated_at = ? WHERE id = ?",
            (1 if picked else 0, now, image_id),
        )
        self._get_conn().commit()

    def toggle_pick(self, image_id: int) -> bool:
        img = self.get_image(image_id)
        if not img:
            return False
        new_val = 0 if img["pick"] else 1
        self.set_pick(image_id, bool(new_val))
        return bool(new_val)

    def set_star_rating(self, image_id: int, stars: int) -> None:
        now = datetime.datetime.now().isoformat()
        stars = max(0, min(5, stars))
        self._get_conn().execute(
            "UPDATE images SET star_rating = ?, updated_at = ? WHERE id = ?",
            (stars, now, image_id),
        )
        self._get_conn().commit()

    def set_rotation(self, image_id: int, rotation: int) -> None:
        now = datetime.datetime.now().isoformat()
        self._get_conn().execute(
            "UPDATE images SET rotation = ?, updated_at = ? WHERE id = ?",
            (rotation, now, image_id),
        )
        self._get_conn().commit()

    def set_blur_score(self, image_id: int, score: float) -> None:
        self._get_conn().execute(
            "UPDATE images SET blur_score = ? WHERE id = ?", (score, image_id)
        )
        self._get_conn().commit()

    def update_exif(self, image_id: int, exif: dict) -> None:
        now = datetime.datetime.now().isoformat()
        fields = {
            "iso": exif.get("iso"),
            "aperture": exif.get("aperture"),
            "shutter_speed": exif.get("shutter_speed"),
            "focal_length": exif.get("focal_length"),
            "lens": exif.get("lens"),
            "camera_model": exif.get("camera_model"),
            "date_taken": exif.get("date_taken"),
            "file_size": exif.get("file_size"),
            "width": exif.get("width"),
            "height": exif.get("height"),
            "file_hash": exif.get("file_hash"),
        }
        fields = {k: v for k, v in fields.items() if v is not None}
        if not fields:
            return
        fields["updated_at"] = now
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [image_id]
        self._get_conn().execute(
            f"UPDATE images SET {set_clause} WHERE id = ?", values
        )
        self._get_conn().commit()

    def get_image(self, image_id: int) -> Optional[dict]:
        row = self._get_conn().execute(
            "SELECT * FROM images WHERE id = ?", (image_id,)
        ).fetchone()
        return dict(row) if row else None

    def get_image_by_path(self, project_id: int, path: str) -> Optional[dict]:
        row = self._get_conn().execute(
            "SELECT * FROM images WHERE project_id = ? AND path = ?",
            (project_id, path),
        ).fetchone()
        return dict(row) if row else None

    def get_images(self, project_id: int, rating: str | None = None) -> list[dict]:
        if rating:
            rows = self._get_conn().execute(
                "SELECT * FROM images WHERE project_id = ? AND rating = ? ORDER BY filename",
                (project_id, rating),
            ).fetchall()
        else:
            rows = self._get_conn().execute(
                "SELECT * FROM images WHERE project_id = ? ORDER BY filename",
                (project_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_unrated_images(self, project_id: int) -> list[dict]:
        rows = self._get_conn().execute(
            "SELECT * FROM images WHERE project_id = ? AND rating IS NULL ORDER BY filename",
            (project_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_picked_images(self, project_id: int) -> list[dict]:
        rows = self._get_conn().execute(
            "SELECT * FROM images WHERE project_id = ? AND pick = 1 ORDER BY filename",
            (project_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def search_images(self, project_id: int, query: str) -> list[dict]:
        like = f"%{query}%"
        rows = self._get_conn().execute(
            """SELECT * FROM images WHERE project_id = ?
            AND (filename LIKE ? OR lens LIKE ? OR camera_model LIKE ?)
            ORDER BY filename""",
            (project_id, like, like, like),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_images_by_date(self, project_id: int, date_prefix: str) -> list[dict]:
        rows = self._get_conn().execute(
            """SELECT * FROM images WHERE project_id = ?
            AND date_taken LIKE ? ORDER BY date_taken""",
            (project_id, f"{date_prefix}%"),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_date_hierarchy(self, project_id: int) -> list[dict]:
        rows = self._get_conn().execute(
            """SELECT DISTINCT SUBSTR(date_taken, 1, 4) as year,
                SUBSTR(date_taken, 6, 2) as month,
                SUBSTR(date_taken, 9, 2) as day
            FROM images WHERE project_id = ? AND date_taken IS NOT NULL
            ORDER BY year DESC, month DESC, day DESC""",
            (project_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_rating_counts(self, project_id: int) -> dict[str, int]:
        rows = self._get_conn().execute(
            """SELECT rating, COUNT(*) as cnt FROM images
            WHERE project_id = ? AND rating IS NOT NULL
            GROUP BY rating""",
            (project_id,),
        ).fetchall()
        counts = {"BAD": 0, "OK": 0, "GOOD": 0}
        for r in rows:
            if r["rating"] in counts:
                counts[r["rating"]] = r["cnt"]
        return counts

    def get_total_count(self, project_id: int) -> int:
        row = self._get_conn().execute(
            "SELECT COUNT(*) as cnt FROM images WHERE project_id = ?",
            (project_id,),
        ).fetchone()
        return row["cnt"] if row else 0

    # --- Collections ---

    def create_collection(
        self, project_id: int, name: str, is_smart: bool = False, filter_rule: str | None = None
    ) -> int:
        cur = self._get_conn().execute(
            "INSERT INTO collections (project_id, name, is_smart, filter_rule) VALUES (?, ?, ?, ?)",
            (project_id, name, 1 if is_smart else 0, filter_rule),
        )
        self._get_conn().commit()
        return cur.lastrowid

    def add_image_to_collection(self, image_id: int, collection_id: int) -> None:
        self._get_conn().execute(
            "INSERT OR IGNORE INTO image_collections (image_id, collection_id) VALUES (?, ?)",
            (image_id, collection_id),
        )
        self._get_conn().commit()

    def remove_image_from_collection(self, image_id: int, collection_id: int) -> None:
        self._get_conn().execute(
            "DELETE FROM image_collections WHERE image_id = ? AND collection_id = ?",
            (image_id, collection_id),
        )
        self._get_conn().commit()

    def get_collections(self, project_id: int) -> list[dict]:
        rows = self._get_conn().execute(
            "SELECT * FROM collections WHERE project_id = ? ORDER BY name",
            (project_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    # --- Tags ---

    def add_tag(self, image_id: int, tag_name: str) -> None:
        conn = self._get_conn()
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag_name,))
        tag_row = conn.execute(
            "SELECT id FROM tags WHERE name = ?", (tag_name,)
        ).fetchone()
        if tag_row:
            conn.execute(
                "INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)",
                (image_id, tag_row["id"]),
            )
        conn.commit()

    def remove_tag(self, image_id: int, tag_name: str) -> None:
        conn = self._get_conn()
        tag_row = conn.execute(
            "SELECT id FROM tags WHERE name = ?", (tag_name,)
        ).fetchone()
        if tag_row:
            conn.execute(
                "DELETE FROM image_tags WHERE image_id = ? AND tag_id = ?",
                (image_id, tag_row["id"]),
            )
        conn.commit()

    def get_tags(self, image_id: int) -> list[str]:
        rows = self._get_conn().execute(
            """SELECT t.name FROM tags t
            JOIN image_tags it ON t.id = it.tag_id
            WHERE it.image_id = ? ORDER BY t.name""",
            (image_id,),
        ).fetchall()
        return [r["name"] for r in rows]

    # --- Export (get paths by rating for checkpoint) ---

    def get_export_paths(self, project_id: int) -> dict[str, list[dict]]:
        result = {"BAD": [], "OK": [], "GOOD": []}
        for rating in result:
            rows = self._get_conn().execute(
                "SELECT path, file_size, file_hash FROM images WHERE project_id = ? AND rating = ?",
                (project_id, rating),
            ).fetchall()
            result[rating] = [dict(r) for r in rows]
        return result

    def clear_ratings(self, project_id: int) -> None:
        now = datetime.datetime.now().isoformat()
        self._get_conn().execute(
            "UPDATE images SET rating = NULL, updated_at = ? WHERE project_id = ?",
            (now, project_id),
        )
        self._get_conn().commit()
