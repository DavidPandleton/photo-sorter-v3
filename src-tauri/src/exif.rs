use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use exif::{In, Reader, Tag, Value};

#[derive(Debug, Default)]
pub struct ExifMetadata {
    pub iso: Option<i32>,
    pub aperture: Option<String>,
    pub shutter_speed: Option<String>,
    pub focal_length: Option<String>,
    pub lens: Option<String>,
    pub camera_model: Option<String>,
    pub date_taken: Option<String>,
    pub orientation: Option<i32>,
}

pub fn extract_exif<P: AsRef<Path>>(file_path: P) -> Option<ExifMetadata> {
    let file = File::open(file_path).ok()?;
    let mut buf_reader = BufReader::new(file);
    let exif_reader = Reader::new();
    
    let exif = exif_reader.read_from_container(&mut buf_reader).ok()?;
    let mut meta = ExifMetadata::default();
    
    // Model
    if let Some(field) = exif.get_field(Tag::Model, In::PRIMARY) {
        meta.camera_model = Some(field.value.display_as(Tag::Model).to_string().replace("\"", ""));
    }
    
    // ISO
    if let Some(field) = exif.get_field(Tag::PhotographicSensitivity, In::PRIMARY) {
        if let Value::Short(ref v) = field.value {
            if !v.is_empty() {
                meta.iso = Some(v[0] as i32);
            }
        }
    }
    
    // Aperture (F-Number)
    if let Some(field) = exif.get_field(Tag::FNumber, In::PRIMARY) {
        if let Value::Rational(ref v) = field.value {
            if !v.is_empty() {
                let f_val = v[0].to_f64();
                meta.aperture = Some(format!("{:.1}", f_val));
            }
        }
    }
    
    // Shutter Speed (Exposure Time)
    if let Some(field) = exif.get_field(Tag::ExposureTime, In::PRIMARY) {
        if let Value::Rational(ref v) = field.value {
            if !v.is_empty() {
                let exp = v[0];
                if exp.num == 0 {
                    meta.shutter_speed = None;
                } else if exp.num >= exp.denom {
                    meta.shutter_speed = Some(format!("{}", exp.num / exp.denom));
                } else {
                    meta.shutter_speed = Some(format!("{}/{}", exp.num, exp.denom));
                }
            }
        }
    }
    
    // Focal Length
    if let Some(field) = exif.get_field(Tag::FocalLength, In::PRIMARY) {
        if let Value::Rational(ref v) = field.value {
            if !v.is_empty() {
                meta.focal_length = Some(format!("{:.0}", v[0].to_f64()));
            }
        }
    }
    
    // Lens Model
    if let Some(field) = exif.get_field(Tag::LensModel, In::PRIMARY) {
        meta.lens = Some(field.value.display_as(Tag::LensModel).to_string().replace("\"", ""));
    }
    
    // Date Taken (DateTimeOriginal)
    if let Some(field) = exif.get_field(Tag::DateTimeOriginal, In::PRIMARY) {
        let raw_date = field.value.display_as(Tag::DateTimeOriginal).to_string().replace("\"", "");
        // Convert "YYYY:MM:DD HH:MM:SS" to "YYYY-MM-DDTHH:MM:SS"
        if raw_date.len() >= 19 {
            let parts: Vec<&str> = raw_date.split_whitespace().collect();
            if parts.len() >= 2 {
                let date_str = parts[0].replace(":", "-");
                let time_str = parts[1];
                meta.date_taken = Some(format!("{}T{}", date_str, time_str));
            } else {
                meta.date_taken = Some(raw_date);
            }
        } else {
            meta.date_taken = Some(raw_date);
        }
    }
    
    // Orientation
    if let Some(field) = exif.get_field(Tag::Orientation, In::PRIMARY) {
        let val = match field.value {
            Value::Short(ref v) if !v.is_empty() => Some(v[0] as i32),
            Value::Long(ref v) if !v.is_empty() => Some(v[0] as i32),
            Value::Byte(ref v) if !v.is_empty() => Some(v[0] as i32),
            _ => None,
        };
        if let Some(o) = val {
            meta.orientation = Some(match o {
                3 | 4 => 180,
                6 | 7 => 90,
                8 | 5 => 270,
                _ => 0,
            });
        }
    }
    
    Some(meta)
}
