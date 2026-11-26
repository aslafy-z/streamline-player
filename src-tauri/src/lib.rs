use serde_json::{Value, json};
use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, RwLock},
};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(any(test, target_os = "android"))]
mod android_service;
mod auth;
#[cfg(downloads)]
mod downloads;

#[derive(Clone, Default)]
struct Conn {
    server: Option<String>,
    key: Option<String>,
    /// Why the key could not go into secure storage: it then lasts until the app closes.
    store_error: Option<String>,
    loaded: bool,
}

enum Body {
    None,
    Json(Value),
    Raw(Vec<u8>, String),
}

pub struct Api {
    http: reqwest::Client,
    app: AppHandle,
    conn: RwLock<Conn>,
    /// The device code of the pairing in progress: a credential, so it never reaches the page.
    pairing: Mutex<Option<String>>,
}

fn host_of(url: &str) -> &str {
    url.split_once("://").map_or(url, |(_, host)| host)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Movies,
    Series,
}

impl Kind {
    fn path(&self) -> &'static str {
        match self {
            Kind::Movies => "/movies",
            Kind::Series => "/series",
        }
    }
}

// Images load through <img>, which can't carry the device key, so they pass through here.
async fn artwork(app: AppHandle, path: String) -> tauri::http::Response<Vec<u8>> {
    #[cfg(downloads)]
    if let Some(bytes) = app.state::<Downloads>().0.local_artwork(&path) {
        return jpeg(Ok(bytes));
    }
    // The account's own photo changes under one path, told apart by a query only.
    #[cfg(target_os = "android")]
    if !path.starts_with("/users/") {
        return jpeg(kept_picture(&app, &path).await);
    }
    jpeg(app.state::<Api>().picture(&path).await)
}

/// Android's WebView asks for pictures one at a time, waits for each, keeps none, and holds the
/// app's own pages in the same queue. The page names the pictures it is about to draw
/// (`warm_artwork`), so they are fetched together and answered from here.
#[cfg(target_os = "android")]
#[derive(Default)]
struct Pictures(
    Mutex<std::collections::HashMap<String, std::sync::Arc<tokio::sync::OnceCell<Vec<u8>>>>>,
);

// ponytail: everything is dropped at once when full; an LRU if the reload shows.
#[cfg(target_os = "android")]
const PICTURES_KEPT: usize = 300;

#[cfg(target_os = "android")]
async fn kept_picture(app: &AppHandle, path: &str) -> Result<Vec<u8>, String> {
    let pictures = app.state::<Pictures>();
    let cell = {
        let mut kept = pictures.0.lock().unwrap();
        if kept.len() >= PICTURES_KEPT {
            kept.clear();
        }
        kept.entry(path.to_owned()).or_default().clone()
    };
    cell.get_or_try_init(|| stored_picture(app, path))
        .await
        .cloned()
}

/// Pictures outlive the app on disk. The server is asked whether the kept one is still current,
/// which costs no transfer when it is, and a kept one still serves when the server cannot be
/// reached.
#[cfg(target_os = "android")]
async fn stored_picture(app: &AppHandle, path: &str) -> Result<Vec<u8>, String> {
    let file = app.path().app_cache_dir().map(|dir| {
        dir.join("pictures")
            .join(path.trim_start_matches('/').replace('/', "_"))
    });
    // The server's `Last-Modified` for the kept file, sent back as is.
    let stamp = file.as_ref().ok().map(|f| {
        let mut s = f.clone().into_os_string();
        s.push(".modified");
        std::path::PathBuf::from(s)
    });
    let stored = file.as_ref().ok().and_then(|f| std::fs::read(f).ok());
    let since = stored
        .as_ref()
        .and(stamp.as_ref())
        .and_then(|s| std::fs::read_to_string(s).ok());
    match app
        .state::<Api>()
        .picture_since(path, since.as_deref())
        .await
    {
        Ok(None) => stored.ok_or_else(|| "kept picture vanished".to_owned()),
        Ok(Some((bytes, modified))) => {
            if let (Ok(f), Some(stamp)) = (&file, &stamp) {
                // A picture that cannot be stored is only fetched again next time.
                let _ = f.parent().map(std::fs::create_dir_all);
                let _ = std::fs::write(f, &bytes);
                let _ = match modified {
                    Some(m) => std::fs::write(stamp, m),
                    None => std::fs::remove_file(stamp),
                };
            }
            Ok(bytes)
        }
        Err(e) => stored.ok_or(e),
    }
}

