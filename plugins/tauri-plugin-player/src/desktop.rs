//! The player on Linux desktop: libmpv behind the commands and events of the Android plugin
//! (PlayerPlugin.kt), so the page drives both alike.

use crate::{
    mpv::{Event, Mpv},
    probe::{self, Rect},
    view,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    hash::{DefaultHasher, Hash, Hasher},
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, Runtime, State, Webview, ipc::Channel};

const POSITION_INTERVAL: Duration = Duration::from_millis(500);
const READS_WINDOW: Duration = Duration::from_secs(2);
const LOAD_TIMEOUT: Duration = Duration::from_secs(60);
/// How long the watcher waits for an mpv event before sampling state anyway, in seconds.
const TICK: f64 = 0.1;

type Done = Result<(), String>;

pub struct Player {
    mpv: Arc<Mpv>,
    listeners: Mutex<HashMap<String, Vec<Channel<Value>>>>,
    loading: Mutex<bool>,
    loaded: Condvar,
    direct: AtomicBool,
    volume: Mutex<(f64, bool)>,
    fonts: PathBuf,
    subtitles: PathBuf,
    downloads: PathBuf,
}

impl Player {
    fn emit(&self, event: &str, payload: Value) {
        if let Some(channels) = self.listeners.lock().unwrap().get(event) {
            for c in channels {
                let _ = c.send(payload.clone());
            }
        }
    }

    fn emit_position(&self) {
        let Some(position) = self.mpv.number("time-pos") else {
            return;
        };
        self.emit(
            "position",
            json!({
                "position": position,
                "buffered": self.mpv.number("demuxer-cache-time").unwrap_or(position),
                "duration": self.mpv.number("duration").unwrap_or(0.0),
            }),
        );
    }

    /// ExoPlayer's states, as the Android plugin names them.
    fn state(&self) -> &'static str {
        let m = &self.mpv;
        if *self.loading.lock().unwrap() {
            "buffering"
        } else if m.flag("idle-active") {
            "idle"
        } else if m.flag("eof-reached") {
            "ended"
        } else if m.flag("paused-for-cache") || m.flag("seeking") {
            "buffering"
        } else if m.flag("pause") {
            "paused"
        } else if m.flag("core-idle") {
            "buffering"
        } else {
            "playing"
        }
    }

    fn finish_load(&self) {
        *self.loading.lock().unwrap() = false;
        self.loaded.notify_all();
    }

    /// Returns once the file is open and at `at`. A failure reaches the page as an `error`
    /// event, like ExoPlayer's.
    fn load(&self, url: &str, at: f64, audio: Option<u32>) -> Done {
        self.direct.store(!url.contains(".m3u8"), Ordering::Relaxed);
        *self.loading.lock().unwrap() = true;
        self.mpv.set("pause", "yes")?;
        // `aid` outlives the file it was set for, so a stream with one track resets it.
        self.mpv
            .set("aid", &audio.map_or("auto".into(), |a| a.to_string()))?;
        if let Err(e) = self.mpv.command(&["loadfile", url, "replace"]) {
            self.finish_load();
            return Err(e);
        }
        let open = self.loading.lock().unwrap();
        let (mut open, _) = self
            .loaded
            .wait_timeout_while(open, LOAD_TIMEOUT, |l| *l)
            .unwrap();
        *open = false;
        drop(open);
        if at > 0.0 {
            let _ = self.mpv.command(&["seek", &at.to_string(), "absolute"]);
        }
        Ok(())
    }
}

/// Bytes read per window, counted only when the demuxer kept reading through all of it: the
/// cache stops reading when full, and an idle stretch would read as a slow link.
struct Reads {
    start: Instant,
    last: Instant,
    bytes: f64,
    whole: bool,
}

impl Reads {
    fn new() -> Self {
        let now = Instant::now();
        Reads {
            start: now,
            last: now,
            bytes: 0.0,
            whole: true,
        }
    }

    // Direct streams report as "reads" and converted ones as "meter", the two sources the page
    // tells apart. A converted stream's encoder may pace the demuxer below the link, so the
    // reading is a floor there, which only makes Auto step up later.
    fn sample(&mut self, p: &Player) {
        let now = Instant::now();
        let dt = now - self.last;
        self.last = now;
        if p.mpv.flag("demuxer-cache-idle") {
            self.whole = false;
        } else {
            self.bytes += p.mpv.number("cache-speed").unwrap_or(0.0) * dt.as_secs_f64();
        }
        if self.start.elapsed() < READS_WINDOW {
            return;
        }
        if self.whole && self.bytes > 0.0 {
            let source = if p.direct.load(Ordering::Relaxed) {
                "reads"
            } else {
                "meter"
            };
            let bitrate = probe::bits_per_second(self.bytes, self.start.elapsed());
            p.emit("bandwidth", json!({ "bitrate": bitrate, "source": source }));
        }
        *self = Reads::new();
    }
}

