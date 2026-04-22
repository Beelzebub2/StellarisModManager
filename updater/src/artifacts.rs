use std::path::{Path, PathBuf};

pub enum CleanupOutcome {
    Success,
    Failure { keep_installer: bool },
}

pub struct UpdateArtifacts {
    download_dir: PathBuf,
    installer_path: PathBuf,
    partial_path: PathBuf,
    installer_log_path: PathBuf,
}

impl UpdateArtifacts {
    pub fn for_version(version: &str) -> Self {
        Self::for_version_in(
            &std::env::temp_dir().join("StellarisModManager-Updates"),
            version,
        )
    }

    pub fn for_version_in(base_dir: &Path, version: &str) -> Self {
        let file_name = format!("StellarisModManager-Setup-{version}.exe");
        Self {
            download_dir: base_dir.to_path_buf(),
            installer_path: base_dir.join(&file_name),
            partial_path: base_dir.join(format!("{file_name}.part")),
            installer_log_path: base_dir.join("installer-run.log"),
        }
    }

    pub fn download_dir(&self) -> &Path {
        &self.download_dir
    }

    pub fn installer_path(&self) -> &Path {
        &self.installer_path
    }

    pub fn cleanup(&self, outcome: CleanupOutcome) {
        let _ = std::fs::remove_file(&self.partial_path);
        let _ = std::fs::remove_file(&self.installer_log_path);

        match outcome {
            CleanupOutcome::Success => {
                let _ = std::fs::remove_file(&self.installer_path);
            }
            CleanupOutcome::Failure { keep_installer } => {
                if !keep_installer {
                    let _ = std::fs::remove_file(&self.installer_path);
                }
            }
        }

        self.prune_download_dir_if_empty();
    }

    fn prune_download_dir_if_empty(&self) {
        let entries = match std::fs::read_dir(&self.download_dir) {
            Ok(entries) => entries,
            Err(_) => return,
        };

        if entries.into_iter().next().is_none() {
            let _ = std::fs::remove_dir(&self.download_dir);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("smm-updater-artifacts-{name}-{unique}"))
    }

    fn write_file(path: &Path, contents: &[u8]) {
        fs::create_dir_all(path.parent().expect("file parent")).expect("create parent dir");
        fs::write(path, contents).expect("write file");
    }

    #[test]
    fn success_cleanup_removes_installer_log_and_empty_directory() {
        let root = unique_dir("success");
        let artifacts = UpdateArtifacts::for_version_in(&root, "1.2.3");
        write_file(artifacts.installer_path(), b"installer");
        write_file(&artifacts.partial_path, b"partial");
        write_file(&artifacts.installer_log_path, b"log");

        artifacts.cleanup(CleanupOutcome::Success);

        assert!(!artifacts.installer_path().exists());
        assert!(!artifacts.partial_path.exists());
        assert!(!artifacts.installer_log_path.exists());
        assert!(!artifacts.download_dir().exists());
    }

    #[test]
    fn failure_cleanup_keeps_installer_but_removes_partial_and_log() {
        let root = unique_dir("failure");
        let artifacts = UpdateArtifacts::for_version_in(&root, "1.2.3");
        write_file(artifacts.installer_path(), b"installer");
        write_file(&artifacts.partial_path, b"partial");
        write_file(&artifacts.installer_log_path, b"log");

        artifacts.cleanup(CleanupOutcome::Failure {
            keep_installer: true,
        });

        assert!(artifacts.installer_path().exists());
        assert!(!artifacts.partial_path.exists());
        assert!(!artifacts.installer_log_path.exists());
    }
}