#[cfg_attr(not(target_os = "android"), allow(unused_variables))]
#[tauri::command]
fn warm_artwork(app: AppHandle, paths: Vec<String>) {
    #[cfg(target_os = "android")]
    for path in paths {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = kept_picture(&app, &path).await;
        });
    }
}

fn jpeg(bytes: Result<Vec<u8>, String>) -> tauri::http::Response<Vec<u8>> {
    match bytes {
        Ok(bytes) => tauri::http::Response::builder()
            .header("Content-Type", "image/jpeg")
            .body(bytes),
        Err(_) => tauri::http::Response::builder()
            .status(404)
            .body(Vec::new()),
    }
    .expect("static response parts are valid")
}

impl Api {
    /// A picture of the server's, fetched with the device key.
    async fn picture(&self, path: &str) -> Result<Vec<u8>, String> {
        self.picture_since(path, None)
            .await?
            .map(|(bytes, _)| bytes)
            .ok_or_else(|| "unchanged without a kept copy".to_owned())
    }

    /// With `since`, the `Last-Modified` of a kept copy: `None` while that copy is current.
    /// A new picture comes with its own `Last-Modified`.
    async fn picture_since(
        &self,
        path: &str,
        since: Option<&str>,
    ) -> Result<Option<(Vec<u8>, Option<String>)>, String> {
        let conn = self.conn().await;
        let mut req = self.http.get(format!(
            "{}/extensions/player/posters{path}",
            conn.server.unwrap_or_default()
        ));
        if let Some(key) = &conn.key {
            req = req.header("X-API-Key", key);
        }
        if let Some(since) = since {
            req = req.header(reqwest::header::IF_MODIFIED_SINCE, since);
        }
        let fetched = async {
            let resp = req.send().await?;
            if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
                return Ok(None);
            }
            let resp = resp.error_for_status()?;
            let modified = resp
                .headers()
                .get(reqwest::header::LAST_MODIFIED)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            Ok(Some((resp.bytes().await?.to_vec(), modified)))
        };
        fetched.await.map_err(|e: reqwest::Error| e.to_string())
    }

    /// Reads the server address and the key on first use: the key store can block, and on
    /// Android it answers on the main thread, so never during setup.
    async fn conn(&self) -> Conn {
        let conn = self.conn.read().unwrap().clone();
        if conn.loaded {
            return conn;
        }
        let app = self.app.clone();
        let (server, key) = tauri::async_runtime::spawn_blocking(move || {
            (auth::read_server(&app), auth::load_key(&app))
        })
        .await
        .expect("key store read panicked");
        let mut c = self.conn.write().unwrap();
        if !c.loaded {
            *c = Conn {
                server,
                key: key.unwrap_or_else(|e| {
                    eprintln!("device key unreadable: {e}");
                    None
                }),
                store_error: None,
                loaded: true,
            };
        }
        c.clone()
    }

    fn set_server(&self, url: String) {
        self.conn.write().unwrap().server = Some(url);
    }

    fn set_key(&self, key: String, store_error: Option<String>) {
        let mut c = self.conn.write().unwrap();
        c.key = Some(key);
        c.store_error = store_error;
    }

    async fn forget_key(&self) {
        self.conn.write().unwrap().key = None;
        let app = self.app.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || auth::delete_key(&app)).await;
    }

    async fn call(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, String> {
        self.call_with(method, path, body.map_or(Body::None, Body::Json))
            .await
    }

    async fn call_with(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Body,
    ) -> Result<Value, String> {
        let conn = self.conn().await;
        let Some(server) = conn.server else {
            return Err(json!({ "error": { "code": "no_server" } }).to_string());
        };
        let mut req = self
            .http
            .request(method, format!("{server}/extensions/player{path}"));
        if let Some(key) = &conn.key {
            req = req.header("X-API-Key", key);
        }
        req = match body {
            Body::None => req,
            Body::Json(b) => req.json(&b),
            Body::Raw(bytes, content_type) => req.header("Content-Type", content_type).body(bytes),
        };
        let resp = req.send().await.map_err(|e| e.to_string())?;
        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;
        let value = if text.is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&text).map_err(|e| e.to_string())?
        };
        // The key was revoked from the account page, or a password change dropped every key.
        if status == reqwest::StatusCode::UNAUTHORIZED && conn.key.is_some() {
            self.forget_key().await;
            let _ = self.app.emit("signed-out", ());
        }
        if status.is_success() {
            Ok(value)
        } else {
            Err(value.to_string())
        }
    }
}