impl Player {
    /// Volume and mute as the page knows them (0..1), emitted when mpv's own differ from what
    /// was last said: the page set them, or mpv changed them by itself.
    fn emit_volume_changes(&self) {
        let now = (
            self.mpv.number("volume").unwrap_or(100.0),
            self.mpv.flag("mute"),
        );
        let mut last = self.volume.lock().unwrap();
        if *last != now {
            *last = now;
            drop(last);
            self.emit("volume", json!({ "volume": now.0 / 100.0, "muted": now.1 }));
        }
    }
}

fn watch(p: Arc<Player>) {
    let mut last_state = "";
    let mut last_position = Instant::now();
    let mut reads = Reads::new();
    loop {
        match p.mpv.wait_event(TICK) {
            Event::Shutdown => return,
            Event::FileLoaded => p.finish_load(),
            Event::Restarted => p.emit_position(),
            Event::EndFile(Some(error)) => {
                p.finish_load();
                p.emit("error", json!({ "code": "mpv", "message": error }));
            }
            _ => {}
        }
        let state = p.state();
        if state != last_state {
            p.emit("state", json!({ "state": state }));
            if last_state == "playing" {
                p.emit_position();
            }
            last_state = state;
        }
        if state == "playing" && last_position.elapsed() >= POSITION_INTERVAL {
            p.emit_position();
            last_position = Instant::now();
        }
        reads.sample(&p);
        p.emit_volume_changes();
    }
}

pub fn setup<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let cache = app.path().app_cache_dir()?;
    let (fonts, subtitles) = (cache.join("fonts"), cache.join("subtitles"));
    std::fs::create_dir_all(&fonts)?;
    std::fs::create_dir_all(&subtitles)?;
    let fonts_dir = fonts.to_string_lossy().into_owned();
    let mpv = Mpv::new(&[
        ("vo", "libmpv"),
        ("hwdec", "auto-safe"),
        // ExoPlayer stays on its last frame at the end; the page shows its end screen over it.
        ("keep-open", "yes"),
        ("idle", "yes"),
        // Every control and subtitle choice belongs to the page.
        ("osd-level", "0"),
        ("osd-bar", "no"),
        ("input-default-bindings", "no"),
        ("input-vo-keyboard", "no"),
        ("sid", "no"),
        ("sub-auto", "no"),
        ("sub-fonts-dir", &fonts_dir),
        ("ytdl", "no"),
        ("terminal", "yes"),
        ("msg-level", "all=warn"),
    ])?;
    let initial = (mpv.number("volume").unwrap_or(100.0), mpv.flag("mute"));
    let player = Arc::new(Player {
        mpv: Arc::new(mpv),
        listeners: Mutex::default(),
        loading: Mutex::new(false),
        loaded: Condvar::new(),
        direct: AtomicBool::new(false),
        volume: Mutex::new(initial),
        fonts,
        subtitles,
        downloads: app.path().app_data_dir()?.join("downloads"),
    });
    let watcher = player.clone();
    thread::Builder::new()
        .name("mpv-events".into())
        .spawn(move || watch(watcher))?;
    app.manage(player);
    Ok(())
}

pub fn attach<R: Runtime>(webview: Webview<R>) {
    static ATTACHED: AtomicBool = AtomicBool::new(false);
    let Some(player) = webview.try_state::<Arc<Player>>() else {
        return;
    };
    if ATTACHED.swap(true, Ordering::Relaxed) {
        return;
    }
    let mpv = player.mpv.clone();
    if let Err(e) = webview.with_webview(move |w| view::attach(w.inner(), mpv)) {
        eprintln!("no video layer: {e}");
    }
}

fn hardware_codecs() -> &'static [(&'static str, Vec<&'static str>)] {
    static CODECS: OnceLock<Vec<(&'static str, Vec<&'static str>)>> = OnceLock::new();
    CODECS.get_or_init(
        || match probe::va_decode_profiles().map(|p| probe::codecs_from_va(&p)) {
            Some(found) if !found.is_empty() => found,
            _ => probe::software_codecs(),
        },
    )
}

