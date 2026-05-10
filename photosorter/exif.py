from pathlib import Path

from .utils import RAW_EXTENSIONS, RAW_SUPPORTED


def extract_exif(path: str) -> dict:
    result = {}
    ext = Path(path).suffix.lower()

    if RAW_SUPPORTED and ext in RAW_EXTENSIONS:
        try:
            import rawpy
            with rawpy.imread(path) as raw:
                result = _extract_rawpy_metadata(raw)
        except Exception:
            pass
        if result:
            return result

    try:
        from PIL import Image
        from PIL.ExifTags import TAGS
        with Image.open(path) as img:
            exif_data = img._getexif()
            if exif_data:
                for tag_id, value in exif_data.items():
                    tag_name = TAGS.get(tag_id, tag_id)
                    result[tag_name] = value
    except Exception:
        pass

    return result


def _set_if_not_none(d: dict, key: str, value) -> None:
    if value is not None:
        d[key] = value

def _extract_rawpy_metadata(raw) -> dict:
    result = {}
    try:
        _set_if_not_none(result, "ISOSpeedRatings", getattr(raw, "iso", None))
    except Exception:
        pass
    try:
        meta = raw.metadata
        if meta is not None:
            _set_if_not_none(result, "ISOSpeedRatings", meta.get("iso_speed") if hasattr(meta, "get") else None)
            _set_if_not_none(result, "ISOSpeedRatings", meta.get("ison") if hasattr(meta, "get") else None)
            _set_if_not_none(result, "ApertureValue", meta.get("aperture") if hasattr(meta, "get") else None)
            _set_if_not_none(result, "ShutterSpeedValue", meta.get("shutter") if hasattr(meta, "get") else None)
            _set_if_not_none(result, "FocalLength", meta.get("focal_length") if hasattr(meta, "get") else None)
            _set_if_not_none(result, "Model", meta.get("camera_model") if hasattr(meta, "get") else None)
            _set_if_not_none(result, "LensModel", meta.get("lens") if hasattr(meta, "get") else None)
            _set_if_not_none(result, "DateTimeOriginal", meta.get("timestamp") if hasattr(meta, "get") else None)
    except Exception:
        pass
    return result


def format_exif_for_display(exif: dict) -> str:
    lines = []
    iso = exif.get("iso") or exif.get("ISOSpeedRatings")
    if iso is not None:
        lines.append(f"ISO {iso}")

    aperture = exif.get("aperture") or exif.get("ApertureValue")
    if aperture is not None:
        try:
            lines.append(f"f/{float(aperture):.1f}")
        except (ValueError, TypeError):
            lines.append(str(aperture))

    shutter = exif.get("shutter_speed") or exif.get("ShutterSpeedValue")
    if shutter is not None:
        try:
            if isinstance(shutter, tuple):
                num, den = shutter
                shutter = float(num) / float(den) if den else 0
            else:
                shutter = float(shutter)
            if shutter >= 1:
                lines.append(f"{shutter:.0f}s" if shutter == int(shutter) else f"{shutter:.1f}s")
            else:
                lines.append(f"1/{int(1/shutter)}s")
        except (ValueError, TypeError, ZeroDivisionError):
            lines.append(str(shutter))

    focal = exif.get("focal_length") or exif.get("FocalLength")
    if focal is not None:
        try:
            if isinstance(focal, tuple):
                num, den = focal
                focal = float(num) / float(den) if den else 0
            else:
                focal = float(focal)
            lines.append(f"{focal:.0f}mm")
        except (ValueError, TypeError, ZeroDivisionError):
            lines.append(str(focal))

    lens = exif.get("lens") or exif.get("LensModel")
    if lens is not None:
        lines.append(str(lens)[:50])

    camera = exif.get("camera_model") or exif.get("Model")
    if camera is not None:
        lines.insert(0, str(camera))

    return "  |  ".join(lines) if lines else ""