#[tauri::command]
async fn server_host(api: tauri::State<'_, Api>) -> Result<String, String> {
    Ok(api
        .conn()
        .await
        .server
        .as_deref()
        .map(host_of)
        .unwrap_or_default()
        .to_owned())
}

#[tauri::command]
async fn library(api: tauri::State<'_, Api>, kind: Kind) -> Result<Value, String> {
    api.call(reqwest::Method::GET, kind.path(), None).await
}

#[tauri::command]
async fn title(api: tauri::State<'_, Api>, kind: Kind, id: u32) -> Result<Value, String> {
    api.call(reqwest::Method::GET, &format!("{}/{id}", kind.path()), None)
        .await
}

#[tauri::command]
async fn person(api: tauri::State<'_, Api>, id: String) -> Result<Value, String> {
    // A slug from the server, but it lands in a URL path: refuse anything that could leave it.
    if !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err(json!({ "error": { "code": "not_found" } }).to_string());
    }
    api.call(reqwest::Method::GET, &format!("/people/{id}"), None)
        .await
}

#[tauri::command]
async fn watch_state(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::GET, "/watchstate", None).await
}

#[tauri::command]
async fn set_watched(
    api: tauri::State<'_, Api>,
    media_id: String,
    watched: bool,
) -> Result<Value, String> {
    api.call(
        reqwest::Method::PUT,
        &format!("/watchstate/{media_id}"),
        Some(json!({ "watched": watched })),
    )
    .await
}

#[tauri::command]
async fn me(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::GET, "/me", None).await
}

#[tauri::command]
async fn home(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::GET, "/home", None).await
}

/// The image travels as the raw body of the call, its type in `x-picture-type`.
#[tauri::command]
async fn set_picture(
    api: tauri::State<'_, Api>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(json!({ "error": { "code": "invalid_request" } }).to_string());
    };
    let content_type = request
        .headers()
        .get("x-picture-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    api.call_with(
        reqwest::Method::PUT,
        "/me/picture",
        Body::Raw(bytes.clone(), content_type),
    )
    .await
    .map(drop)
}

#[tauri::command]
async fn remove_picture(api: tauri::State<'_, Api>) -> Result<(), String> {
    api.call(reqwest::Method::DELETE, "/me/picture", None)
        .await
        .map(drop)
}

#[tauri::command]
async fn revoke_device(api: tauri::State<'_, Api>, id: String) -> Result<(), String> {
    if !id
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(json!({ "error": { "code": "not_found" } }).to_string());
    }
    api.call(reqwest::Method::DELETE, &format!("/devices/{id}"), None)
        .await
        .map(drop)
}

#[tauri::command]
async fn devices(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::GET, "/devices", None).await
}

#[tauri::command]
async fn activity(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::GET, "/activity", None).await
}

#[tauri::command]
async fn activity_read(api: tauri::State<'_, Api>, ids: Vec<String>) -> Result<(), String> {
    api.call(
        reqwest::Method::POST,
        "/activity/read",
        Some(json!({ "ids": ids })),
    )
    .await
    .map(drop)
}

fn safe_id(id: &str) -> Result<(), String> {
    if !id.is_empty()
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        Ok(())
    } else {
        Err(json!({ "error": { "code": "not_found" } }).to_string())
    }
}

fn with_message(message: Option<String>) -> Value {
    message.map_or_else(|| json!({}), |m| json!({ "message": m }))
}

#[tauri::command]
async fn admin_overview(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::GET, "/admin/overview", None)
        .await
}

#[tauri::command]
async fn admin_settings(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::GET, "/admin/settings", None)
        .await
}

