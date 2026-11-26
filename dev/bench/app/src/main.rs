// One window on the served desktop build, the shim and the bench driver as its init script.
// BENCH_URL: page to open; BENCH_INIT: path of the init script; BENCH_SIZE: the window's inner
// size, "1440x900" by default. Same source for wry, CEF and Qt.
// BENCH_ACCEL (wry): never|always sets WebKitGTK's hardware acceleration policy on the web view
// the way an application can, through its settings once Tauri has created it.
// BENCH_FEATURES (wry): WebKit runtime features to set the same way, "Name=1,Other=0"; "list"
// prints every feature the library knows with its default and status, and sets none.
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg(feature = "qt")]
type AppRuntime = tauri_runtime_qt::QtRuntime;
#[cfg(feature = "cef")]
type AppRuntime = tauri_runtime_cef::Cef;
#[cfg(feature = "wry")]
type AppRuntime = tauri::Wry;

// WebKitGTK's runtime features (2.42): the webkit2gtk crate stops at the 2.40 API.
#[cfg(feature = "wry")]
mod features {
    use std::ffi::{c_char, c_int, c_void, CStr};
    use webkit2gtk::glib::translate::ToGlibPtr;

    extern "C" {
        fn webkit_settings_get_all_features() -> *mut c_void;
        fn webkit_feature_list_get_length(list: *mut c_void) -> usize;
        fn webkit_feature_list_get(list: *mut c_void, index: usize) -> *mut c_void;
        fn webkit_feature_list_unref(list: *mut c_void);
        fn webkit_feature_get_identifier(feature: *mut c_void) -> *const c_char;
        fn webkit_feature_get_default_value(feature: *mut c_void) -> c_int;
        fn webkit_feature_get_status(feature: *mut c_void) -> c_int;
        fn webkit_settings_set_feature_enabled(settings: *mut c_void, feature: *mut c_void, on: c_int);
        fn webkit_settings_get_feature_enabled(settings: *mut c_void, feature: *mut c_void) -> c_int;
    }

    // WebKitFeatureStatus, in the order of the C enum.
    const STATUS: [&str; 8] = [
        "embedder", "unstable", "internal", "developer", "testable", "preview", "stable", "mature",
    ];

    pub fn apply(settings: &webkit2gtk::Settings, spec: &str) {
        let settings: *mut webkit2gtk::ffi::WebKitSettings = settings.to_glib_none().0;
        let settings = settings.cast::<c_void>();
        let wanted: Vec<(&str, bool)> = spec
            .split(',')
            .filter_map(|one| one.split_once('='))
            .map(|(name, on)| (name, on == "1"))
            .collect();
        // SAFETY: the list and its features stay alive until the unref below, the settings
        // object is borrowed from the caller, and this runs on the GTK thread.
        unsafe {
            let list = webkit_settings_get_all_features();
            for index in 0..webkit_feature_list_get_length(list) {
                let feature = webkit_feature_list_get(list, index);
                let name = CStr::from_ptr(webkit_feature_get_identifier(feature)).to_string_lossy();
                if spec == "list" {
                    println!(
                        "feature {name} default={} now={} status={}",
                        webkit_feature_get_default_value(feature),
                        webkit_settings_get_feature_enabled(settings, feature),
                        STATUS.get(webkit_feature_get_status(feature) as usize).unwrap_or(&"?"),
                    );
                } else if let Some((_, on)) = wanted.iter().find(|(wanted, _)| *wanted == name) {
                    webkit_settings_set_feature_enabled(settings, feature, c_int::from(*on));
                    println!("feature {name} set to {on}");
                }
            }
            webkit_feature_list_unref(list);
        }
    }
}

#[cfg(feature = "wry")]
fn tune(window: &tauri::WebviewWindow) {
    use webkit2gtk::{HardwareAccelerationPolicy, SettingsExt, WebViewExt};
    let policy = match std::env::var("BENCH_ACCEL").as_deref() {
        Ok("never") => Some(HardwareAccelerationPolicy::Never),
        Ok("always") => Some(HardwareAccelerationPolicy::Always),
        _ => None,
    };
    let features = std::env::var("BENCH_FEATURES").ok();
    if policy.is_none() && features.is_none() {
        return;
    }
    window
        .with_webview(move |webview| {
            let Some(settings) = webview.inner().settings() else {
                return;
            };
            if let Some(features) = &features {
                features::apply(&settings, features);
            }
            if let Some(policy) = policy {
                settings.set_hardware_acceleration_policy(policy);
            }
        })
        .expect("with_webview");
}

#[cfg_attr(feature = "cef", tauri_runtime_cef::cef_entry_point)]
fn main() {
    let url = std::env::var("BENCH_URL").unwrap_or_else(|_| "http://127.0.0.1:1440/".into());
    let init = std::env::var("BENCH_INIT")
        .ok()
        .map(|p| std::fs::read_to_string(p).expect("BENCH_INIT"))
        .unwrap_or_default();
    let (width, height) = std::env::var("BENCH_SIZE")
        .ok()
        .and_then(|s| {
            let (w, h) = s.split_once('x')?;
            Some((w.parse().ok()?, h.parse().ok()?))
        })
        .unwrap_or((1440.0, 900.0));
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
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
                    .title("bench")
                    .inner_size(width, height)
                    .initialization_script(&init)
                    .build()?;
            #[cfg(feature = "wry")]
            tune(&window);
            #[cfg(not(feature = "wry"))]
            let _ = window;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("bench");
}
