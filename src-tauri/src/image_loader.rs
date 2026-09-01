use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use image::{DynamicImage, GenericImageView, ImageReader};
use exif::{In, Reader as ExifReader, Tag, Value};

#[derive(Debug, Clone)]
pub struct DecodedImage {
    pub bytes: Vec<u8>,
    pub format: &'static str,
    pub width: u32,
    pub height: u32,
}

/// Extract embedded preview JPEG from a RAW file using TIFF offsets.
/// This works for NEF, CR2, ARW, DNG, etc. because they are TIFF containers.
pub fn extract_raw_preview<P: AsRef<Path>>(file_path: P) -> Option<Vec<u8>> {
    let file = File::open(&file_path).ok()?;
    let mut buf_reader = BufReader::new(file);
    
    let exif_reader = ExifReader::new();
    let exif = exif_reader.read_from_container(&mut buf_reader).ok()?;
    
    let offset = exif.get_field(Tag::JPEGInterchangeFormat, In::PRIMARY)
        .or_else(|| exif.get_field(Tag::JPEGInterchangeFormat, In::THUMBNAIL))?;
        
    let length = exif.get_field(Tag::JPEGInterchangeFormatLength, In::PRIMARY)
        .or_else(|| exif.get_field(Tag::JPEGInterchangeFormatLength, In::THUMBNAIL))?;
        
    let offset_val = match offset.value {
        Value::Long(ref v) if !v.is_empty() => v[0] as u64,
        Value::Short(ref v) if !v.is_empty() => v[0] as u64,
        _ => return None,
    };
    
    let length_val = match length.value {
        Value::Long(ref v) if !v.is_empty() => v[0] as usize,
        Value::Short(ref v) if !v.is_empty() => v[0] as usize,
        _ => return None,
    };
    
    // Seek and read preview bytes
    let mut file = File::open(file_path).ok()?;
    file.seek(SeekFrom::Start(offset_val)).ok()?;
    
    let mut buffer = vec![0u8; length_val];
    file.read_exact(&mut buffer).ok()?;
    
    Some(buffer)
}

/// Loads and resizes an image to fit a viewport box (e.g. 1920x1080)
pub fn load_and_scale_image<P: AsRef<Path>>(file_path: P, max_dim: u32) -> Option<DecodedImage> {
    let ext = file_path.as_ref().extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
        
    let is_raw = matches!(ext.as_str(), "nef" | "cr2" | "arw" | "dng" | "cr3" | "orf" | "rw2" | "pef");
    
    let img_bytes = if is_raw {
        extract_raw_preview(&file_path)?
    } else {
        std::fs::read(&file_path).ok()?
    };
    
    let format = "image/jpeg";

    // Fast path: check dimensions without full decode.
    // For JPG/PNG/WebP that are already ≤ max_dim, skip decode entirely.
    if !is_raw {
        if let Ok(reader) = ImageReader::new(std::io::Cursor::new(&img_bytes)).with_guessed_format() {
            if let Ok((w, h)) = reader.into_dimensions() {
                if w <= max_dim && h <= max_dim {
                    return Some(DecodedImage {
                        bytes: img_bytes,
                        format,
                        width: w,
                        height: h,
                    });
                }
            }
        }
    }

    let img = ImageReader::new(std::io::Cursor::new(&img_bytes))
        .with_guessed_format().ok()?
        .decode().ok()?;
        
    let (w, h) = img.dimensions();
    if w > max_dim || h > max_dim {
        let scaled = img.resize(max_dim, max_dim, image::imageops::FilterType::Triangle);
        let mut jpeg_bytes = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut jpeg_bytes);
        scaled.write_to(&mut cursor, image::ImageFormat::Jpeg).ok()?;
        let (sw, sh) = scaled.dimensions();
        Some(DecodedImage {
            bytes: jpeg_bytes,
            format,
            width: sw,
            height: sh,
        })
    } else {
        Some(DecodedImage {
            bytes: img_bytes,
            format,
            width: w,
            height: h,
        })
    }
}

pub fn load_image_unscaled<P: AsRef<Path>>(file_path: P) -> Option<DecodedImage> {
    let ext = file_path.as_ref().extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
        
    let is_raw = matches!(ext.as_str(), "nef" | "cr2" | "arw" | "dng" | "cr3" | "orf" | "rw2" | "pef");
    
    let img_bytes = if is_raw {
        if let Some(preview) = extract_raw_preview(&file_path) {
            preview
        } else {
            // If no RAW preview, try full raw decode via image crate
            let img = ImageReader::open(&file_path).ok()?.decode().ok()?;
            let (w, h) = img.dimensions();
            let mut jpeg_bytes = Vec::new();
            let mut cursor = std::io::Cursor::new(&mut jpeg_bytes);
            img.write_to(&mut cursor, image::ImageFormat::Jpeg).ok()?;
            return Some(DecodedImage { bytes: jpeg_bytes, format: "image/jpeg", width: w, height: h });
        }
    } else {
        std::fs::read(&file_path).ok()?
    };
    
    let format = "image/jpeg";
    let img = ImageReader::new(std::io::Cursor::new(&img_bytes))
        .with_guessed_format().ok()?
        .decode().ok()?;
    
    let (w, h) = img.dimensions();
    Some(DecodedImage { bytes: img_bytes, format, width: w, height: h })
}

