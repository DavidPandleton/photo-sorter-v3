/*
 * PHOTO SORTER V3 — Global Backend Constants & Configurations
 */

pub const CATEGORY_BAD: &str = "BAD";
pub const CATEGORY_OK: &str = "OK";
pub const CATEGORY_GOOD: &str = "GOOD";
pub const CATEGORIES: [&str; 3] = [CATEGORY_BAD, CATEGORY_OK, CATEGORY_GOOD];

pub const SUPPORTED_EXTENSIONS: [&str; 12] = [
    "jpg", "jpeg", "png", "webp",
    "nef", "cr2", "arw", "dng", "cr3", "orf", "rw2", "pef"
];

// Preview decode resolution — lower = faster decode on low-end hardware
pub const PREVIEW_MAX_DIM: u32 = 1920;

// Thumbnail target height for filmstrip
pub const THUMBNAIL_HEIGHT: u32 = 120;


