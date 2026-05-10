import pytest
import tempfile
from pathlib import Path

from photosorter.database import PhotoDatabase


@pytest.fixture
def db():
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    database = PhotoDatabase(tmp.name)
    yield database
    database.close()
    Path(tmp.name).unlink(missing_ok=True)


@pytest.fixture
def project(db: PhotoDatabase):
    pid = db.get_or_create_project("/test/photos")
    return pid
