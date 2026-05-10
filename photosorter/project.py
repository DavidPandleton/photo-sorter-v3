import datetime
import json
from pathlib import Path
from typing import Optional

from .database import PhotoDatabase

PROJECT_DIR = Path.home() / ".photosorter"
PROJECT_INDEX_PATH = PROJECT_DIR / "projects.json"
DEFAULT_DB_DIR = PROJECT_DIR / "dbs"


class ProjectManager:
    def __init__(self):
        PROJECT_DIR.mkdir(parents=True, exist_ok=True)
        DEFAULT_DB_DIR.mkdir(parents=True, exist_ok=True)
        self._current_project: Optional[dict] = None
        self._db: Optional[PhotoDatabase] = None

    @property
    def db(self) -> Optional[PhotoDatabase]:
        return self._db

    @property
    def current_project(self) -> Optional[dict]:
        return self._current_project

    def open_folder(self, folder_path: str) -> PhotoDatabase:
        root = str(Path(folder_path).resolve())
        db_path = DEFAULT_DB_DIR / f"{Path(root).name}_{abs(hash(root))}.db"
        self._db = PhotoDatabase(db_path)
        project_id = self._db.get_or_create_project(root)
        self._current_project = self._db.get_project(project_id)
        self._save_project_index()
        return self._db

    def _save_project_index(self):
        projects = self._load_project_index()
        if self._current_project:
            found = False
            for p in projects:
                if p["id"] == self._current_project["id"]:
                    p["last_opened"] = datetime.datetime.now().isoformat()
                    found = True
                    break
            if not found:
                projects.append(
                    {
                        "id": self._current_project["id"],
                        "name": self._current_project["name"],
                        "root_path": self._current_project["root_path"],
                        "last_opened": datetime.datetime.now().isoformat(),
                    }
                )
        try:
            with open(PROJECT_INDEX_PATH, "w") as f:
                json.dump(projects, f, indent=2)
        except OSError:
            pass

    def _load_project_index(self) -> list[dict]:
        try:
            if PROJECT_INDEX_PATH.exists():
                with open(PROJECT_INDEX_PATH) as f:
                    return json.load(f)
        except (OSError, json.JSONDecodeError):
            pass
        return []

    def get_recent_projects(self) -> list[dict]:
        projects = self._load_project_index()
        projects.sort(key=lambda p: p.get("last_opened", ""), reverse=True)
        return projects

    def close(self):
        if self._db:
            self._db.close()
            self._db = None
