from photosorter.exif import format_exif_for_display


class TestFormatExif:
    def test_full_exif(self):
        exif = {
            "iso": 800,
            "aperture": 2.8,
            "shutter_speed": 0.004,
            "focal_length": 85.0,
            "lens": "AF-S Nikkor 85mm f/1.8",
            "camera_model": "Nikon Z6",
        }
        result = format_exif_for_display(exif)
        assert "Nikon Z6" in result
        assert "ISO 800" in result
        assert "f/2.8" in result
        assert "mm" in result

    def test_empty_exif(self):
        assert format_exif_for_display({}) == ""

    def test_partial_exif(self):
        exif = {"iso": 1600, "aperture": 5.6}
        result = format_exif_for_display(exif)
        assert "ISO 1600" in result
        assert "f/5.6" in result
        assert "mm" not in result

    def test_exif_with_rawpy_names(self):
        exif = {
            "ISOSpeedRatings": 400,
            "ApertureValue": 4.0,
            "FocalLength": 50.0,
            "Model": "Canon EOS R5",
        }
        result = format_exif_for_display(exif)
        assert "Canon EOS R5" in result
        assert "ISO 400" in result
        assert "f/4.0" in result
        assert "50mm" in result

    def test_shutter_speed_fast(self):
        exif = {"shutter_speed": 0.001}
        result = format_exif_for_display(exif)
        assert "1000" in result

    def test_shutter_speed_slow(self):
        exif = {"shutter_speed": 2.0}
        result = format_exif_for_display(exif)
        assert "2" in result
        assert "s" in result

    def test_shutter_speed_tuple(self):
        exif = {"ShutterSpeedValue": (1, 250)}
        result = format_exif_for_display(exif)
        assert "250" in result

    def test_focal_length_tuple(self):
        exif = {"FocalLength": (35, 1)}
        result = format_exif_for_display(exif)
        assert "35mm" in result