#[tauri::command]
async fn save_admin_settings(api: tauri::State<'_, Api>, patch: Value) -> Result<Value, String> {
    api.call(reqwest::Method::PATCH, "/admin/settings", Some(patch))
        .await
}

#[tauri::command]
async fn admin_restart(api: tauri::State<'_, Api>, message: Option<String>) -> Result<(), String> {
    api.call(
        reqwest::Method::POST,
        "/admin/restart",
        Some(with_message(message)),
    )
    .await
    .map(drop)
}

#[tauri::command]
async fn admin_streams(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::GET, "/admin/streams", None).await
}

#[tauri::command]
async fn stop_stream(
    api: tauri::State<'_, Api>,
    id: String,
    message: Option<String>,
) -> Result<(), String> {
    safe_id(&id)?;
    api.call(
        reqwest::Method::POST,
        &format!("/admin/streams/{id}/stop"),
        Some(with_message(message)),
    )
    .await
    .map(drop)
}

#[tauri::command]
async fn admin_pairings(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::GET, "/admin/pairings", None)
        .await
}

#[tauri::command]
async fn admin_devices(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::GET, "/admin/devices", None).await
}

#[tauri::command]
async fn admin_users(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::GET, "/admin/users", None).await
}

#[tauri::command]
async fn admin_resolve_pairing(
    api: tauri::State<'_, Api>,
    code: String,
    approve: bool,
    user_id: Option<u32>,
) -> Result<(), String> {
    safe_id(&code)?;
    let verb = if approve { "approve" } else { "deny" };
    let body = match (approve, user_id) {
        (true, Some(id)) => Some(json!({ "user_id": id })),
        (true, None) => return Err(json!({ "error": { "code": "invalid_request" } }).to_string()),
        (false, _) => None,
    };
    api.call(
        reqwest::Method::POST,
        &format!("/admin/pairings/{code}/{verb}"),
        body,
    )
    .await
    .map(drop)
}

#[tauri::command]
async fn admin_revoke_device(api: tauri::State<'_, Api>, id: String) -> Result<(), String> {
    safe_id(&id)?;
    api.call(
        reqwest::Method::DELETE,
        &format!("/admin/devices/{id}"),
        None,
    )
    .await
    .map(drop)
}

#[tauri::command]
async fn admin_library(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::GET, "/admin/library", None).await
}

#[tauri::command]
async fn admin_scan(
    api: tauri::State<'_, Api>,
    folder_id: Option<String>,
    movies: Option<Vec<i64>>,
    episodes: Option<Vec<i64>>,
) -> Result<(), String> {
    let body = match (movies, episodes, folder_id) {
        (None, None, Some(id)) => json!({ "folder_id": id }),
        (None, None, None) => json!({}),
        (movies, episodes, _) => json!({ "movies": movies, "episodes": episodes }),
    };
    api.call(reqwest::Method::POST, "/admin/library/scan", Some(body))
        .await
        .map(drop)
}

#[tauri::command]
async fn admin_engine_secret(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::GET, "/admin/engine/secret", None)
        .await
}

#[tauri::command]
async fn admin_rotate_engine_secret(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::POST, "/admin/engine/secret", None)
        .await
}

#[tauri::command]
async fn admin_clear_cache(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::POST, "/admin/cache/clear", None)
        .await
}

#[tauri::command]
async fn playback_status(api: tauri::State<'_, Api>) -> Result<Value, String> {
    api.call(reqwest::Method::GET, "/playback/status", None)
        .await
}

/// The session this device has open, on disk so that a launch after a crash, or a page reload,
/// can stop it: both skip `stop_session`, and the dead session would hold its conversion slot
/// until Streamline's heartbeat timeout.
fn open_session_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("open-session"))
}

fn record_open_session(app: &AppHandle, id: &str) {
    if let Some(file) = open_session_file(app) {
        let _ = file.parent().map(fs::create_dir_all);
        let _ = fs::write(file, id);
    }
}

fn forget_open_session(app: &AppHandle, id: &str) {
    if let Some(file) = open_session_file(app)
        && fs::read_to_string(&file).is_ok_and(|open| open == id)
    {
        let _ = fs::remove_file(file);
    }
}