/// mpv decodes nearly everything and tone-maps HDR to the display itself, so it takes HDR as-is.
/// Video codecs come from what VA-API decodes (software when there is none), bounded by the
/// monitor the window is on.
#[tauri::command]
pub fn capabilities() -> Value {
    let display = view::on_gtk(view::display).unwrap_or_default();
    probe::capabilities(hardware_codecs(), &display)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn deviceInfo(player: State<'_, Arc<Player>>) -> Value {
    let read = |path: &str| {
        std::fs::read_to_string(path)
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    };
    let display = view::on_gtk(view::display).unwrap_or_default();
    json!({
        "name": read("/proc/sys/kernel/hostname"),
        "model": read("/sys/devices/virtual/dmi/id/product_name"),
        "platform": "Linux",
        "player": player.mpv.get("mpv-version").unwrap_or_else(|| "mpv".into()),
        "display": {
            "name": display.name,
            "width": display.width,
            "height": display.height,
            "refresh_hz": display.refresh_hz,
            "hdr": [],
        },
    })
}

/// Desktop displays are not switched to the film's rate, so there is nothing to ask for or undo.
#[tauri::command]
#[allow(non_snake_case)]
pub fn frameRate() {}

#[tauri::command]
#[allow(non_snake_case)]
pub fn restoreDisplay() {}

/// `volume` is 0..1 on the page and 0..100 in mpv.
#[tauri::command]
pub fn volume(player: State<'_, Arc<Player>>, volume: f64, muted: bool) -> Done {
    player
        .mpv
        .set("volume", &(volume.clamp(0.0, 1.0) * 100.0).to_string())?;
    player.mpv.set("mute", if muted { "yes" } else { "no" })?;
    player.emit_volume_changes();
    Ok(())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn subtitleLift(px: f64) {
    let _ = view::on_gtk(move || view::lift(px));
}

/// The picture's rectangle in CSS pixels of the window, or the whole window with `full`.
#[tauri::command]
pub fn viewport(
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
    full: Option<bool>,
) {
    let rect = match (x, y, width, height) {
        (Some(x), Some(y), Some(width), Some(height)) if full != Some(true) => Some(Rect {
            x,
            y,
            width,
            height,
        }),
        _ => None,
    };
    let _ = view::on_gtk(move || view::place(rect));
}

#[tauri::command]
pub async fn load(
    player: State<'_, Arc<Player>>,
    url: String,
    at: Option<f64>,
    audio: Option<u32>,
) -> Done {
    let p = player.inner().clone();
    let _ = view::on_gtk(|| view::see_through(true));
    tauri::async_runtime::spawn_blocking(move || p.load(&url, at.unwrap_or(0.0), audio))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn stop(player: State<'_, Arc<Player>>) -> Done {
    player.finish_load();
    let _ = view::on_gtk(|| view::see_through(false));
    player.mpv.command(&["stop"])
}

#[tauri::command]
pub fn play(player: State<'_, Arc<Player>>) -> Done {
    player.mpv.set("pause", "no")
}

#[tauri::command]
pub fn pause(player: State<'_, Arc<Player>>) -> Done {
    player.mpv.set("pause", "yes")
}

#[tauri::command]
pub fn seek(player: State<'_, Arc<Player>>, seconds: f64) -> Done {
    // Nothing to seek before a file opens; ExoPlayer ignores that too.
    let _ = player
        .mpv
        .command(&["seek", &seconds.max(0.0).to_string(), "absolute"]);
    Ok(())
}

#[tauri::command]
pub fn speed(player: State<'_, Arc<Player>>, speed: f64) -> Done {
    player.mpv.set("speed", &speed.to_string())
}

#[tauri::command]
pub fn stats(player: State<'_, Arc<Player>>) -> Value {
    let m = &player.mpv;
    let version = m.get("mpv-version").unwrap_or_default();
    let dropped = m.number("frame-drop-count").unwrap_or(0.0)
        + m.number("decoder-frame-drop-count").unwrap_or(0.0);
    json!({
        "player": format!("{version} \u{00B7} Linux"),
        "version": version,
        "buffer": m.number("demuxer-cache-duration").unwrap_or(0.0),
        "videoBitrate": m.number("video-bitrate").unwrap_or(-1.0),
        "audioBitrate": m.number("audio-bitrate").unwrap_or(-1.0),
        "rendered": m.number("estimated-frame-number").unwrap_or(0.0),
        "dropped": dropped,
        "displayHz": m.number("display-fps-override").unwrap_or(0.0),
    })
}

#[tauri::command]
pub async fn subtitle(
    player: State<'_, Arc<Player>>,
    kind: Option<String>,
    url: Option<String>,
    fonts: Option<Vec<String>>,
) -> Done {
    let p = player.inner().clone();
    let _ = p.mpv.command(&["sub-remove"]);
    p.mpv.set("sid", "no")?;
    let Some(url) = url.filter(|_| matches!(kind.as_deref(), Some("ass" | "pgs"))) else {
        return Ok(());
    };
    // libass reads the fonts directory when a track opens, so they land before `sub-add`.
    for font in fonts.unwrap_or_default() {
        match fetch_cached(&font, &p.fonts, &p.downloads).await {
            Ok(file) if !file.starts_with(&p.fonts) => {
                // libass reads one fonts directory, so a download's fonts are copied into it.
                let name = file.file_name().unwrap_or_default().to_string_lossy();
                let _ = std::fs::copy(&file, p.fonts.join(format!("{}-{name}", cache_name(&font))));
            }
            Ok(_) => {}
            Err(e) => eprintln!("subtitle font {font}: {e}"),
        }
    }
    // A local file, as on Android: mpv opens a subtitle URL by seeking around in it, which a
    // server without range requests answers with a failure.
    let file = match fetch_cached(&url, &p.subtitles, &p.downloads).await {
        Ok(file) => file,
        Err(e) => {
            eprintln!("subtitle {url}: {e}");
            p.emit("subtitleFailed", json!({}));
            return Ok(());
        }
    };
    // A track with no line in the file extracts to nothing, and mpv refuses an empty file.
    if std::fs::metadata(&file).is_ok_and(|m| m.len() == 0) {
        return Ok(());
    }
    let added = tauri::async_runtime::spawn_blocking(move || {
        let ok = p
            .mpv
            .command(&["sub-add", &file.to_string_lossy(), "select"]);
        (p, ok)
    })
    .await
    .map_err(|e| e.to_string())?;
    if let (p, Err(e)) = added {
        eprintln!("subtitle failed: {e}");
        p.emit("subtitleFailed", json!({}));
    }
    Ok(())
}

/// The query is left out of the name: it carries a signature that changes on every tracks call.
fn cache_name(url: &str) -> String {
    let stable = url.split('?').next().unwrap_or_default();
    let mut hash = DefaultHasher::new();
    stable.hash(&mut hash);
    let last = stable.rsplit('/').next().unwrap_or_default();
    format!("{:x}-{last}", hash.finish())
}

/// Downloads `url` into `dir` once, named by a hash of the URL and its last path segment. A
/// path inside `downloads` is a file a download saved: it is used where it lies.
async fn fetch_cached(url: &str, dir: &Path, downloads: &Path) -> Result<PathBuf, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        let file = Path::new(url).canonicalize().map_err(|e| e.to_string())?;
        let root = downloads.canonicalize().map_err(|e| e.to_string())?;
        return if file.starts_with(root) {
            Ok(file)
        } else {
            Err("not a download".into())
        };
    }
    let file = dir.join(cache_name(url));
    if file.exists() {
        return Ok(file);
    }
    let bytes = reqwest::get(url)
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let partial = file.with_extension("part");
    std::fs::write(&partial, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&partial, &file).map_err(|e| e.to_string())?;
    Ok(file)
}

#[tauri::command]
pub fn timing(
    player: State<'_, Arc<Player>>,
    subtitle_offset: f64,
    subtitle_scale: f64,
    audio_delay: f64,
) -> Done {
    // Same signs as the Android plugin: positive shows subtitles and plays sound later.
    player.mpv.set("sub-delay", &subtitle_offset.to_string())?;
    player.mpv.set("sub-scale", &subtitle_scale.to_string())?;
    player.mpv.set("audio-delay", &audio_delay.to_string())
}

#[tauri::command]
pub fn register_listener(player: State<'_, Arc<Player>>, event: String, handler: Channel<Value>) {
    player
        .listeners
        .lock()
        .unwrap()
        .entry(event)
        .or_default()
        .push(handler);
}

#[tauri::command]
pub fn remove_listener(player: State<'_, Arc<Player>>, event: String, channel_id: u32) {
    if let Some(channels) = player.listeners.lock().unwrap().get_mut(&event) {
        channels.retain(|c| c.id() != channel_id);
    }
}

#[cfg(test)]
mod tests {
    use super::cache_name;

    #[test]
    fn a_new_signature_reuses_the_cached_file() {
        let a = cache_name("http://e/media/j1/fonts/A.ttf?exp=1&sig=aa");
        assert_eq!(a, cache_name("http://e/media/j1/fonts/A.ttf?exp=2&sig=bb"));
        assert!(a.ends_with("-A.ttf"));
        assert_ne!(a, cache_name("http://e/media/j2/fonts/A.ttf?exp=1&sig=aa"));
    }
}
