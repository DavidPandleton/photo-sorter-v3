use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use image::ImageReader;

#[derive(Debug, Clone)]
pub struct DecodedImage {
    pub bytes: Vec<u8>,
    pub format: &'static str,
    pub width: u32,
    pub height: u32,
}

fn read_image_bytes<P: AsRef<Path>>(path: &P) -> Option<Vec<u8>> {
    let ext = path.as_ref().extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if matches!(ext.as_str(), "nef" | "cr2" | "arw" | "dng" | "cr3" | "orf" | "rw2" | "pef") {
        extract_raw_preview(path)
    } else {
        std::fs::read(path).ok()
    }
}

pub fn extract_raw_preview<P: AsRef<Path>>(file_path: P) -> Option<Vec<u8>> {
    let file = File::open(&file_path).ok()?;
    let mut buf_reader = BufReader::new(file);
    let exif_reader = exif::Reader::new();
    let exif = exif_reader.read_from_container(&mut buf_reader).ok()?;
    let offset = exif.get_field(exif::Tag::JPEGInterchangeFormat, exif::In::PRIMARY)
        .or_else(|| exif.get_field(exif::Tag::JPEGInterchangeFormat, exif::In::THUMBNAIL))?;
    let length = exif.get_field(exif::Tag::JPEGInterchangeFormatLength, exif::In::PRIMARY)
        .or_else(|| exif.get_field(exif::Tag::JPEGInterchangeFormatLength, exif::In::THUMBNAIL))?;
    let offset_val = match offset.value {
        exif::Value::Long(ref v) if !v.is_empty() => v[0] as u64,
        exif::Value::Short(ref v) if !v.is_empty() => v[0] as u64,
        _ => return None,
    };
    let length_val = match length.value {
        exif::Value::Long(ref v) if !v.is_empty() => v[0] as usize,
        exif::Value::Short(ref v) if !v.is_empty() => v[0] as usize,
        _ => return None,
    };
    let mut file = File::open(file_path).ok()?;
    file.seek(SeekFrom::Start(offset_val)).ok()?;
    let mut buffer = vec![0u8; length_val];
    file.read_exact(&mut buffer).ok()?;
    Some(buffer)
}

// ponytail: skip decode+reencode — return original JPEG bytes, let canvas handle resize
pub fn load_and_scale_image<P: AsRef<Path>>(file_path: P, _max_dim: u32) -> Option<DecodedImage> {
    let ext = file_path.as_ref().extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let ext_str = ext.as_str();
    let is_raw = matches!(ext_str, "nef" | "cr2" | "arw" | "dng" | "cr3" | "orf" | "rw2" | "pef");
    let img_bytes = read_image_bytes(&file_path)?;
    if is_raw {
        // ponytail: embedded JPEG preview from RAW — dimensions unknown, pass through
        return Some(DecodedImage { bytes: img_bytes, format: "image/jpeg", width: 0, height: 0 });
    }
    // ponytail: JPEG passthrough — dimensions computed once per image at load time
    if let Ok(reader) = ImageReader::new(std::io::Cursor::new(&img_bytes)).with_guessed_format() {
        if let Ok((w, h)) = reader.into_dimensions() {
            return Some(DecodedImage { bytes: img_bytes, format: "image/jpeg", width: w, height: h });
        }
    }
    Some(DecodedImage { bytes: img_bytes, format: "image/jpeg", width: 0, height: 0 })
}

// ponytail: same — no decode needed, just pass bytes for full-res view
pub fn load_image_unscaled<P: AsRef<Path>>(file_path: P) -> Option<DecodedImage> {
    let img_bytes = read_image_bytes(&file_path)?;
    Some(DecodedImage { bytes: img_bytes, format: "image/jpeg", width: 0, height: 0 })
}

pub fn generate_thumbnail<P: AsRef<Path>>(file_path: P, target_height: u32) -> Option<Vec<u8>> {
    let img_bytes = read_image_bytes(&file_path)?;
    let img = ImageReader::new(std::io::Cursor::new(&img_bytes))
        .with_guessed_format().ok()?
        .decode().ok()?;
    let scaled = img.resize_to_fill(target_height * 3 / 2, target_height, image::imageops::FilterType::Triangle);
    let mut jpeg_bytes = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut jpeg_bytes);
    scaled.write_to(&mut cursor, image::ImageFormat::Jpeg).ok()?;
    Some(jpeg_bytes)
}