fn stop_left_over_session(app: &AppHandle) {
    let Some(file) = open_session_file(app) else {
        return;
    };
    let Ok(id) = fs::read_to_string(&file) else {
        return;
    };
    // Removed before the DELETE is sent, so a session started meanwhile is never the one forgotten.
    let _ = fs::remove_file(file);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let path = format!("/playback/sessions/{id}");
        let _ = app
            .state::<Api>()
            .call(reqwest::Method::DELETE, &path, None)
            .await;
    });
}

#[tauri::command]
async fn start_session(
    app: AppHandle,
    api: tauri::State<'_, Api>,
    media_id: String,
    capabilities: Value,
    position: f64,
    tracks: Value,
) -> Result<Value, String> {
    let mut body = json!({
        "media_id": media_id,
        "capabilities": capabilities,
        "position": position,
    });
    if let (Some(body), Some(tracks)) = (body.as_object_mut(), tracks.as_object()) {
        body.extend(tracks.clone());
    }
    let session = api
        .call(reqwest::Method::POST, "/playback/sessions", Some(body))
        .await?;
    if let Some(id) = session["session_id"].as_str() {
        record_open_session(&app, id);
    }
    Ok(session)
}

#[tauri::command]
async fn decisions(
    api: tauri::State<'_, Api>,
    media_id: String,
    capabilities: Value,
    options: Value,
) -> Result<Value, String> {
    api.call(
        reqwest::Method::POST,
        "/playback/decisions",
        Some(json!({
            "media_id": media_id,
            "capabilities": capabilities,
            "options": options,
        })),
    )
    .await
}

#[tauri::command]
async fn media_tracks(api: tauri::State<'_, Api>, media_id: String) -> Result<Value, String> {
    api.call(
        reqwest::Method::GET,
        &format!("/playback/media/{media_id}/tracks"),
        None,
    )
    .await
}

/// The engine authorises a media file by its signed URL alone; the device key stays out of this request.
async fn fetch_text(http: &reqwest::Client, url: &str) -> Result<String, String> {
    http.get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn media_text(
    app: AppHandle,
    api: tauri::State<'_, Api>,
    url: String,
) -> Result<String, String> {
    #[cfg(downloads)]
    if downloads::is_local(&url) {
        let dir = downloads_dir(&app)?;
        return downloads::read_local_text(&dir, &url);
    }
    let _ = &app;
    fetch_text(&api.http, &url).await
}

#[tauri::command]
async fn patch_session(
    api: tauri::State<'_, Api>,
    id: String,
    changes: Value,
) -> Result<Value, String> {
    api.call(
        reqwest::Method::PATCH,
        &format!("/playback/sessions/{id}"),
        Some(changes),
    )
    .await
}

#[tauri::command]
async fn session_info(api: tauri::State<'_, Api>, id: String) -> Result<Value, String> {
    api.call(
        reqwest::Method::GET,
        &format!("/playback/sessions/{id}"),
        None,
    )
    .await
}

#[tauri::command]
async fn stop_session(
    app: AppHandle,
    api: tauri::State<'_, Api>,
    id: String,
) -> Result<(), String> {
    forget_open_session(&app, &id);
    api.call(
        reqwest::Method::DELETE,
        &format!("/playback/sessions/{id}"),
        None,
    )
    .await
    .map(drop)
}

#[tauri::command]
async fn heartbeat(
    api: tauri::State<'_, Api>,
    id: String,
    position: f64,
    paused: bool,
) -> Result<(), String> {
    let body = json!({ "position": position, "paused": paused });
    api.call(
        reqwest::Method::POST,
        &format!("/playback/sessions/{id}/progress"),
        Some(body),
    )
    .await
    .map(drop)
}

#[tauri::command]
async fn reachable(api: tauri::State<'_, Api>) -> Result<bool, String> {
    let answer = api
        .call(reqwest::Method::GET, "/playback/status", None)
        .await;
    Ok(answer.as_ref().err().is_none_or(|e| downloads_is_answer(e)))
}

#[cfg(downloads)]
fn downloads_is_answer(e: &str) -> bool {
    downloads::is_answer(e)
}

#[cfg(not(downloads))]
fn downloads_is_answer(e: &str) -> bool {
    serde_json::from_str::<Value>(e).is_ok()
}

#[cfg(downloads)]
struct Downloads(downloads::Queue);

#[cfg(downloads)]
fn downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("downloads"))
        .map_err(|e| e.to_string())
}