/// Helper to detect blur (focus score) based on Laplacian variance
pub fn calculate_focus_score(img: &DynamicImage) -> f64 {
    let gray = img.to_luma8();
    let (w, h) = gray.dimensions();
    if w < 3 || h < 3 {
        return 0.0;
    }
    
    let (cy, cx) = (h / 2, w / 2);
    let (dy, dx) = (h / 4, w / 4);
    let (y1, y2) = (cy - dy, cy + dy);
    let (x1, x2) = (cx - dx, cx + dx);
    
    let grid_h = y2 - y1;
    let grid_w = x2 - x1;
    let step_y = (grid_h / 40).max(1);
    let step_x = (grid_w / 40).max(1);
    
    let mut grid = Vec::new();
    for y in (y1..y2).step_by(step_y as usize) {
        let mut row = Vec::new();
        for x in (x1..x2).step_by(step_x as usize) {
            if x < w && y < h {
                row.push(*gray.get_pixel(x, y));
            }
        }
        grid.push(row);
    }
    
    if grid.len() < 3 || grid[0].len() < 3 {
        return 0.0;
    }
    
    let mut laplacian_values = Vec::new();
    for y in 1..(grid.len() - 1) {
        for x in 1..(grid[0].len() - 1) {
            let center = grid[y][x].0[0] as f64;
            let top = grid[y - 1][x].0[0] as f64;
            let bottom = grid[y + 1][x].0[0] as f64;
            let left = grid[y][x - 1].0[0] as f64;
            let right = grid[y][x + 1].0[0] as f64;
            
            let lap = 4.0 * center - top - bottom - left - right;
            laplacian_values.push(lap);
        }
    }
    
    if laplacian_values.is_empty() {
        return 0.0;
    }
    
    let mean = laplacian_values.iter().sum::<f64>() / laplacian_values.len() as f64;
    let variance = laplacian_values.iter()
        .map(|v| (v - mean).powi(2))
        .sum::<f64>() / laplacian_values.len() as f64;
        
    variance
}

/// Generates a thumbnail JPEG and returns it along with the focus score.
pub fn generate_thumbnail<P: AsRef<Path>>(file_path: P, target_height: u32) -> Option<(Vec<u8>, f64)> {
    let ext = file_path.as_ref().extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
        
    let is_raw = matches!(ext.as_str(), "nef" | "cr2" | "arw" | "dng" | "cr3" | "orf" | "rw2" | "pef");
    
    let img_bytes = if is_raw {
        extract_raw_preview(&file_path)?
    } else {
        std::fs::read(&file_path).ok()?
    };
    
    let img = ImageReader::new(std::io::Cursor::new(&img_bytes))
        .with_guessed_format().ok()?
        .decode().ok()?;
        
    let scaled = img.resize_to_fill(target_height * 3 / 2, target_height, image::imageops::FilterType::Triangle);
    let blur_score = calculate_focus_score(&scaled);
    
    let mut jpeg_bytes = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut jpeg_bytes);
    scaled.write_to(&mut cursor, image::ImageFormat::Jpeg).ok()?;
    
    Some((jpeg_bytes, blur_score))
}

/// Wire format for `get_thumbnail_data` raw IPC responses:
/// [8 bytes LE f64 blur_score][JPEG bytes...]
/// Keeps the payload a single binary buffer instead of JSON number arrays.
pub fn encode_thumb_response(jpeg: Vec<u8>, blur_score: f64) -> Vec<u8> {
    let mut buf = Vec::with_capacity(8 + jpeg.len());
    buf.extend_from_slice(&blur_score.to_le_bytes());
    buf.extend_from_slice(&jpeg);
    buf
}

/// Inverse of [`encode_thumb_response`]. Exposed for tests and any future
/// consumer that reads the raw IPC payload.
pub fn decode_thumb_response(buf: &[u8]) -> Option<(f64, &[u8])> {
    if buf.len() < 8 {
        return None;
    }
    let mut score_bytes = [0u8; 8];
    score_bytes.copy_from_slice(&buf[..8]);
    Some((f64::from_le_bytes(score_bytes), &buf[8..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumb_response_roundtrip() {
        let jpeg = vec![0xFF, 0xD8, 0x00, 0x42, 0xFF, 0xD9];
        let encoded = encode_thumb_response(jpeg.clone(), 123.456);
        assert_eq!(encoded.len(), 8 + jpeg.len());
        let (score, bytes) = decode_thumb_response(&encoded).unwrap();
        assert!((score - 123.456).abs() < f64::EPSILON);
        assert_eq!(bytes, &jpeg[..]);
    }

    #[test]
    fn thumb_response_rejects_truncated() {
        assert!(decode_thumb_response(&[0u8; 7]).is_none());
    }

    #[test]
    fn thumb_response_handles_negative_zero_and_nan_scores() {
        // blur scores are variances (>= 0) but the codec must not panic on odd values
        for score in [0.0, -0.0, f64::MAX] {
            let encoded = encode_thumb_response(vec![1, 2, 3], score);
            let (decoded, _) = decode_thumb_response(&encoded).unwrap();
            assert_eq!(decoded.to_bits(), score.to_bits());
        }
    }
}
