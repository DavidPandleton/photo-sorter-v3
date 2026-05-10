from pathlib import Path
from photosorter.database import PhotoDatabase


class TestPhotoDatabase:
    def test_create_project(self, db: PhotoDatabase):
        pid = db.get_or_create_project("/test/photos")
        assert pid > 0
        project = db.get_project(pid)
        assert project is not None
        assert project["root_path"] == str(Path("/test/photos").resolve())

    def test_sync_images(self, db: PhotoDatabase, project: int):
        paths = ["/test/photos/img01.jpg", "/test/photos/img02.jpg"]
        db.sync_images(project, paths)
        assert db.get_total_count(project) == 2

    def test_sync_images_removes_deleted(self, db: PhotoDatabase, project: int):
        db.sync_images(project, ["/test/photos/a.jpg", "/test/photos/b.jpg"])
        db.sync_images(project, ["/test/photos/a.jpg"])
        assert db.get_total_count(project) == 1

    def test_set_rating(self, db: PhotoDatabase, project: int):
        db.sync_images(project, ["/test/photos/img.jpg"])
        img = db.get_image_by_path(project, "/test/photos/img.jpg")
        db.set_rating(img["id"], "GOOD")
        assert db.get_image(img["id"])["rating"] == "GOOD"

    def test_unrate(self, db: PhotoDatabase, project: int):
        db.sync_images(project, ["/test/photos/img.jpg"])
        img = db.get_image_by_path(project, "/test/photos/img.jpg")
        db.set_rating(img["id"], "BAD")
        db.set_rating(img["id"], None)
        assert db.get_image(img["id"])["rating"] is None

    def test_rating_counts(self, db: PhotoDatabase, project: int):
        paths = [f"/test/photos/img{n}.jpg" for n in range(5)]
        db.sync_images(project, paths)
        for i, p in enumerate(paths):
            img = db.get_image_by_path(project, p)
            rating = ["BAD", "OK", "GOOD", "BAD", "GOOD"][i]
            db.set_rating(img["id"], rating)
        counts = db.get_rating_counts(project)
        assert counts == {"BAD": 2, "OK": 1, "GOOD": 2}

    def test_unrated_images(self, db: PhotoDatabase, project: int):
        db.sync_images(project, ["/test/photos/a.jpg", "/test/photos/b.jpg"])
        img_a = db.get_image_by_path(project, "/test/photos/a.jpg")
        db.set_rating(img_a["id"], "OK")
        unrated = db.get_unrated_images(project)
        assert len(unrated) == 1
        assert unrated[0]["filename"] == "b.jpg"

    def test_pick_flag(self, db: PhotoDatabase, project: int):
        db.sync_images(project, ["/test/photos/img.jpg"])
        img = db.get_image_by_path(project, "/test/photos/img.jpg")
        db.set_pick(img["id"], True)
        assert db.get_image(img["id"])["pick"] == 1
        db.set_pick(img["id"], False)
        assert db.get_image(img["id"])["pick"] == 0

    def test_tags(self, db: PhotoDatabase, project: int):
        db.sync_images(project, ["/test/photos/img.jpg"])
        img = db.get_image_by_path(project, "/test/photos/img.jpg")
        db.add_tag(img["id"], "landscape")
        db.add_tag(img["id"], "sunset")
        tags = db.get_tags(img["id"])
        assert "landscape" in tags
        assert "sunset" in tags
        db.remove_tag(img["id"], "landscape")
        assert "landscape" not in db.get_tags(img["id"])

    def test_collections(self, db: PhotoDatabase, project: int):
        cid = db.create_collection(project, "Favorites")
        assert cid > 0
        collections = db.get_collections(project)
        assert any(c["name"] == "Favorites" for c in collections)

    def test_export_paths(self, db: PhotoDatabase, project: int):
        db.sync_images(project, ["/test/photos/a.jpg", "/test/photos/b.jpg"])
        img_a = db.get_image_by_path(project, "/test/photos/a.jpg")
        img_b = db.get_image_by_path(project, "/test/photos/b.jpg")
        db.set_rating(img_a["id"], "GOOD")
        db.set_rating(img_b["id"], "BAD")
        exports = db.get_export_paths(project)
        assert len(exports["GOOD"]) == 1
        assert len(exports["BAD"]) == 1
        assert len(exports["OK"]) == 0

    def test_clear_ratings(self, db: PhotoDatabase, project: int):
        db.sync_images(project, ["/test/photos/img.jpg"])
        img = db.get_image_by_path(project, "/test/photos/img.jpg")
        db.set_rating(img["id"], "GOOD")
        db.clear_ratings(project)
        assert db.get_image(img["id"])["rating"] is None
        assert db.get_total_count(project) == 1

    def test_update_exif(self, db: PhotoDatabase, project: int):
        db.sync_images(project, ["/test/photos/img.jpg"])
        img = db.get_image_by_path(project, "/test/photos/img.jpg")
        db.update_exif(img["id"], {"iso": 800, "aperture": "f/2.8", "camera_model": "Nikon Z6"})
        updated = db.get_image(img["id"])
        assert updated["iso"] == 800
        assert updated["aperture"] == "f/2.8"
        assert updated["camera_model"] == "Nikon Z6"

    def test_concurrent_connections(self, db: PhotoDatabase, project: int):
        db.sync_images(project, ["/test/photos/a.jpg", "/test/photos/b.jpg"])
        # Simulate access from a "different" thread
        db2 = PhotoDatabase(db.db_path)
        assert db2.get_total_count(project) == 2
        db2.close()

    def test_toggle_pick(self, db: PhotoDatabase, project: int):
        db.sync_images(project, ["/test/photos/img.jpg"])
        img = db.get_image_by_path(project, "/test/photos/img.jpg")
        assert img["pick"] == 0
        db.toggle_pick(img["id"])
        assert db.get_image(img["id"])["pick"] == 1
        db.toggle_pick(img["id"])
        assert db.get_image(img["id"])["pick"] == 0

    def test_star_rating(self, db: PhotoDatabase, project: int):
        db.sync_images(project, ["/test/photos/img.jpg"])
        img = db.get_image_by_path(project, "/test/photos/img.jpg")
        db.set_star_rating(img["id"], 3)
        assert db.get_image(img["id"])["star_rating"] == 3
        db.set_star_rating(img["id"], 5)
        assert db.get_image(img["id"])["star_rating"] == 5
        db.set_star_rating(img["id"], 0)
        assert db.get_image(img["id"])["star_rating"] == 0

    def test_picked_images(self, db: PhotoDatabase, project: int):
        db.sync_images(project, ["/test/photos/a.jpg", "/test/photos/b.jpg"])
        img_a = db.get_image_by_path(project, "/test/photos/a.jpg")
        db.toggle_pick(img_a["id"])
        picked = db.get_picked_images(project)
        assert len(picked) == 1
        assert picked[0]["filename"] == "a.jpg"

    def test_search_images(self, db: PhotoDatabase, project: int):
        db.sync_images(project, ["/test/photos/vacation.jpg", "/test/photos/wedding.jpg"])
        img = db.get_image_by_path(project, "/test/photos/wedding.jpg")
        db.update_exif(img["id"], {"lens": "Canon 50mm"})
        results = db.search_images(project, "wedding")
        assert len(results) == 1
        results = db.search_images(project, "50mm")
        assert len(results) == 1
