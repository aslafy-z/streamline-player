pub mod callback;
pub mod download;
pub mod intro;
pub mod subtitles;
pub mod trickplay;

use std::collections::{HashMap, VecDeque};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use opentelemetry::KeyValue;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::process::Command;
use tokio::sync::Notify;
use tokio::task::{AbortHandle, JoinHandle};
use tracing::Instrument;

use crate::analysis::{Analysis, analyze_shared};
use crate::config::Config;
use crate::error::ApiError;
use crate::hw::Hw;

const DONE_FILE: &str = "done.json";
/// The source file of output kept past the TTL, as the job read it.
const SOURCE_FILE: &str = "source.json";
/// Written by the sweep that first finds the source missing: its mtime dates the absence.
const SOURCE_GONE_FILE: &str = "source-gone";
/// Holds one request file per background job not yet finished, so the backlog outlives a restart.
const BACKLOG_DIR: &str = "backlog";
/// Holds the analysis of each file a job or a session read, so the file is read once.
pub const ANALYSIS_DIR: &str = "analysis";
const QUEUE_FULL_RETRY_SECS: u64 = 30;
const TTL_SWEEP_INTERVAL: Duration = Duration::from_secs(3600);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Interactive,
    Background,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum JobSpec {
    Analyze { path: String },
    Subtitles { path: String },
    Intro { paths: Vec<String> },
    Trickplay { path: String },
    Download(Box<download::DownloadSpec>),
}

impl JobSpec {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Analyze { .. } => "analyze",
            Self::Subtitles { .. } => "subtitles",
            Self::Intro { .. } => "intro",
            Self::Trickplay { .. } => "trickplay",
            Self::Download(_) => "download",
        }
    }

    /// The file whose trickplay sheets or subtitles the player keeps fetching. Their output lives
    /// as long as the file does, not for `job_output_ttl`.
    fn kept_source(&self) -> Option<&str> {
        match self {
            Self::Subtitles { path } | Self::Trickplay { path } => Some(path),
            Self::Analyze { .. } | Self::Intro { .. } | Self::Download(_) => None,
        }
    }

    pub fn knows(kind: &str) -> bool {
        matches!(
            kind,
            "analyze" | "subtitles" | "intro" | "trickplay" | "download"
        )
    }
}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
struct Source {
    /// As the job named it: the sweep rewrites it through the `path_map` of the day.
    path: String,
    size: u64,
    mtime_ns: Option<u64>,
}

