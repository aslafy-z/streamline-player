// One window on the served desktop build, the shim and the bench driver as its init script.
// BENCH_URL: page to open; BENCH_INIT: path of the init script. Same source for wry, CEF and Qt.
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg(feature = "qt")]
type AppRuntime = tauri_runtime_qt::QtRuntime;
#[cfg(feature = "cef")]
type AppRuntime = tauri_runtime_cef::Cef;
#[cfg(feature = "wry")]
type AppRuntime = tauri::Wry;

#[cfg_attr(feature = "cef", tauri_runtime_cef::cef_entry_point)]
fn main() {
    let url = std::env::var("BENCH_URL").unwrap_or_else(|_| "http://127.0.0.1:1440/".into());
    let init = std::env::var("BENCH_INIT")
        .ok()
        .map(|p| std::fs::read_to_string(p).expect("BENCH_INIT"))
        .unwrap_or_default();
    #[cfg(feature = "cef")]
    // BENCH_CEF_ARGS: Chromium switches, "name" or "name=value", comma-separated.
    let args: Vec<(String, Option<String>)> = std::env::var("BENCH_CEF_ARGS")
        .unwrap_or_default()
        .split(',')
        .filter(|a| !a.is_empty())
        .map(|a| match a.split_once('=') {
            Some((k, v)) => (k.to_string(), Some(v.to_string())),
            None => (a.to_string(), None),
        })
        .collect();
    #[cfg(feature = "cef")]
    let builder = tauri::Builder::default().runtime(
        tauri_runtime_cef::Cef::default()
            .sandbox(tauri_runtime_cef::SandboxPolicy::Disabled)
            .command_line_args(args),
    );
    #[cfg(not(feature = "cef"))]
    let builder = tauri::Builder::<AppRuntime>::new();
    #[cfg(feature = "qt")]
    let builder = builder.invoke_system(tauri_runtime_qt::INVOKE_SYSTEM_SCRIPT);
    builder
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
                .title("bench")
                .inner_size(1440.0, 900.0)
                .initialization_script(&init)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("bench");
}