#[cfg(downloads)]
struct AppServer(AppHandle);

#[cfg(downloads)]
impl downloads::Server for AppServer {
    fn call(
        &self,
        method: reqwest::Method,
        path: String,
        body: Option<Value>,
    ) -> downloads::BoxFuture<Result<Value, String>> {
        let app = self.0.clone();
        Box::pin(async move { app.state::<Api>().call(method, &path, body).await })
    }

    fn picture(&self, path: String) -> downloads::BoxFuture<Result<Vec<u8>, String>> {
        let app = self.0.clone();
        Box::pin(async move { app.state::<Api>().picture(&path).await })
    }
}

#[cfg(downloads)]
#[tauri::command]
fn list_downloads(queue: tauri::State<'_, Downloads>) -> Vec<downloads::DownloadEntry> {
    queue.0.items()
}

#[cfg(downloads)]
static WIFI_ONLY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(target_os = "android")]
#[tauri::command]
async fn metered(app: AppHandle) -> bool {
    android_service::metered(&app)
}

/// The "Download on Wi-Fi only" setting, which lives with the page's other preferences.
#[cfg(downloads)]
#[tauri::command]
fn set_wifi_only(on: bool) {
    WIFI_ONLY.store(on, std::sync::atomic::Ordering::Relaxed);
}

#[cfg(downloads)]
#[tauri::command]
fn start_downloads(
    queue: tauri::State<'_, Downloads>,
    items: Vec<downloads::DownloadRequest>,
    capabilities: Value,
) {
    queue.0.start(items, capabilities);
}

#[cfg(downloads)]
#[tauri::command]
async fn remove_downloads(
    queue: tauri::State<'_, Downloads>,
    keys: Vec<String>,
) -> Result<(), String> {
    queue.0.remove(keys).await;
    Ok(())
}

#[cfg(downloads)]
#[tauri::command]
fn retry_download(queue: tauri::State<'_, Downloads>, key: String) {
    queue.0.retry(&key);
}

#[cfg(downloads)]
#[tauri::command]
async fn download_storage(
    queue: tauri::State<'_, Downloads>,
) -> Result<downloads::Storage, String> {
    Ok(queue.0.storage())
}

#[cfg(downloads)]
#[tauri::command]
fn local_playback(queue: tauri::State<'_, Downloads>, key: String) -> Option<downloads::Local> {
    queue.0.local_playback(&key)
}

#[cfg(downloads)]
#[tauri::command]
fn note_offline(queue: tauri::State<'_, Downloads>, key: String, position: f64, done: bool) {
    queue.0.note_offline(&key, position, done);
}

#[cfg(downloads)]
#[tauri::command]
async fn sync_offline(queue: tauri::State<'_, Downloads>) -> Result<usize, String> {
    Ok(queue.0.sync_offline().await)
}