impl Source {
    fn stat(cfg: &Config, path: &str) -> std::io::Result<Source> {
        let meta = std::fs::metadata(cfg.path_map.rewrite(path))?;
        let mtime_ns = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .and_then(|d| u64::try_from(d.as_nanos()).ok());
        Ok(Source {
            path: path.to_owned(),
            size: meta.len(),
            mtime_ns,
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct JobRequest {
    pub job_id: String,
    pub priority: Priority,
    /// Where the finished job's result is posted, signed with the secret.
    #[serde(default)]
    pub callback: Option<String>,
    #[serde(flatten)]
    pub spec: JobSpec,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobState {
    Queued,
    Running,
    Done,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct JobStatus {
    pub state: JobState,
    pub progress: Option<f64>,
    pub result: Option<Value>,
    pub error: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum JobError {
    #[error("{0}")]
    Analysis(#[from] crate::analysis::AnalysisError),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("ffmpeg failed on stream {index}: {stderr}")]
    Ffmpeg { index: u32, stderr: String },
    #[error("the file has no video stream")]
    NoVideo,
    #[error("{0}")]
    Invalid(String),
    #[error("ffmpeg failed: {0}")]
    Download(String),
    #[error("cannot encode result: {0}")]
    Json(#[from] serde_json::Error),
}

/// Runs the command at nice 10, so background jobs yield the CPU to live playback. The child sets
/// its own priority between fork and exec: a `nice` program would have to be on PATH, and the
/// engine's image ships none.
pub fn lower_priority(cmd: &mut Command) {
    #[cfg(unix)]
    // SAFETY: setpriority is async-signal-safe, and the closure allocates nothing.
    unsafe {
        cmd.pre_exec(|| {
            if libc::setpriority(libc::PRIO_PROCESS as _, 0, 10) == 0 {
                return Ok(());
            }
            let err = std::io::Error::last_os_error();
            // EACCES: the engine already runs below that priority, and an unprivileged process
            // may not raise it back. The job is low enough as it is.
            if err.raw_os_error() == Some(libc::EACCES) {
                return Ok(());
            }
            Err(err)
        });
    }
    #[cfg(windows)]
    {
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        cmd.creation_flags(BELOW_NORMAL_PRIORITY_CLASS);
    }
}

struct Entry {
    priority: Priority,
    spec: JobSpec,
    callback: Option<String>,
    state: JobState,
    result: Option<Value>,
    error: Option<String>,
    progress: Option<f64>,
    abort: Option<AbortHandle>,
}

#[derive(Default)]
struct Queue {
    jobs: HashMap<String, Entry>,
    interactive: VecDeque<String>,
    background: VecDeque<String>,
}

struct Shared {
    cfg: Arc<Config>,
    hw: Arc<Hw>,
    secret: Arc<Vec<u8>>,
    queue: Mutex<Queue>,
    wake: Notify,
    /// Wakes the callback delivery when a job with one finishes.
    finished: Notify,
    /// Wakes the continuation calls when a caller asks for them.
    continuing: Notify,
    /// Set once the backlog a restart left is queued again: until then the queue is short of
    /// jobs the engine still owes.
    restored: AtomicBool,
}

#[derive(Clone)]
pub struct Jobs(Arc<Shared>);

fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn check_id(id: &str) -> Result<(), ApiError> {
    if valid_id(id) {
        Ok(())
    } else {
        Err(ApiError::invalid_request(
            "id must be 32 lowercase hex characters",
        ))
    }
}

fn not_found() -> ApiError {
    ApiError::not_found("no such job")
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, Queue> {
        self.queue.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn dir(&self, id: &str) -> PathBuf {
        self.cfg.jobs_dir.join(id)
    }

    fn backlog_file(&self, id: &str) -> PathBuf {
        self.cfg
            .jobs_dir
            .join(BACKLOG_DIR)
            .join(format!("{id}.json"))
    }

    fn forget(&self, id: &str) {
        let _ = std::fs::remove_file(self.backlog_file(id));
    }

    fn take(&self, interactive_only: bool) -> Option<(String, JobSpec)> {
        let mut q = self.lock();
        loop {
            let id = match q.interactive.pop_front() {
                Some(id) => id,
                None if interactive_only => return None,
                // Playing a file needs its analysis and nothing else, so a library scan's
                // analyses all run before its subtitles, intros and trickplay.
                None => {
                    let first = q
                        .background
                        .iter()
                        .position(|id| {
                            matches!(q.jobs.get(id), Some(e) if matches!(e.spec, JobSpec::Analyze { .. }))
                        })
                        .unwrap_or(0);
                    q.background.remove(first)?
                }
            };
            let dir = self.dir(&id);
            let _ = std::fs::remove_dir_all(&dir);
            let entry = q.jobs.get_mut(&id)?;
            if std::fs::create_dir_all(&dir).is_ok() {
                entry.state = JobState::Running;
                return Some((id, entry.spec.clone()));
            }
            entry.state = JobState::Failed;
            entry.error = Some("cannot create the job directory".into());
            self.forget(&id);
        }
    }

    async fn run(self: &Arc<Self>, id: String, spec: JobSpec) {
        let shared = self.clone();
        let progress_id = id.clone();
        let progress = move |p: f32| {
            if let Some(e) = shared.lock().jobs.get_mut(&progress_id) {
                e.progress = Some(f64::from(p));
            }
        };
        let cfg = self.cfg.clone();
        let hw = self.hw.clone();
        let dir = self.dir(&id);
        let kind = spec.kind();
        // Taken before the job reads the file, so a change made while it runs counts as one.
        let source = spec
            .kept_source()
            .and_then(|p| Source::stat(&self.cfg, p).ok());
        let span = tracing::info_span!("engine.job", job = %id, r#type = kind);
        let started = std::time::Instant::now();
        let task: JoinHandle<Result<Value, JobError>> = tokio::spawn(
            async move { execute(&cfg, &hw, &spec, &dir, &progress).await }.instrument(span),
        );
        {
            let mut q = self.lock();
            match q.jobs.get_mut(&id) {
                Some(e) => e.abort = Some(task.abort_handle()),
                None => {
                    task.abort();
                    return;
                }
            }
        }
        let outcome = match task.await {
            Ok(r) => r.map_err(|e| e.to_string()),
            Err(e) if e.is_cancelled() => return,
            Err(_) => Err("job panicked".to_owned()),
        };
        let m = crate::telemetry::metrics();
        let outcome_label = if outcome.is_ok() { "done" } else { "failed" };
        m.jobs.add(
            1,
            &[
                KeyValue::new("type", kind),
                KeyValue::new("outcome", outcome_label),
            ],
        );
        m.job_duration.record(
            started.elapsed().as_secs_f64(),
            &[KeyValue::new("type", kind)],
        );
        let mut q = self.lock();
        let Some(entry) = q.jobs.get_mut(&id) else {
            return;
        };
        entry.abort = None;
        match outcome {
            Ok(v) => {
                entry.state = JobState::Done;
                entry.result = Some(v);
            }
            Err(msg) => {
                entry.state = JobState::Failed;
                entry.error = Some(msg);
            }
        }
        if entry.state == JobState::Done
            && let Some(source) = &source
        {
            // Before done.json: a job dir with done.json and no source.json is swept on the TTL.
            let kept = serde_json::to_vec(source)
                .map_err(std::io::Error::other)
                .and_then(|b| std::fs::write(self.dir(&id).join(SOURCE_FILE), b));
            if let Err(e) = kept {
                tracing::warn!(job = %id, error = %e, "cannot record the source; the output expires like any other");
            }
        }
        let record = json!({
            "state": if entry.state == JobState::Done { "done" } else { "failed" },
            "result": entry.result,
            "error": entry.error,
        });
        let _ = std::fs::write(self.dir(&id).join(DONE_FILE), record.to_string());
        if let Some(url) = &entry.callback {
            self.keep_callback(&id, url);
            self.finished.notify_one();
        }
        self.forget(&id);
    }

    fn read_record(&self, id: &str) -> Option<JobStatus> {
        let text = std::fs::read_to_string(self.dir(id).join(DONE_FILE)).ok()?;
        let v: Value = serde_json::from_str(&text).ok()?;
        let state = match v["state"].as_str()? {
            "done" => JobState::Done,
            "failed" => JobState::Failed,
            _ => return None,
        };
        Some(JobStatus {
            state,
            progress: (state == JobState::Done).then_some(1.0),
            result: Some(v["result"].clone()).filter(|r| !r.is_null()),
            error: v["error"].as_str().map(ToOwned::to_owned),
        })
    }

    /// Removes output past `job_output_ttl` unread and kept output whose source no longer holds.
    fn sweep_ttl(&self) -> u64 {
        let mut freed = 0;
        if self.cfg.job_output_ttl.is_zero() {
            return freed;
        }
        let Ok(entries) = std::fs::read_dir(&self.cfg.jobs_dir) else {
            return freed;
        };
        let now = SystemTime::now();
        for entry in entries.flatten() {
            let dir = entry.path();
            let Ok(done) = std::fs::metadata(dir.join(DONE_FILE)).and_then(|m| m.modified()) else {
                continue;
            };
            let expired = match self.source_holds(&dir, now) {
                Some(holds) => !holds,
                None => now.duration_since(done).unwrap_or_default() > self.cfg.job_output_ttl,
            };
            if expired {
                let Some(id) = entry.file_name().to_str().map(ToOwned::to_owned) else {
                    continue;
                };
                let mut q = self.lock();
                if q.jobs
                    .get(&id)
                    .is_none_or(|e| matches!(e.state, JobState::Done | JobState::Failed))
                {
                    q.jobs.remove(&id);
                    freed += crate::disk::remove_counted(&dir);
                }
            }
        }
        freed
    }

    /// `None` for output the TTL governs. Kept output goes at once when its source changed, and
    /// only `job_output_ttl` after it went missing: a library unmounted for an afternoon must not
    /// cost every sheet.
    fn source_holds(&self, dir: &Path, now: SystemTime) -> Option<bool> {
        let recorded: Source =
            serde_json::from_slice(&std::fs::read(dir.join(SOURCE_FILE)).ok()?).ok()?;
        let gone = dir.join(SOURCE_GONE_FILE);
        Some(match Source::stat(&self.cfg, &recorded.path) {
            Ok(current) => {
                let _ = std::fs::remove_file(&gone);
                current == recorded
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                match std::fs::metadata(&gone).and_then(|m| m.modified()) {
                    Ok(since) => {
                        now.duration_since(since).unwrap_or_default() <= self.cfg.job_output_ttl
                    }
                    Err(_) => {
                        let _ = std::fs::write(&gone, "");
                        true
                    }
                }
            }
            Err(_) => true,
        })
    }
}

async fn analyze(cfg: &Config, path: &str) -> Result<Analysis, JobError> {
    let input = cfg.path_map.rewrite(path);
    Ok(analyze_shared(
        &cfg.ffprobe(),
        &input,
        Some(&cfg.jobs_dir.join(ANALYSIS_DIR)),
        &lower_priority,
    )
    .await?)
}

async fn execute(
    cfg: &Config,
    hw: &Hw,
    spec: &JobSpec,
    dir: &Path,
    progress: &(dyn Fn(f32) + Send + Sync),
) -> Result<Value, JobError> {
    match spec {
        JobSpec::Download(d) => {
            let analysis = analyze(cfg, &d.path).await?;
            download::run(
                &cfg.ffmpeg(),
                hw,
                &cfg.path_map.rewrite(&d.path),
                &analysis,
                d,
                dir,
                progress,
            )
            .await
        }
        JobSpec::Analyze { path } => Ok(serde_json::to_value(analyze(cfg, path).await?)?),
        JobSpec::Subtitles { path } => {
            let analysis = analyze(cfg, path).await?;
            subtitles::run(&cfg.ffmpeg(), &cfg.path_map.rewrite(path), &analysis, dir).await
        }
        JobSpec::Trickplay { path } => {
            let analysis = analyze(cfg, path).await?;
            trickplay::run(
                &cfg.ffmpeg(),
                hw,
                &cfg.path_map.rewrite(path),
                &analysis,
                dir,
            )
            .await
        }
        JobSpec::Intro { paths } => {
            let mut analyses = Vec::with_capacity(paths.len());
            for path in paths {
                analyses.push(match analyze(cfg, path).await {
                    Ok(a) => Some(a),
                    Err(e) => {
                        tracing::warn!(path, error = %e, "cannot analyze for markers");
                        None
                    }
                });
            }
            Ok(serde_json::to_value(
                intro::run(cfg, paths, &analyses, progress).await,
            )?)
        }
    }
}

async fn worker(shared: Arc<Shared>, interactive_only: bool) {
    loop {
        // Enabled before the queue is read: a job queued in between must still wake this worker.
        let woken = shared.wake.notified();
        tokio::pin!(woken);
        woken.as_mut().enable();
        match shared.take(interactive_only) {
            Some((id, spec)) => shared.run(id, spec).await,
            None => woken.await,
        }
    }
}

fn name_ok(name: &str) -> bool {
    !name.contains('\\')
        && name.split('/').all(|seg| !seg.is_empty())
        && Path::new(name)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

impl Jobs {
    pub fn new(cfg: Arc<Config>, hw: Arc<Hw>, secret: Arc<Vec<u8>>) -> Jobs {
        let shared = Arc::new(Shared {
            cfg,
            hw,
            secret,
            queue: Mutex::new(Queue::default()),
            wake: Notify::new(),
            finished: Notify::new(),
            continuing: Notify::new(),
            restored: AtomicBool::new(false),
        });
        for _ in 0..shared.cfg.max_jobs.max(1) {
            tokio::spawn(worker(shared.clone(), false));
        }
        // Someone is waiting on an interactive job: it must not sit behind a background job that
        // runs for minutes, so one worker takes nothing else.
        tokio::spawn(worker(shared.clone(), true));
        Jobs(shared)
    }

    /// Queues one request as `POST /v1/jobs` received it. A background job is also written to
    /// the backlog, which `sweep_boot` queues again after a restart.
    pub fn submit(&self, v: Value) -> Result<(), ApiError> {
        if let Some(t) = v.get("type").and_then(|t| t.as_str())
            && !JobSpec::knows(t)
        {
            return Err(ApiError::invalid_request(
                "job type not supported in this version",
            ));
        }
        let r: JobRequest = serde_json::from_value(v.clone())
            .map_err(|e| ApiError::invalid_request(e.to_string()))?;
        self.enqueue(r, Some(&v))
    }

    fn enqueue(&self, r: JobRequest, keep: Option<&Value>) -> Result<(), ApiError> {
        check_id(&r.job_id)?;
        if let Some(url) = &r.callback {
            callback::check(url)?;
        }
        let mut q = self.0.lock();
        // Someone is now waiting on a job a scan queued in the background: it moves to the
        // interactive queue, where the worker kept for those takes it at once.
        if r.priority == Priority::Interactive
            && let Some(entry) = q.jobs.get_mut(&r.job_id)
            && entry.state == JobState::Queued
            && entry.priority == Priority::Background
        {
            entry.priority = Priority::Interactive;
            q.background.retain(|id| *id != r.job_id);
            q.interactive.push_back(r.job_id);
            drop(q);
            self.0.wake.notify_waiters();
            return Err(ApiError::job_exists());
        }
        if q.jobs.contains_key(&r.job_id) || self.0.dir(&r.job_id).join(DONE_FILE).exists() {
            let unfinished = q
                .jobs
                .get(&r.job_id)
                .is_some_and(|e| matches!(e.state, JobState::Queued | JobState::Running));
            // Asked for again once finished: the caller does not have the result, so it is
            // posted once more.
            if let (false, Some(url)) = (unfinished, &r.callback) {
                self.0.keep_callback(&r.job_id, url);
                self.0.finished.notify_one();
            }
            return Err(ApiError::job_exists());
        }
        if r.priority == Priority::Interactive && q.interactive.len() >= self.0.cfg.max_queued {
            return Err(ApiError::queue_full(QUEUE_FULL_RETRY_SECS));
        }
        if let (Priority::Background, Some(v)) = (r.priority, keep) {
            let file = self.0.backlog_file(&r.job_id);
            let kept = file
                .parent()
                .map_or(Ok(()), std::fs::create_dir_all)
                .and_then(|()| std::fs::write(&file, v.to_string()));
            if let Err(e) = kept {
                tracing::warn!(job = %r.job_id, error = %e, "cannot keep the job in the backlog; a restart loses it");
            }
        }
        match r.priority {
            Priority::Interactive => q.interactive.push_back(r.job_id.clone()),
            Priority::Background => q.background.push_back(r.job_id.clone()),
        }
        q.jobs.insert(
            r.job_id,
            Entry {
                priority: r.priority,
                spec: r.spec,
                callback: r.callback,
                state: JobState::Queued,
                result: None,
                error: None,
                progress: None,
                abort: None,
            },
        );
        drop(q);
        self.0.wake.notify_waiters();
        Ok(())
    }

    pub fn status(&self, id: &str) -> Result<JobStatus, ApiError> {
        check_id(id)?;
        if let Some(e) = self.0.lock().jobs.get(id) {
            return Ok(JobStatus {
                state: e.state,
                progress: if e.state == JobState::Done {
                    Some(1.0)
                } else {
                    e.progress
                },
                result: e.result.clone(),
                error: e.error.clone(),
            });
        }
        if let Some(record) = self.0.read_record(id) {
            return Ok(record);
        }
        // Until `restore_backlog` has queued it again after a restart, a job owed in the backlog is
        // only a file. Answering not_found would tell the caller it is lost, and it would drop it.
        if self.0.backlog_file(id).exists() {
            return Ok(JobStatus {
                state: JobState::Queued,
                progress: None,
                result: None,
                error: None,
            });
        }
        Err(not_found())
    }

    pub fn file(&self, id: &str, name: &str) -> Result<PathBuf, ApiError> {
        if self.status(id)?.state != JobState::Done
            || !name_ok(name)
            || matches!(name, DONE_FILE | SOURCE_FILE | SOURCE_GONE_FILE)
        {
            return Err(ApiError::not_found("no such file"));
        }
        let dir = self.0.dir(id);
        let path = dir.join(name);
        // Resolved first: a link in a job directory, file or folder, must not serve what lies outside it.
        let inside = match (path.canonicalize(), dir.canonicalize()) {
            (Ok(real), Ok(dir)) => real.starts_with(dir) && real.is_file(),
            _ => false,
        };
        if inside {
            Ok(path)
        } else {
            Err(ApiError::not_found("no such file"))
        }
    }

    /// Reading an output counts as using it: the age sweep goes by this file's mtime.
    pub fn touch(&self, id: &str) {
        if check_id(id).is_err() {
            return;
        }
        let _ = std::fs::File::options()
            .write(true)
            .open(self.0.dir(id).join(DONE_FILE))
            .and_then(|f| f.set_modified(SystemTime::now()));
    }

    pub fn download_path(&self, id: &str) -> Result<PathBuf, ApiError> {
        if self.status(id)?.state != JobState::Done {
            return Err(not_found());
        }
        let dir = self.0.dir(id);
        for name in ["download.mkv", "download.mp4", "output.mp4"] {
            let file = dir.join(name);
            if file.is_file() {
                return Ok(file);
            }
        }
        std::fs::read_to_string(dir.join("original"))
            .map(|p| self.0.cfg.path_map.rewrite(p.trim()))
            .map_err(|_| not_found())
    }

    pub fn cancel(&self, id: &str) -> Result<(), ApiError> {
        check_id(id)?;
        let mut q = self.0.lock();
        let dir = self.0.dir(id);
        match q.jobs.remove(id) {
            Some(entry) => {
                if let Some(h) = entry.abort {
                    h.abort();
                }
                q.interactive.retain(|j| j != id);
                q.background.retain(|j| j != id);
            }
            None if dir.join(DONE_FILE).exists() => {}
            None => return Err(not_found()),
        }
        self.0.forget(id);
        let _ = std::fs::remove_dir_all(dir);
        Ok(())
    }

    /// Running jobs first, then the queue in the order workers will take it.
    pub fn list(&self) -> Vec<(String, JobState, Priority)> {
        let q = self.0.lock();
        let mut running: Vec<_> = q
            .jobs
            .iter()
            .filter(|(_, e)| e.state == JobState::Running)
            .map(|(id, e)| (id.clone(), e.state, e.priority))
            .collect();
        running.sort_by(|a, b| a.0.cmp(&b.0));
        let queued = q.interactive.iter().chain(&q.background).filter_map(|id| {
            let e = q.jobs.get(id)?;
            Some((id.clone(), e.state, e.priority))
        });
        running.into_iter().chain(queued).collect()
    }

    /// Drops what unfinished jobs left behind, then queues the background backlog again in the
    /// order it was submitted: a job that was running when the engine stopped starts over. The
    /// backlog is read off the caller's path, since a library scan leaves tens of thousands of
    /// files and the engine must answer before they are all read.
    pub fn sweep_boot(&self) -> JoinHandle<()> {
        // Only the names are read before the engine listens: looking inside every folder of a
        // volume that was just attached took minutes, longer than the startup probe allows.
        let leftovers: Vec<String> = std::fs::read_dir(&self.0.cfg.jobs_dir)
            .map(|entries| {
                entries
                    .flatten()
                    .filter_map(|e| e.file_name().into_string().ok())
                    .filter(|name| valid_id(name))
                    .collect()
            })
            .unwrap_or_default();
        let jobs = self.clone();
        tokio::task::spawn_blocking(move || {
            for id in leftovers {
                let path = jobs.0.cfg.jobs_dir.join(&id);
                // Under the lock: a job submitted since boot under the same id owns the folder.
                let q = jobs.0.lock();
                if !q.jobs.contains_key(&id) && path.is_dir() && !path.join(DONE_FILE).exists() {
                    let _ = std::fs::remove_dir_all(path);
                }
            }
            jobs.restore_backlog();
            jobs.0.restored.store(true, Ordering::Release);
        })
    }

    /// How many accepted jobs the engine has not finished or whose result it has not delivered
    /// yet. `None` while a restart's backlog is still being read, when the number would be
    /// short. A caller whose own count is higher at zero holds jobs the engine no longer has.
    pub fn owed(&self) -> Option<usize> {
        if !self.0.restored.load(Ordering::Acquire) {
            return None;
        }
        // Under the lock: a job that finishes writes its callback before letting go of it, so
        // it is never out of both counts.
        let q = self.0.lock();
        let undelivered =
            std::fs::read_dir(self.0.cfg.jobs_dir.join(callback::DIR)).map_or(0, Iterator::count);
        let unfinished = q
            .jobs
            .values()
            .filter(|e| matches!(e.state, JobState::Queued | JobState::Running))
            .count();
        Some(unfinished + undelivered)
    }

    /// How far each running job says it is, from 0 to 1, for a caller that counts jobs to count
    /// the part of one too. A job that reports nothing is left out.
    pub fn running(&self) -> HashMap<String, f64> {
        self.0
            .lock()
            .jobs
            .iter()
            .filter(|(_, e)| e.state == JobState::Running)
            .filter_map(|(id, e)| Some((id.clone(), e.progress?)))
            .collect()
    }

    fn restore_backlog(&self) {
        let Ok(entries) = std::fs::read_dir(self.0.cfg.jobs_dir.join(BACKLOG_DIR)) else {
            return;
        };
        let mut kept: Vec<(SystemTime, PathBuf)> = entries
            .flatten()
            .map(|e| {
                let at = e
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                (at, e.path())
            })
            .collect();
        kept.sort();
        let count = kept.len();
        for (_, path) in kept {
            let request = std::fs::read(&path)
                .ok()
                .and_then(|b| serde_json::from_slice::<JobRequest>(&b).ok());
            let restored = request.is_some_and(|r| {
                // Submitted again while the backlog was being read: its file is the live one.
                self.0.lock().jobs.contains_key(&r.job_id) || self.enqueue(r, None).is_ok()
            });
            if !restored {
                let _ = std::fs::remove_file(path);
            }
        }
        if count > 0 {
            tracing::info!(jobs = count, "backlog read");
        }
    }

    /// Returns the bytes freed.
    pub fn sweep_ttl_once(&self) -> u64 {
        self.0.sweep_ttl()
    }

    /// Stops running jobs, killing their ffmpeg children, and drops the queue.
    pub fn shutdown(&self) {
        let mut q = self.0.lock();
        q.interactive.clear();
        q.background.clear();
        for entry in q.jobs.values_mut() {
            if let Some(h) = entry.abort.take() {
                h.abort();
            }
        }
    }

    /// Delivers the results whose job named a callback, those a restart left undelivered first,
    /// and calls the callers that asked to be called until their work is done.
    pub fn spawn_callbacks(&self) -> JoinHandle<()> {
        let shared = self.0.clone();
        let continuing = self.0.clone();
        tokio::spawn(async move { continuing.continue_forever().await });
        tokio::spawn(async move { shared.deliver_forever().await })
    }

    /// Calls `url` until it answers something other than 202, across restarts. Asking again
    /// under the same id replaces the URL.
    pub fn keep_calling(&self, id: &str, url: &str) -> Result<(), ApiError> {
        callback::check_continuation_id(id)?;
        callback::check(url)?;
        self.0
            .keep_continuation(id, url)
            .map_err(|e| ApiError::internal(format!("cannot keep the continuation: {e}")))
    }

    pub fn spawn_ttl_sweeper(&self) -> JoinHandle<()> {
        let shared = self.0.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(TTL_SWEEP_INTERVAL);
            loop {
                tick.tick().await;
                shared.sweep_ttl();
            }
        })
    }
}

#[cfg(test)]
mod kind_tests {
    use super::*;

    #[test]
    fn job_kinds_come_from_the_enum() {
        assert!(JobSpec::knows("analyze"));
        assert!(JobSpec::knows("subtitles"));
        assert!(JobSpec::knows("intro"));
        assert!(JobSpec::knows("trickplay"));
        assert!(JobSpec::knows("download"));
        assert!(!JobSpec::knows("nonsense"));
        let spec = JobSpec::Analyze {
            path: String::new(),
        };
        assert_eq!(spec.kind(), "analyze");
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    const SECRET: &[u8] = b"test-secret-0123456789";

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn lower_priority_runs_with_no_program_on_path() {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", "read -r stat < /proc/self/stat; echo \"$stat\""])
            .env_clear();
        lower_priority(&mut cmd);
        let out = cmd.output().await.unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let stat = String::from_utf8(out.stdout).unwrap();
        // Field 19 of /proc/<pid>/stat, counted after the parenthesised command name (field 2).
        let nice: i32 = stat
            .rsplit_once(')')
            .unwrap()
            .1
            .split_whitespace()
            .nth(16)
            .unwrap()
            .parse()
            .unwrap();
        assert!(nice >= 10, "nice {nice} in {stat}");
    }

    struct Fixture {
        root: PathBuf,
        cfg: Config,
    }

    impl Fixture {
        fn new(tweak: impl FnOnce(&mut Config)) -> Fixture {
            let root = std::env::temp_dir().join(format!(
                "engine-jobs-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::SeqCst)
            ));
            let bin = root.join("bin");
            std::fs::create_dir_all(&bin).unwrap();
            std::os::unix::fs::symlink(
                concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/tests/fixtures/fake-ffprobe/ffprobe"
                ),
                bin.join("ffprobe"),
            )
            .unwrap();
            let mut cfg = Config {
                jobs_dir: root.join("jobs"),
                ffmpeg_dir: bin,
                ..Config::default()
            };
            tweak(&mut cfg);
            Fixture { root, cfg }
        }

        fn jobs(&self) -> Jobs {
            Jobs::new(
                Arc::new(self.cfg.clone()),
                Arc::new(test_hw()),
                Arc::new(SECRET.to_vec()),
            )
        }

        fn bin(&self) -> &Path {
            &self.cfg.ffmpeg_dir
        }

        fn release(&self) {
            std::fs::write(self.bin().join("release"), "").unwrap();
        }

        fn started(&self) -> Vec<String> {
            std::fs::read_to_string(self.bin().join("order.txt"))
                .unwrap_or_default()
                .lines()
                .map(ToOwned::to_owned)
                .collect()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn test_hw() -> Hw {
        Hw::new(
            crate::hw::Backend::Cpu,
            String::new(),
            crate::decision::EncoderSet::default(),
            false,
        )
    }

    fn id(n: u8) -> String {
        format!("{n:032x}")
    }

    fn analyze_req(n: u8, path: &str, priority: Priority) -> Value {
        json!({ "job_id": id(n), "priority": priority, "type": "analyze", "path": path })
    }

    async fn until(mut cond: impl FnMut() -> bool) {
        for _ in 0..200 {
            if cond() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!("condition not reached in time");
    }

    async fn finished(jobs: &Jobs, n: u8) -> JobStatus {
        until(|| {
            jobs.status(&id(n))
                .is_ok_and(|s| matches!(s.state, JobState::Done | JobState::Failed))
        })
        .await;
        jobs.status(&id(n)).unwrap()
    }

    #[tokio::test]
    async fn interactive_jumps_queue() {
        let f = Fixture::new(|c| c.max_jobs = 1);
        let jobs = f.jobs();
        jobs.submit(analyze_req(1, "/m/blocker", Priority::Background))
            .unwrap();
        until(|| jobs.status(&id(1)).unwrap().state == JobState::Running).await;
        jobs.submit(analyze_req(2, "/m/b", Priority::Background))
            .unwrap();
        jobs.submit(analyze_req(3, "/m/i", Priority::Interactive))
            .unwrap();
        f.release();
        finished(&jobs, 2).await;
        finished(&jobs, 3).await;
        assert_eq!(f.started(), ["/m/blocker", "/m/i", "/m/b"]);
    }

    #[tokio::test]
    async fn background_analyses_run_before_other_jobs() {
        let f = Fixture::new(|c| c.max_jobs = 1);
        let jobs = f.jobs();
        jobs.submit(analyze_req(1, "/m/blocker", Priority::Background))
            .unwrap();
        until(|| jobs.status(&id(1)).unwrap().state == JobState::Running).await;
        jobs.submit(json!({
            "job_id": id(2), "priority": "background", "type": "subtitles", "path": "/m/s",
        }))
        .unwrap();
        jobs.submit(analyze_req(3, "/m/a", Priority::Background))
            .unwrap();
        f.release();
        finished(&jobs, 2).await;
        assert_eq!(f.started()[..3], ["/m/blocker", "/m/a", "/m/s"]);
    }

    #[tokio::test]
    async fn asking_interactively_for_a_queued_background_job_moves_it_up() {
        let f = Fixture::new(|c| c.max_jobs = 1);
        let jobs = f.jobs();
        jobs.submit(analyze_req(1, "/m/blocker", Priority::Background))
            .unwrap();
        until(|| jobs.status(&id(1)).unwrap().state == JobState::Running).await;
        jobs.submit(analyze_req(2, "/m/first", Priority::Background))
            .unwrap();
        jobs.submit(analyze_req(3, "/m/wanted", Priority::Background))
            .unwrap();
        let again = jobs.submit(analyze_req(3, "/m/wanted", Priority::Interactive));
        assert_eq!(again.unwrap_err().code, "job_exists");
        // The worker kept for interactive jobs runs it while the blocker still holds the other.
        assert_eq!(finished(&jobs, 3).await.state, JobState::Done);
        assert_eq!(jobs.status(&id(2)).unwrap().state, JobState::Queued);
        f.release();
        finished(&jobs, 2).await;
    }

    #[tokio::test]
    async fn interactive_does_not_wait_on_a_running_background_job() {
        let f = Fixture::new(|c| c.max_jobs = 1);
        let jobs = f.jobs();
        jobs.submit(analyze_req(1, "/m/blocker", Priority::Background))
            .unwrap();
        until(|| jobs.status(&id(1)).unwrap().state == JobState::Running).await;
        jobs.submit(analyze_req(2, "/m/i", Priority::Interactive))
            .unwrap();
        assert_eq!(finished(&jobs, 2).await.state, JobState::Done);
        assert_eq!(jobs.status(&id(1)).unwrap().state, JobState::Running);
        f.release();
    }

    #[tokio::test]
    async fn queue_full_429_is_for_interactive_only() {
        let f = Fixture::new(|c| {
            c.max_jobs = 1;
            c.max_queued = 2;
        });
        let jobs = f.jobs();
        jobs.submit(analyze_req(1, "/m/blocker", Priority::Background))
            .unwrap();
        until(|| jobs.status(&id(1)).unwrap().state == JobState::Running).await;
        jobs.submit(analyze_req(2, "/m/a", Priority::Interactive))
            .unwrap();
        jobs.submit(analyze_req(3, "/m/b", Priority::Interactive))
            .unwrap();
        let err = jobs
            .submit(analyze_req(4, "/m/c", Priority::Interactive))
            .unwrap_err();
        assert_eq!(err.status, axum::http::StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(err.code, "queue_full");
        assert_eq!(err.retry_after, Some(30));
        for n in 5..10 {
            jobs.submit(analyze_req(n, "/m/d", Priority::Background))
                .unwrap();
        }
        f.release();
    }

    #[tokio::test]
    async fn background_backlog_survives_restart() {
        let f = Fixture::new(|c| c.max_jobs = 1);
        let jobs = f.jobs();
        jobs.submit(analyze_req(1, "/m/blocker", Priority::Background))
            .unwrap();
        until(|| f.started() == ["/m/blocker"]).await;
        jobs.submit(analyze_req(2, "/m/b", Priority::Background))
            .unwrap();
        jobs.submit(analyze_req(3, "/m/cancelled", Priority::Background))
            .unwrap();
        jobs.submit(analyze_req(4, "/m/i", Priority::Interactive))
            .unwrap();
        jobs.cancel(&id(3)).unwrap();
        jobs.shutdown();

        let fresh = f.jobs();
        assert_eq!(fresh.owed(), None);
        assert_eq!(fresh.status(&id(2)).unwrap().state, JobState::Queued);
        assert_eq!(fresh.status(&id(3)).unwrap_err().code, "not_found");
        fresh.sweep_boot().await.unwrap();
        assert_eq!(fresh.owed(), Some(2));
        f.release();
        assert_eq!(finished(&fresh, 1).await.state, JobState::Done);
        assert_eq!(finished(&fresh, 2).await.state, JobState::Done);
        assert_eq!(fresh.owed(), Some(0));
        assert_eq!(fresh.status(&id(3)).unwrap_err().code, "not_found");
        assert_eq!(fresh.status(&id(4)).unwrap_err().code, "not_found");
        until(|| {
            std::fs::read_dir(f.cfg.jobs_dir.join(BACKLOG_DIR))
                .is_ok_and(|mut d| d.next().is_none())
        })
        .await;
    }

    #[tokio::test]
    async fn duplicate_409() {
        let f = Fixture::new(|_| {});
        let jobs = f.jobs();
        jobs.submit(analyze_req(1, "/m/a", Priority::Background))
            .unwrap();
        let err = jobs
            .submit(analyze_req(1, "/m/a", Priority::Background))
            .unwrap_err();
        assert_eq!(err.status, axum::http::StatusCode::CONFLICT);
        assert_eq!(err.code, "job_exists");
    }

    #[tokio::test]
    async fn finished_job_survives_restart() {
        let f = Fixture::new(|_| {});
        let jobs = f.jobs();
        jobs.submit(analyze_req(1, "/m/a", Priority::Background))
            .unwrap();
        let first = finished(&jobs, 1).await;
        assert_eq!(first.state, JobState::Done);
        assert!(first.result.is_some());

        let fresh = f.jobs();
        assert_eq!(fresh.status(&id(1)).unwrap(), first);
        let err = fresh
            .submit(analyze_req(1, "/m/a", Priority::Background))
            .unwrap_err();
        assert_eq!(err.code, "job_exists");
    }

    #[tokio::test]
    async fn failed_job_records_error() {
        let f = Fixture::new(|_| {});
        let jobs = f.jobs();
        jobs.submit(analyze_req(1, "/m/bad", Priority::Background))
            .unwrap();
        let s = finished(&jobs, 1).await;
        assert_eq!(s.state, JobState::Failed);
        assert!(s.error.unwrap().contains("no such file"));
        assert_eq!(f.jobs().status(&id(1)).unwrap().state, JobState::Failed);
    }

    #[tokio::test]
    async fn boot_sweep_drops_unfinished() {
        let f = Fixture::new(|_| {});
        let unfinished = f.cfg.jobs_dir.join(id(1));
        let finished = f.cfg.jobs_dir.join(id(2));
        std::fs::create_dir_all(&unfinished).unwrap();
        std::fs::create_dir_all(&finished).unwrap();
        std::fs::write(finished.join(DONE_FILE), r#"{"state":"done"}"#).unwrap();
        f.jobs().sweep_boot().await.unwrap();
        assert!(!unfinished.exists());
        assert!(finished.exists());
    }

    #[tokio::test]
    async fn boot_sweep_spares_foreign_entries() {
        let f = Fixture::new(|_| {});
        let foreign = f.cfg.jobs_dir.join("photos");
        let upper = f.cfg.jobs_dir.join(id(10).to_uppercase());
        let ours = f.cfg.jobs_dir.join(id(10));
        for dir in [&foreign, &upper, &ours] {
            std::fs::create_dir_all(dir).unwrap();
        }
        f.jobs().sweep_boot().await.unwrap();
        assert!(foreign.exists());
        assert!(upper.exists());
        assert!(!ours.exists());
    }

    #[tokio::test]
    async fn ttl_sweep() {
        let f = Fixture::new(|_| {});
        let old = f.cfg.jobs_dir.join(id(1));
        let fresh = f.cfg.jobs_dir.join(id(2));
        for dir in [&old, &fresh] {
            std::fs::create_dir_all(dir).unwrap();
            std::fs::write(dir.join(DONE_FILE), r#"{"state":"done"}"#).unwrap();
        }
        let eight_days = Duration::from_secs(8 * 24 * 3600);
        filetime::set_file_mtime(
            old.join(DONE_FILE),
            filetime::FileTime::from_system_time(SystemTime::now() - eight_days),
        )
        .unwrap();
        f.jobs().sweep_ttl_once();
        assert!(!old.exists());
        assert!(fresh.exists());
    }

    fn age(path: &Path) {
        let eight_days = Duration::from_secs(8 * 24 * 3600);
        filetime::set_file_mtime(
            path,
            filetime::FileTime::from_system_time(SystemTime::now() - eight_days),
        )
        .unwrap();
    }

    fn aged_done_job(f: &Fixture, n: u8) -> PathBuf {
        let dir = f.cfg.jobs_dir.join(id(n));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(DONE_FILE), r#"{"state":"done"}"#).unwrap();
        age(&dir.join(DONE_FILE));
        dir
    }

    #[tokio::test]
    async fn touch_keeps_output_alive() {
        let f = Fixture::new(|_| {});
        let used = aged_done_job(&f, 1);
        let unused = aged_done_job(&f, 2);
        f.jobs().touch(&id(1));
        f.jobs().sweep_ttl_once();
        assert!(used.exists());
        assert!(!unused.exists());
    }

    #[tokio::test]
    async fn zero_ttl_never_sweeps() {
        let f = Fixture::new(|c| c.job_output_ttl = Duration::ZERO);
        let old = aged_done_job(&f, 1);
        f.jobs().sweep_ttl_once();
        assert!(old.exists());
    }

    /// A finished, long unread subtitles job over a source file of its own. The fake ffprobe
    /// reports no stream, so the job extracts nothing and succeeds.
    async fn kept_job(f: &Fixture, jobs: &Jobs, n: u8) -> (PathBuf, PathBuf) {
        let source = f.root.join(format!("source-{n}.mkv"));
        std::fs::write(&source, "matroska").unwrap();
        jobs.submit(json!({
            "job_id": id(n),
            "priority": "background",
            "type": "subtitles",
            "path": source,
        }))
        .unwrap();
        assert_eq!(finished(jobs, n).await.state, JobState::Done);
        let dir = f.cfg.jobs_dir.join(id(n));
        age(&dir.join(DONE_FILE));
        (dir, source)
    }

    #[test]
    fn only_trickplay_and_subtitles_are_kept() {
        let path = String::from("/m/a.mkv");
        assert!(
            JobSpec::Trickplay { path: path.clone() }
                .kept_source()
                .is_some()
        );
        assert!(
            JobSpec::Subtitles { path: path.clone() }
                .kept_source()
                .is_some()
        );
        assert!(
            JobSpec::Analyze { path: path.clone() }
                .kept_source()
                .is_none()
        );
        assert!(JobSpec::Intro { paths: vec![path] }.kept_source().is_none());
    }

    #[tokio::test]
    async fn kept_output_outlives_the_ttl() {
        let f = Fixture::new(|_| {});
        let jobs = f.jobs();
        let (kept, _) = kept_job(&f, &jobs, 1).await;
        jobs.submit(analyze_req(2, "/m/a", Priority::Background))
            .unwrap();
        finished(&jobs, 2).await;
        let analysis = f.cfg.jobs_dir.join(id(2));
        age(&analysis.join(DONE_FILE));

        assert!(kept.join(SOURCE_FILE).is_file());
        assert!(!analysis.join(SOURCE_FILE).exists());
        jobs.sweep_ttl_once();
        assert!(kept.exists());
        assert!(!analysis.exists());
        assert_eq!(
            jobs.file(&id(1), SOURCE_FILE).unwrap_err().code,
            "not_found"
        );
    }

    #[tokio::test]
    async fn kept_output_goes_with_a_changed_source() {
        let f = Fixture::new(|_| {});
        let jobs = f.jobs();
        let (resized, resized_src) = kept_job(&f, &jobs, 1).await;
        let (retouched, retouched_src) = kept_job(&f, &jobs, 2).await;
        std::fs::write(&resized_src, "a longer matroska").unwrap();
        age(&retouched_src);
        jobs.sweep_ttl_once();
        assert!(!resized.exists());
        assert!(!retouched.exists());
    }

    #[tokio::test]
    async fn kept_output_outlasts_a_missing_source_for_the_ttl() {
        let f = Fixture::new(|_| {});
        let jobs = f.jobs();
        let (lost, lost_src) = kept_job(&f, &jobs, 1).await;
        let (back, back_src) = kept_job(&f, &jobs, 2).await;
        let back_bytes = std::fs::read(&back_src).unwrap();
        let back_mtime = std::fs::metadata(&back_src).unwrap().modified().unwrap();
        std::fs::remove_file(&lost_src).unwrap();
        std::fs::rename(&back_src, f.root.join("unmounted")).unwrap();

        jobs.sweep_ttl_once();
        assert!(lost.join(SOURCE_GONE_FILE).is_file());
        assert!(back.join(SOURCE_GONE_FILE).is_file());

        std::fs::write(&back_src, back_bytes).unwrap();
        filetime::set_file_mtime(&back_src, filetime::FileTime::from_system_time(back_mtime))
            .unwrap();
        age(&lost.join(SOURCE_GONE_FILE));
        jobs.sweep_ttl_once();
        assert!(!lost.exists());
        assert!(back.exists());
        assert!(!back.join(SOURCE_GONE_FILE).exists());
    }

    #[tokio::test]
    async fn cancel_running() {
        let f = Fixture::new(|_| {});
        let jobs = f.jobs();
        jobs.submit(analyze_req(1, "/m/blocker", Priority::Background))
            .unwrap();
        until(|| jobs.status(&id(1)).unwrap().state == JobState::Running).await;
        let dir = f.cfg.jobs_dir.join(id(1));
        assert!(dir.exists());
        jobs.cancel(&id(1)).unwrap();
        assert!(!dir.exists());
        assert_eq!(jobs.status(&id(1)).unwrap_err().code, "not_found");
        assert_eq!(jobs.cancel(&id(1)).unwrap_err().code, "not_found");
        f.release();
    }

    #[tokio::test]
    async fn cancel_queued_never_runs() {
        let f = Fixture::new(|c| c.max_jobs = 1);
        let jobs = f.jobs();
        jobs.submit(analyze_req(1, "/m/blocker", Priority::Background))
            .unwrap();
        until(|| jobs.status(&id(1)).unwrap().state == JobState::Running).await;
        jobs.submit(analyze_req(2, "/m/q", Priority::Background))
            .unwrap();
        jobs.cancel(&id(2)).unwrap();
        f.release();
        finished(&jobs, 1).await;
        assert_eq!(f.started(), ["/m/blocker"]);
    }

    #[tokio::test]
    async fn shutdown_aborts_running_and_drops_queue() {
        let f = Fixture::new(|c| c.max_jobs = 1);
        let jobs = f.jobs();
        jobs.submit(analyze_req(1, "/m/blocker", Priority::Background))
            .unwrap();
        until(|| f.started() == ["/m/blocker"]).await;
        jobs.submit(analyze_req(2, "/m/q", Priority::Background))
            .unwrap();
        jobs.shutdown();
        f.release();
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(jobs.status(&id(1)).unwrap().state, JobState::Running);
        assert_eq!(f.started(), ["/m/blocker"]);
    }

    /// Answers each callback with the next status of `answers`, then 204, and keeps the signature
    /// and body of every one.
    async fn receiver(answers: Vec<u16>) -> (String, Arc<Mutex<Vec<(String, String)>>>) {
        let got = Arc::new(Mutex::new(Vec::new()));
        let seen = got.clone();
        let app = axum::Router::new().route(
            "/cb",
            axum::routing::post(move |headers: axum::http::HeaderMap, body: String| {
                let sig = headers
                    .get(callback::SIGNATURE_HEADER)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or_default()
                    .to_owned();
                let mut seen = seen.lock().unwrap();
                seen.push((sig, body));
                let status = answers.get(seen.len() - 1).copied().unwrap_or(204);
                std::future::ready(axum::http::StatusCode::from_u16(status).unwrap())
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/cb", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (url, got)
    }

    #[tokio::test]
    async fn callback_delivers_the_signed_result_until_it_is_taken() {
        let f = Fixture::new(|_| {});
        let jobs = f.jobs();
        let (url, got) = receiver(vec![503]).await;
        let mut req = analyze_req(1, "/m/a", Priority::Background);
        req["callback"] = json!(url);
        jobs.submit(req).unwrap();
        assert_eq!(finished(&jobs, 1).await.state, JobState::Done);
        let pending = f.cfg.jobs_dir.join("callbacks").join(id(1));
        let client = callback::client(callback::TIMEOUT);

        jobs.0.deliver_pending(&client).await;
        assert!(pending.exists(), "a 503 keeps the result for the next pass");
        jobs.0.deliver_pending(&client).await;
        assert!(!pending.exists());

        let again = jobs.submit({
            let mut req = analyze_req(1, "/m/a", Priority::Background);
            req["callback"] = json!(url);
            req
        });
        assert_eq!(again.unwrap_err().code, "job_exists");
        assert!(
            pending.exists(),
            "asked for again, a finished job posts once more"
        );
        jobs.0.deliver_pending(&client).await;
        assert!(!pending.exists());

        let got = got.lock().unwrap();
        assert_eq!(got.len(), 3);
        let (sig, body) = &got[1];
        assert_eq!(*sig, crate::token::sign_body(SECRET, body.as_bytes()));
        let body: Value = serde_json::from_str(body).unwrap();
        assert_eq!(body["job_id"], id(1));
        assert_eq!(body["state"], "done");
        assert!(body["result"].is_object());
    }

    #[tokio::test]
    async fn continuation_is_called_until_the_caller_is_done() {
        let f = Fixture::new(|_| {});
        let jobs = f.jobs();
        let (url, got) = receiver(vec![202, 503, 204]).await;
        jobs.keep_calling("scan", &url).unwrap();
        let pending = f.cfg.jobs_dir.join("continuations").join("scan");
        let client = callback::client(callback::TIMEOUT);

        assert!(jobs.0.continue_pending(&client).await, "202 asks for more");
        assert!(!jobs.0.continue_pending(&client).await);
        assert!(pending.exists(), "a 503 keeps the continuation");
        assert!(!jobs.0.continue_pending(&client).await);
        assert!(!pending.exists(), "204 ends it");

        let got = got.lock().unwrap();
        assert_eq!(got.len(), 3);
        let (sig, body) = &got[0];
        assert_eq!(*sig, crate::token::sign_body(SECRET, body.as_bytes()));
        assert!(jobs.keep_calling("../x", &url).is_err());
    }

    #[tokio::test]
    async fn callback_must_be_an_http_url() {
        let f = Fixture::new(|_| {});
        let mut req = analyze_req(1, "/m/a", Priority::Background);
        req["callback"] = json!("file:///etc/passwd");
        assert!(f.jobs().submit(req).is_err());
    }

    #[test]
    fn file_names_stay_inside() {
        assert!(name_ok("a.vtt"));
        assert!(name_ok("fonts/A.ttf"));
        for bad in [
            "../done.json",
            "/etc/passwd",
            "fonts\\..\\x",
            "",
            "a//b",
            "./a",
        ] {
            assert!(!name_ok(bad), "{bad:?}");
        }
    }
}

/// Writes an executable script for a test. A child `sh` writes it, never this process: a test
/// thread forking at that moment would inherit the open write handle, and running the script
/// while any process holds one fails with ETXTBSY ("Text file busy").
#[cfg(test)]
pub(crate) fn write_executable(path: &std::path::Path, text: &str) {
    use std::io::Write;
    let mut sh = std::process::Command::new("sh")
        .arg("-c")
        .arg("cat > \"$0\" && chmod 755 \"$0\"")
        .arg(path)
        .stdin(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    sh.stdin.take().unwrap().write_all(text.as_bytes()).unwrap();
    assert!(sh.wait().unwrap().success(), "writing {}", path.display());
}
