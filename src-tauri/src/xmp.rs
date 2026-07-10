use std::path::Path;
use std::fs;

/// Generate XMP sidecar content for a given rating/category.
///
/// Maps Photo Sorter categories to standard XMP ratings:
/// - BAD    → Rating 1, Label "Rejected"
/// - OK     → Rating 3, Label "Selected"
/// - GOOD   → Rating 5, Label "Approved"
/// - Custom → Rating determined by category sort_order
///
/// The generated XMP is compatible with Adobe Lightroom, Bridge,
/// Darktable, RawTherapee, and Capture One.
pub fn generate_xmp_sidecar(
    image_path: &str,
    category: &str,
    star_rating: i32,
    is_picked: bool,
) -> String {
    // Map category → XMP rating
    let xmp_rating = match category.to_lowercase().as_str() {
        "bad" | "reject" => 1,
        "ok" | "maybe" => 3,
        "good" | "keep" | "approved" => 5,
        _ => 3, // default to neutral
    };

    // Use actual star rating if set (overrides category mapping)
    let final_rating = if star_rating > 0 { star_rating.clamp(1, 5) } else { xmp_rating };

    // Determine label for Lightroom/Bridge
    let label = match category.to_lowercase().as_str() {
        "bad" => "Rejected",
        "ok" => "Selected",
        "good" => "Approved",
        _ => category,
    };

    // Build filename for the sidecar (same basename, .xmp extension)
    let path = Path::new(image_path);
    let basename = path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");
    let parent = path.parent()
        .and_then(|p| p.to_str())
        .unwrap_or(".");
    let sidecar_path = format!("{}/{}.xmp", parent, basename);

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Photo Sorter v3">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
   xmlns:dc="http://purl.org/dc/elements/1.1/"
   xmlns:xmp="http://ns.adobe.com/xap/1.0/"
   xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
   xmlns:stDim="http://ns.adobe.com/xap/1.0/sType/Dimensions#">
   <dc:subject>
    <rdf:Seq>
     <rdf:li>{category}</rdf:li>
    </rdf:Seq>
   </dc:subject>
   <xmp:Rating>{rating}</xmp:Rating>
   <xmp:Label>{label}</xmp:Label>
   <photoshop:Urgency>{urgency}</photoshop:Urgency>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
"#,
        category = category,
        rating = final_rating,
        label = label,
        urgency = match final_rating {
            1 => "1",
            2 => "3",
            3 => "5",
            4 => "7",
            5 => "9",
            _ => "5",
        },
    )
}

/// Write XMP sidecar file alongside the source image (not the moved export).
/// Returns the path of the written sidecar on success.
pub fn write_sidecar(image_path: &str, xmp_content: &str) -> Result<String, String> {
    let path = Path::new(image_path);
    let basename = path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");
    let parent = path.parent()
        .and_then(|p| p.to_str())
        .unwrap_or(".");
    let sidecar_path = format!("{}/{}.xmp", parent, basename);

    fs::write(&sidecar_path, xmp_content)
        .map_err(|e| format!("Failed to write XMP sidecar: {}", e))?;

    Ok(sidecar_path)
}

/// Write XMP sidecar at a specific path (used during export).
pub fn write_sidecar_at(target_path: &str, xmp_content: &str) -> Result<(), String> {
    // Replace image extension with .xmp
    let path = Path::new(target_path);
    let sidecar_path = path.with_extension("xmp");

    fs::write(&sidecar_path, xmp_content)
        .map_err(|e| format!("Failed to write XMP sidecar: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_generate_bad_xmp() {
        let xmp = generate_xmp_sidecar("/test/photo.nef", "BAD", 0, false);
        assert!(xmp.contains("<xmp:Rating>1</xmp:Rating>"));
        assert!(xmp.contains("<rdf:li>BAD</rdf:li>"));
        assert!(xmp.contains("<xmp:Label>Rejected</xmp:Label>"));
    }

    #[test]
    fn test_generate_good_xmp() {
        let xmp = generate_xmp_sidecar("/test/photo.nef", "GOOD", 0, false);
        assert!(xmp.contains("<xmp:Rating>5</xmp:Rating>"));
        assert!(xmp.contains("<xmp:Label>Approved</xmp:Label>"));
    }

    #[test]
    fn test_generate_ok_xmp() {
        let xmp = generate_xmp_sidecar("/test/photo.arw", "OK", 0, false);
        assert!(xmp.contains("<xmp:Rating>3</xmp:Rating>"));
    }

    #[test]
    fn test_star_rating_override() {
        // Star rating should override category-based rating
        let xmp = generate_xmp_sidecar("/test/photo.dng", "BAD", 4, false);
        assert!(xmp.contains("<xmp:Rating>4</xmp:Rating>"));
    }

    #[test]
    fn test_write_and_read_sidecar() {
        let dir = std::env::temp_dir().join("xmp_test");
        fs::create_dir_all(&dir).unwrap();
        let fake_image = dir.join("test_photo.nef");
        fs::write(&fake_image, "fake raw data").unwrap();

        let xmp = generate_xmp_sidecar(fake_image.to_str().unwrap(), "GOOD", 0, true);
        let result = write_sidecar(fake_image.to_str().unwrap(), &xmp);
        assert!(result.is_ok());

        let sidecar_path = dir.join("test_photo.xmp");
        assert!(sidecar_path.exists());

        let content = fs::read_to_string(&sidecar_path).unwrap();
        assert!(content.contains("<xmp:Rating>5</xmp:Rating>"));

        // Cleanup
        fs::remove_file(&fake_image).unwrap();
        fs::remove_file(&sidecar_path).unwrap();
        fs::remove_dir(&dir).unwrap();
    }

    #[test]
    fn test_write_sidecar_at() {
        let dir = std::env::temp_dir().join("xmp_test_at");
        fs::create_dir_all(&dir).unwrap();
        let exported_path = dir.join("GOOD/event/photo.jpg");
        fs::create_dir_all(exported_path.parent().unwrap()).unwrap();
        fs::write(&exported_path, "fake jpeg").unwrap();

        let xmp = generate_xmp_sidecar(exported_path.to_str().unwrap(), "GOOD", 0, false);
        let result = write_sidecar_at(exported_path.to_str().unwrap(), &xmp);
        assert!(result.is_ok());

        let sidecar = dir.join("GOOD/event/photo.xmp");
        assert!(sidecar.exists());

        // Cleanup
        fs::remove_dir_all(&dir).unwrap();
    }
}
