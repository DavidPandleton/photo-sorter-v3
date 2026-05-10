import datetime
import json
import logging
import os
from pathlib import Path

from PyQt6.QtCore import QObject, QTimer, pyqtSignal
from PyQt6.QtGui import QColor

from .project import ProjectManager
from .utils import RAW_EXTENSIONS, compute_file_metadata, safe_move


class PhotoController(QObject):
    """Business-logic layer for Photo Sorter.
    Owns all mutable state and emits signals so the UI stays decoupled."""

    rating_changed = pyqtSignal(str, object)  # path, QColor flash
    stats_updated = pyqtSignal()
    image_navigated = pyqtSignal(str)  # new current path
    pick_toggled = pyqtSignal(bool)  # new pick state
    star_changed = pyqtSignal(int)  # new star rating
    rotation_applied = pyqtSignal(int)  # new rotation
    filter_applied = pyqtSignal(list)  # filtered path list
    export_finished = pyqtSignal(int, dict)  # moved_count, summary
    reset = pyqtSignal()
    info_changed = pyqtSignal(str, str, str)  # progress, filename, type
    filmstrip_rebuild_needed = pyqtSignal(list)  # paths
    filmstrip_rating_needed = pyqtSignal(str, object)  # path, rating or None
    show_message = pyqtSignal(str, str)  # title, message

    def __init__(self, parent=None):
        super().__init__(parent)
        self.image_paths: list[str] = []
        self.current_index = -1
        self.results: dict[str, str] = {}
        self.rotations: dict[str, int] = {}
        self.blur_scores: dict[str, float] = {}
        self.undo_stack: list[tuple[str, str | None]] = []
        self.filter_mode = "all"
        self.root_folder = ""
        self.is_processing = False
        self.project_mgr = ProjectManager()

        # Filter state
        self._filter_folder = ""
        self._filter_text = ""
        self._filter_rating = "All"

    # ----- image loading -----

    def load_images(self, root_folder: str) -> bool:
        """Scan folder, sync DB, restore persisted state.
        Returns True on success, emits signals for UI updates."""
        self.root_folder = os.path.abspath(root_folder)
        exts = {".jpg", ".jpeg", ".png", ".webp"} | set(RAW_EXTENSIONS)
        paths = []
        managed = {"BAD", "OK", "GOOD"}
        for r, _, fs in os.walk(self.root_folder):
            rel_path = Path(r).relative_to(self.root_folder)
            if any(part.upper() in managed for part in rel_path.parts):
                continue
            for f in fs:
                if Path(f).suffix.lower() in exts:
                    paths.append(os.path.abspath(os.path.join(r, f)))
        if not paths:
            return False

        self.image_paths = paths
        self.project_mgr.open_folder(self.root_folder)
        db = self.project_mgr.db
        pid = self.project_mgr.current_project["id"]
        db.sync_images(pid, self.image_paths)

        self.results = {}
        self.rotations = {}
        for img in db.get_images(pid):
            if img["rating"]:
                self.results[img["path"]] = img["rating"]
            if img["rotation"]:
                self.rotations[img["path"]] = img["rotation"]

        self.current_index = 0
        self._filter_folder = ""
        self._filter_text = ""
        self._filter_rating = "All"

        self.filmstrip_rebuild_needed.emit(self.image_paths)
        self.stats_updated.emit()
        self.display_current()
        return True

    def get_db(self):
        if self.project_mgr.db and self.project_mgr.current_project:
            return self.project_mgr.db
        return None

    def get_project_id(self):
        if self.project_mgr.current_project:
            return self.project_mgr.current_project["id"]
        return None

    def get_image(self, path: str):
        db = self.get_db()
        pid = self.get_project_id()
        if db and pid:
            return db.get_image_by_path(pid, path)
        return None

    def get_date_hierarchy(self):
        db = self.get_db()
        pid = self.get_project_id()
        if db and pid:
            return db.get_date_hierarchy(pid)
        return []

    # ----- navigation -----

    def display_current(self):
        if 0 <= self.current_index < len(self.image_paths):
            path = self.image_paths[self.current_index]
            if not os.path.exists(path):
                logging.warning(f"File missing, skipping: {path}")
                self.results.pop(path, None)
                self.image_paths.pop(self.current_index)
                if self.current_index >= len(self.image_paths):
                    self.current_index = max(0, len(self.image_paths) - 1)
                self.filmstrip_rebuild_needed.emit(self.image_paths)
                self.stats_updated.emit()
                if self.image_paths:
                    self.display_current()
                else:
                    self.reset_to_menu()
                return
            self.image_navigated.emit(path)
            self.emit_info(path)
        else:
            self.current_index = max(0, min(self.current_index, len(self.image_paths) - 1))

    def emit_info(self, path: str):
        progress = f"{self.current_index + 1} / {len(self.image_paths)}"
        filename = os.path.basename(path)
        ext = Path(path).suffix[1:].upper()
        raw_suffix = f".{ext.lower()}" if ext else ""
        img_type = f"{ext} {'(RAW)' if raw_suffix in RAW_EXTENSIONS else ''}"
        self.info_changed.emit(progress, filename, img_type)

    def next_image(self):
        if self.current_index >= len(self.image_paths) - 1:
            return
        for i in range(self.current_index + 1, len(self.image_paths)):
            if self.filter_mode == "unrated" and self.image_paths[i] in self.results:
                continue
            self.current_index = i
            self.display_current()
            return
        self.current_index = len(self.image_paths) - 1
        self.display_current()

    def prev_image(self):
        if self.current_index <= 0:
            return
        for i in range(self.current_index - 1, -1, -1):
            if self.filter_mode == "unrated" and self.image_paths[i] in self.results:
                continue
            self.current_index = i
            self.display_current()
            return
        self.current_index = 0
        self.display_current()

    def jump_to_image_by_path(self, path: str):
        if path in self.image_paths:
            self.current_index = self.image_paths.index(path)
            self.display_current()

    def jump_to_number(self, n: int):
        if 0 <= n < len(self.image_paths):
            self.current_index = n
            self.display_current()

    # ----- rating -----

    def rate_current_image(self, category: str, color: QColor):
        if self.current_index < 0 or self.is_processing:
            return
        self.is_processing = True
        path = self.image_paths[self.current_index]
        old_rating = self.results.get(path)
        self.undo_stack.append((path, old_rating))
        self.results[path] = category
        db = self.get_db()
        pid = self.get_project_id()
        if db and pid:
            img = db.get_image_by_path(pid, path)
            if img:
                db.set_rating(img["id"], category)
        self.rating_changed.emit(path, color)
        self.filmstrip_rating_needed.emit(path, category)
        self.stats_updated.emit()
        QTimer.singleShot(100, self._after_rating)

    def _after_rating(self):
        self.next_image()
        self.is_processing = False

    def unrate_current_image(self):
        if self.current_index < 0:
            return
        path = self.image_paths[self.current_index]
        if path in self.results:
            del self.results[path]
            db = self.get_db()
            pid = self.get_project_id()
            if db and pid:
                img = db.get_image_by_path(pid, path)
                if img:
                    db.set_rating(img["id"], None)
            self.filmstrip_rating_needed.emit(path, None)
            self.stats_updated.emit()
            self.rating_changed.emit(path, QColor(100, 100, 100))

    def undo_last_rating(self):
        if not self.undo_stack:
            return
        path, old_rating = self.undo_stack.pop()
        if old_rating is None:
            self.results.pop(path, None)
        else:
            self.results[path] = old_rating
        db = self.get_db()
        pid = self.get_project_id()
        if db and pid:
            img = db.get_image_by_path(pid, path)
            if img:
                db.set_rating(img["id"], old_rating)
            self.filmstrip_rating_needed.emit(path, old_rating)
        self.stats_updated.emit()

    # ----- pick / stars -----

    def toggle_pick(self):
        if self.current_index < 0:
            return
        path = self.image_paths[self.current_index]
        db = self.get_db()
        pid = self.get_project_id()
        if db and pid:
            img = db.get_image_by_path(pid, path)
            if img:
                picked = db.toggle_pick(img["id"])
                self.pick_toggled.emit(picked)
                self.stats_updated.emit()

    def set_star_rating(self, stars: int):
        if self.current_index < 0:
            return
        path = self.image_paths[self.current_index]
        db = self.get_db()
        pid = self.get_project_id()
        if db and pid:
            img = db.get_image_by_path(pid, path)
            if img:
                current = img["star_rating"]
                new_stars = stars if stars != current else 0
                db.set_star_rating(img["id"], new_stars)
                self.star_changed.emit(new_stars)
                self.stats_updated.emit()

    # ----- rotation -----

    def rotate_current_image(self, direction: int):
        if self.current_index < 0 or self.is_processing:
            return
        path = self.image_paths[self.current_index]
        current_rot = self.rotations.get(path, 0)
        new_rot = (current_rot + (direction * 90)) % 360
        self.rotations[path] = new_rot
        db = self.get_db()
        pid = self.get_project_id()
        if db and pid:
            img = db.get_image_by_path(pid, path)
            if img:
                db.set_rotation(img["id"], new_rot)
        self.rotation_applied.emit(new_rot)

    # ----- delete -----

    def delete_current_image(self) -> str | None:
        """Permanently delete. Returns the path if successful, None otherwise."""
        if self.current_index < 0:
            return None
        path = self.image_paths[self.current_index]
        try:
            os.remove(path)
            logging.info(f"Deleted: {path}")
        except Exception:
            return None
        db = self.get_db()
        pid = self.get_project_id()
        if db and pid:
            img = db.get_image_by_path(pid, path)
            if img:
                db.set_rating(img["id"], None)
        self.results.pop(path, None)
        self.image_paths.pop(self.current_index)
        if self.current_index >= len(self.image_paths):
            self.current_index = len(self.image_paths) - 1
        self.filmstrip_rebuild_needed.emit(self.image_paths)
        self.stats_updated.emit()
        self.display_current()
        return path

    # ----- filter / search -----

    def toggle_filter_mode(self):
        self.filter_mode = "unrated" if self.filter_mode == "all" else "all"
        self.stats_updated.emit()
        return self.filter_mode

    def on_search_changed(self, text: str):
        self._filter_text = text.strip().lower()
        self._apply_filters()

    def on_filter_changed(self, rating: str):
        self._filter_rating = rating
        self._apply_filters()

    def on_folder_selected(self, folder_path: str):
        self._filter_folder = folder_path
        self._apply_filters()

    def on_date_selected(self, date_prefix: str):
        db = self.get_db()
        pid = self.get_project_id()
        if db and pid:
            images = db.get_images_by_date(pid, date_prefix)
            self.image_paths = [img["path"] for img in images]
            self.current_index = 0
            self.filmstrip_rebuild_needed.emit(self.image_paths)
            self.stats_updated.emit()
            self.display_current()

    def _apply_filters(self):
        db = self.get_db()
        pid = self.get_project_id()
        if not db or not pid:
            return
        if self._filter_rating == "Picked":
            images = db.get_picked_images(pid)
        elif self._filter_rating == "Unrated":
            images = db.get_unrated_images(pid)
        elif self._filter_rating in ("BAD", "OK", "GOOD"):
            images = db.get_images(pid, self._filter_rating)
        else:
            images = db.get_images(pid)
        all_paths = [img["path"] for img in images]

        if self._filter_text:
            all_paths = [p for p in all_paths if self._filter_text in p.lower()]
        if self._filter_folder:
            folder = self._filter_folder.lower()
            all_paths = [p for p in all_paths if p.lower().startswith(folder)]

        self.image_paths = all_paths
        if self.current_index >= len(self.image_paths):
            self.current_index = max(0, len(self.image_paths) - 1)
        self.filmstrip_rebuild_needed.emit(self.image_paths)
        self.stats_updated.emit()
        self.display_current()

    # ----- export / checkpoint -----

    def create_checkpoint(self, created_folders=None, operations=None):
        cp_path = os.path.join(self.root_folder, ".photosorter_checkpoint.json")
        data = {}
        if os.path.exists(cp_path):
            try:
                with open(cp_path) as f:
                    data = json.load(f)
            except Exception:
                pass

        if not data or data.get("version") != "2.0":
            data = {
                "version": "2.0",
                "root": self.root_folder,
                "created_by": "PhotoSorterV1",
                "created_at": datetime.datetime.now().isoformat(),
                "created_folders": [],
                "operations": [],
            }

        if created_folders:
            existing = data.get("created_folders", [])
            for f in created_folders:
                if f not in existing:
                    existing.append(f)
            data["created_folders"] = existing

        if operations:
            data.setdefault("operations", []).extend(operations)

        tmp_path = cp_path + ".tmp"
        try:
            with open(tmp_path, "w") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp_path, cp_path)
            logging.info(f"Checkpoint updated: {cp_path}")
        except Exception as e:
            logging.error(f"Checkpoint failed: {e}")
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

    def checkpoint_exists(self) -> bool:
        cp_path = os.path.join(self.root_folder, ".photosorter_checkpoint.json")
        return os.path.exists(cp_path)

    def finish_sorting(self):
        if not self.results:
            return
        moved_count = 0
        newly_created = []
        operations = []

        for path, category in self.results.items():
            try:
                rel_path = Path(path).relative_to(self.root_folder)
                target_path = os.path.join(self.root_folder, category, str(rel_path))
                target_dir = os.path.dirname(target_path)
                rel_target_dir = str(Path(target_dir).relative_to(self.root_folder))

                if not os.path.exists(target_dir):
                    os.makedirs(target_dir, exist_ok=True)
                    parts = Path(rel_target_dir).parts
                    curr = ""
                    for p in parts:
                        curr = os.path.join(curr, p) if curr else p
                        if curr not in newly_created:
                            newly_created.append(curr)

                if os.path.exists(path):
                    size, sha1 = compute_file_metadata(path)
                    safe_move(path, target_path)
                    moved_count += 1
                    operations.append({
                        "original_path": path,
                        "exported_path": target_path,
                        "category": category,
                        "status": "completed",
                        "size": size,
                        "sha1": sha1,
                    })
            except Exception as e:
                logging.error(f"Move failed for {path}: {e}")

        self.create_checkpoint(created_folders=newly_created, operations=operations)

        db = self.get_db()
        pid = self.get_project_id()
        if db and pid:
            db.clear_ratings(pid)

        summary = {"BAD": 0, "OK": 0, "GOOD": 0}
        for cat in self.results.values():
            summary[cat] += 1

        self.export_finished.emit(moved_count, summary)
        self.reset_to_menu()

    def restore_checkpoint(self) -> int:
        """Restore from checkpoint file. Returns number of restored files."""
        cp_path = os.path.join(self.root_folder, ".photosorter_checkpoint.json")
        if not os.path.exists(cp_path):
            return -1
        try:
            with open(cp_path) as f:
                data = json.load(f)
            restored = 0
            if data.get("version") == "2.0":
                for op in data.get("operations", []):
                    orig = op.get("original_path")
                    exp = op.get("exported_path")
                    if os.path.exists(exp):
                        os.makedirs(os.path.dirname(orig), exist_ok=True)
                        safe_move(exp, orig)
                        restored += 1
            else:
                for original_path in data.get("files", []):
                    if os.path.exists(original_path):
                        continue
                    filename = os.path.basename(original_path)
                    for cat in ["BAD", "OK", "GOOD"]:
                        search_path = os.path.join(self.root_folder, cat, filename)
                        if os.path.exists(search_path):
                            os.makedirs(os.path.dirname(original_path), exist_ok=True)
                            safe_move(search_path, original_path)
                            restored += 1
                            break

            folders = data.get("created_folders", [])
            folders.sort(key=lambda x: len(Path(x).parts), reverse=True)
            for folder in folders:
                fpath = os.path.join(self.root_folder, folder)
                if os.path.exists(fpath) and not os.listdir(fpath):
                    try:
                        os.rmdir(fpath)
                    except Exception:
                        pass

            db = self.get_db()
            pid = self.get_project_id()
            if db and pid:
                db.clear_ratings(pid)

            return restored
        except Exception as e:
            logging.error(f"Restore failed: {e}")
            return -1

    # ----- state -----

    def reset_to_menu(self):
        self.image_paths = []
        self.results = {}
        self.rotations = {}
        self.blur_scores = {}
        self.undo_stack = []
        self.current_index = -1
        self.root_folder = ""
        self.is_processing = False
        self.filter_mode = "all"
        self.project_mgr.close()
        self.reset.emit()

    def get_stats_counts(self) -> dict:
        counts = {"BAD": 0, "OK": 0, "GOOD": 0}
        for cat in self.results.values():
            if cat in counts:
                counts[cat] += 1
        return counts

    def get_pick_count(self) -> int:
        db = self.get_db()
        pid = self.get_project_id()
        if db and pid:
            return len(db.get_picked_images(pid))
        return 0
