use std::path::PathBuf;

/// The file a session plays, held open from its start to its end. An upgrade imported at the
/// same path replaces the file mid-session, and a run that reopened the path read other tracks
/// and keyframes than the session's analysis describes: picking the French track played the
/// English one. On Linux every run opens the held file through `/proc`; elsewhere runs still
/// reopen the path.
pub(super) struct Source {
    file: std::fs::File,
    path: PathBuf,
}

impl Source {
    pub async fn open(path: PathBuf) -> std::io::Result<Self> {
        let file = tokio::fs::File::open(&path).await?.into_std().await;
        Ok(Self { file, path })
    }

    /// The name ffmpeg and the direct-play server open.
    #[cfg(target_os = "linux")]
    pub fn input(&self) -> PathBuf {
        use std::os::fd::AsRawFd;
        PathBuf::from(format!(
            "/proc/{}/fd/{}",
            std::process::id(),
            self.file.as_raw_fd()
        ))
    }

    #[cfg(not(target_os = "linux"))]
    pub fn input(&self) -> PathBuf {
        self.path.clone()
    }

    /// Taken from the file's own name: the `/proc` one has no extension.
    pub fn content_type(&self) -> Option<&'static str> {
        mime_guess::from_path(&self.path).first_raw()
    }

    /// Whether the path still names the held file, which an import can replace while the
    /// analysis reads it.
    #[cfg(unix)]
    pub async fn still_at_path(&self) -> bool {
        use std::os::unix::fs::MetadataExt;
        let (Ok(held), Ok(now)) = (self.file.metadata(), tokio::fs::metadata(&self.path).await)
        else {
            return false;
        };
        (held.dev(), held.ino()) == (now.dev(), now.ino())
    }

    #[cfg(not(unix))]
    pub async fn still_at_path(&self) -> bool {
        true
    }
}
