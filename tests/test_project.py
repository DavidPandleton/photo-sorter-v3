import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from photosorter.project import ProjectManager


@pytest.fixture
def isolated_project_dir():
    with tempfile.TemporaryDirectory() as tmp:
        with patch("photosorter.project.PROJECT_DIR", Path(tmp)):
            with patch("photosorter.project.PROJECT_INDEX_PATH", Path(tmp) / "projects.json"):
                with patch("photosorter.project.DEFAULT_DB_DIR", Path(tmp) / "dbs"):
                    yield tmp


class TestProjectManager:
    def test_open_folder(self, isolated_project_dir):
        with tempfile.TemporaryDirectory() as tmp:
            mgr = ProjectManager()
            db = mgr.open_folder(tmp)
            assert db is not None
            assert mgr.current_project is not None
            assert mgr.current_project["root_path"] == str(Path(tmp).resolve())
            mgr.close()

    def test_recent_projects(self, isolated_project_dir):
        with tempfile.TemporaryDirectory() as tmp:
            mgr = ProjectManager()
            mgr.open_folder(tmp)
            recent = mgr.get_recent_projects()
            assert len(recent) >= 1
            assert recent[0]["root_path"] == str(Path(tmp).resolve())
            mgr.close()
