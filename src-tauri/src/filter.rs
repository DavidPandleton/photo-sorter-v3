use std::path::Path;
use crate::state::AppState;

impl AppState {
    pub fn apply_filters(&self) {
        let Some((db, pid)) = self.db_and_pid() else { return };
        let (filter_text_val, filter_folder_val, filter_date_val, filter_mode_val) = self.filter_values();
        let filter_folder_val = filter_folder_val.replace('\\', "/");

        let all_images = if !filter_date_val.is_empty() {
            db.get_images_by_date(pid, &filter_date_val).unwrap_or_default()
        } else {
            db.get_images(pid).unwrap_or_default()
        };

        // "unrated" mode consults the DB directly; there is no in-memory
        // results map anymore (KB bug #5: three sources of truth).
        let rated = if filter_mode_val == "unrated" {
            self.rated_paths()
        } else {
            Default::default()
        };

        let mut filtered_paths = Vec::new();
        for img in all_images {
            let path_lower = img.path.to_lowercase();
            if !filter_text_val.is_empty() && !path_lower.contains(&filter_text_val.to_lowercase()) { continue; }
            if !filter_folder_val.is_empty() && !path_lower.starts_with(&filter_folder_val.to_lowercase()) { continue; }
            if filter_mode_val == "unrated" && rated.contains(&img.path) { continue; }
            filtered_paths.push(img.path);
        }
        filtered_paths.sort_by(|a, b| {
            let fa = Path::new(a).file_name().unwrap_or_default();
            let fb = Path::new(b).file_name().unwrap_or_default();
            fa.cmp(fb)
        });

        self.set_filtered_paths(filtered_paths);
    }
}

#[cfg(test)]
mod tests {
    use crate::state::test_util::{cleanup, project_with_files};

    #[test]
    fn unrated_mode_excludes_db_ratings_across_sessions() {
        // KB bug #5 regression: 'unrated' used to consult an in-memory map
        // that was empty in a fresh session, showing rated images again.
        let (state, root) = project_with_files(&[("a.jpg", b"A"), ("b.jpg", b"B")]);
        let a = root.join("a.jpg").to_string_lossy().into_owned();
        state.rate_image(&a, Some("good")).unwrap();
        let (ta, fa, da, _) = state.filter_values();
        state.set_filter_values(&ta, &fa, &da, "unrated");
        state.apply_filters();
        let paths = state.image_paths();
        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("b.jpg"));

        // toggle back to all -> both visible again
        let (t2, f2, d2, _) = state.filter_values();
        state.set_filter_values(&t2, &f2, &d2, "all");
        state.apply_filters();
        assert_eq!(state.image_paths().len(), 2);
        cleanup(&root);
    }

    #[test]
    fn text_and_folder_filters_are_case_insensitive() {
        let (state, root) = project_with_files(&[
            ("Vac/IMG_1.jpg", b"1"),
            ("vac/img_2.JPG", b"2"),
            ("other/img_3.jpg", b"3"),
        ]);
        // folder filter is an absolute path prefix (what the tree UI sends)
        let vac = root.join("Vac").to_string_lossy().into_owned();
        state.set_filter_values("", &vac, "", "all");
        state.apply_filters();
        let paths = state.image_paths();
        assert_eq!(paths.len(), 2, "both case variants of vac/ match");
        assert!(paths.iter().all(|p| !p.contains("other")));

        state.set_filter_values("IMG_2", "", "", "all");
        state.apply_filters();
        let paths = state.image_paths();
        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("img_2.JPG"));
        cleanup(&root);
    }

    #[test]
    fn filter_clamps_cursor_when_results_shrink() {
        let (state, root) = project_with_files(&[("a.jpg", b"A"), ("b.jpg", b"B"), ("c.jpg", b"C")]);
        state.apply_filters(); // populate image_paths from the DB
        state.set_current_index(2).unwrap(); // last image
        let a = root.join("a.jpg").to_string_lossy().into_owned();
        state.rate_image(&a, Some("good")).unwrap();
        state.set_filter_values("", "", "", "unrated");
        state.apply_filters();
        assert_eq!(state.image_paths().len(), 2);
        assert!(state.current_index() < 2, "cursor must clamp into range");
        cleanup(&root);
    }
}