// ponytail: reqwest's default verifier asks Android for its trust store and panics
// unless the app ships rustls-platform-verifier's Kotlin half and initialises it.
// Mozilla's roots stand in, so a certificate authority the person installed on the
// device is not trusted; wire the platform verifier if someone needs that.
pub(crate) fn with_roots(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    #[cfg(target_os = "android")]
    return builder.tls_certs_only(
        webpki_root_certs::TLS_SERVER_ROOT_CERTS
            .iter()
            .filter_map(|c| reqwest::Certificate::from_der(c).ok()),
    );
    #[cfg(not(target_os = "android"))]
    builder
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_player::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let http = reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(10))
                .read_timeout(std::time::Duration::from_secs(30));
            let http = with_roots(http);
            #[cfg(target_os = "android")]
            app.manage(Pictures::default());
            app.manage(Api {
                http: http.build().expect("the default TLS backend builds"),
                app: app.handle().clone(),
                conn: RwLock::default(),
                pairing: Mutex::default(),
            });
            #[cfg(downloads)]
            {
                let handle = app.handle().clone();
                let emitter = handle.clone();
                #[cfg(target_os = "android")]
                let pump = android_service::ServicePump::new(handle.clone());
                app.manage(Downloads(downloads::Queue::new(
                    downloads_dir(&handle)?,
                    std::sync::Arc::new(AppServer(handle)),
                    std::sync::Arc::new(move |snapshot| {
                        let _ = emitter.emit("downloads", snapshot);
                        #[cfg(target_os = "android")]
                        pump.push(snapshot);
                    }),
                    downloads::Config {
                        #[cfg(target_os = "android")]
                        hold: {
                            let app = app.handle().clone();
                            std::sync::Arc::new(move || {
                                WIFI_ONLY.load(std::sync::atomic::Ordering::Relaxed)
                                    && android_service::metered(&app)
                            })
                        },
                        ..Default::default()
                    },
                )));
            }
            #[cfg(target_os = "linux")]
            // WebKitGTK (seen on 2.54.1) zooms pages by gtk-xft-dpi / 96, and GTK reports -1
            // when no XSETTINGS daemon runs (Hyprland, sway): pages get a zoom of -1/96, a
            // negative innerWidth and devicePixelRatio, a collapsed layout and clicks that
            // miss. Drop this once WebKitGTK ignores an unset DPI.
            if let Some(settings) = gtk::Settings::default() {
                use gtk::prelude::GtkSettingsExt;
                if settings.gtk_xft_dpi() <= 0 {
                    settings.set_gtk_xft_dpi(96 * 1024);
                }
            }
            Ok(())
        })
        // On each load, not only at launch: a reload drops the page without `stop_session`
        // while this process, and the file naming the session, live on.
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                // Off this thread: on Android it is the UI thread, and resolving the data
                // directory there waits for an answer that only the UI thread can give.
                let app = webview.app_handle().clone();
                tauri::async_runtime::spawn_blocking(move || stop_left_over_session(&app));
            }
        })
        .register_asynchronous_uri_scheme_protocol("artwork", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_owned();
            tauri::async_runtime::spawn(async move {
                responder.respond(artwork(app, path).await);
            });
        })
        .invoke_handler(tauri::generate_handler![
            auth::auth_state,
            auth::connect,
            auth::pair_start,
            auth::pair_poll,
            auth::sign_in,
            auth::auth_methods,
            auth::open_external,
            auth::sign_out,
            warm_artwork,
            server_host,
            library,
            title,
            person,
            watch_state,
            set_watched,
            me,
            home,
            set_picture,
            remove_picture,
            revoke_device,
            devices,
            activity,
            activity_read,
            admin_overview,
            admin_settings,
            save_admin_settings,
            admin_restart,
            admin_streams,
            stop_stream,
            admin_pairings,
            admin_devices,
            admin_users,
            admin_resolve_pairing,
            admin_revoke_device,
            admin_library,
            admin_scan,
            admin_engine_secret,
            admin_rotate_engine_secret,
            admin_clear_cache,
            playback_status,
            decisions,
            media_tracks,
            media_text,
            start_session,
            patch_session,
            session_info,
            stop_session,
            heartbeat,
            reachable,
            #[cfg(target_os = "android")]
            metered,
            #[cfg(downloads)]
            list_downloads,
            #[cfg(downloads)]
            start_downloads,
            #[cfg(downloads)]
            set_wifi_only,
            #[cfg(downloads)]
            remove_downloads,
            #[cfg(downloads)]
            retry_download,
            #[cfg(downloads)]
            download_storage,
            #[cfg(downloads)]
            local_playback,
            #[cfg(downloads)]
            note_offline,
            #[cfg(downloads)]
            sync_offline
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn media_text_sends_no_credential() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/media/job/2.vtt", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = conn.read(&mut buf).unwrap();
            conn.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nWEBVTT",
            )
            .unwrap();
            String::from_utf8_lossy(&buf[..n]).to_lowercase()
        });
        let text = tauri::async_runtime::block_on(fetch_text(&reqwest::Client::new(), &url));
        assert_eq!(text.unwrap(), "WEBVTT");
        let request = server.join().unwrap();
        assert!(request.starts_with("get /media/job/2.vtt"), "{request}");
        assert!(!request.contains("authorization"), "{request}");
        assert!(!request.contains("x-api-key"), "{request}");
    }
}
