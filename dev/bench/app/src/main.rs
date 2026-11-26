// One window on the served desktop build, the shim and the bench driver as its init script.
// BENCH_URL: page to open; BENCH_INIT: path of the init script; BENCH_SIZE: the window's inner
// size, "1440x900" by default. Same source for wry, CEF and Qt.
// BENCH_ACCEL (wry): never|always sets WebKitGTK's hardware acceleration policy on the web view
// the way an application can, through its settings once Tauri has created it.
// BENCH_FEATURES (wry): WebKit runtime features to set the same way, "Name=1,Other=0"; "list"
// prints every feature the library knows with its default and status, and sets none. The web
// process reads some of them once, when it creates the page, and wry has loaded the page by the
// time an application sees the web view: the bench ends that web process and loads the page
// again, so the next one starts with the features set. BENCH_RELOAD=1 does the same without
// features, for a policy the page has to start with (WebKitGTK 2.54 picks its renderer once).
// BENCH_UNDERLAY (wry): opaque|seethrough puts a GtkGLArea under the web view, as the player
// does for mpv's picture; seethrough also makes the web view's background transparent, as the
// player does while it plays. BENCH_UNDERLAY_FPS redraws the area that often, as a video would.
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

// The player's window (plugins/tauri-plugin-player/src/view.rs): the web view over a GtkGLArea
// in a GtkOverlay, GTK's own backgrounds off. The area is cleared to one colour, where the
// player has mpv draw.
#[cfg(feature = "wry")]
mod underlay {
    use gtk::prelude::*;
    use webkit2gtk::WebViewExt;

    #[link(name = "GL")]
    extern "C" {
        fn glClearColor(red: f32, green: f32, blue: f32, alpha: f32);
        fn glClear(mask: u32);
    }
    const GL_COLOR_BUFFER_BIT: u32 = 0x4000;

    pub fn attach(webview: &webkit2gtk::WebView, see_through: bool, fps: Option<u32>) {
        let Some(parent) = webview.parent().and_downcast::<gtk::Container>() else {
            eprintln!("the webview has no container; no underlay");
            return;
        };
        parent.remove(webview);
        let overlay = gtk::Overlay::new();
        let area = gtk::GLArea::new();
        let frame = std::cell::Cell::new(0u32);
        area.connect_render(move |_, _| {
            // The colour moves with each frame, so a redraw is a different picture.
            frame.set(frame.get().wrapping_add(1));
            let level = (frame.get() % 64) as f32 / 255.0;
            // SAFETY: GTK made the area's GL context current before this signal.
            unsafe {
                glClearColor(level, 0.6, 0.2, 1.0);
                glClear(GL_COLOR_BUFFER_BIT);
            }
            gtk::glib::Propagation::Stop
        });
        overlay.add(&area);
        overlay.add_overlay(webview);
        match parent.downcast_ref::<gtk::Box>() {
            Some(b) => b.pack_start(&overlay, true, true, 0),
            None => parent.add(&overlay),
        }
        let css = gtk::CssProvider::new();
        if css
            .load_from_data(b"window, window.background, box, overlay { background: none; }")
            .is_ok()
        {
            if let Some(screen) = gtk::gdk::Screen::default() {
                gtk::StyleContext::add_provider_for_screen(
                    &screen,
                    &css,
                    gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
                );
            }
        }
        if see_through {
            webview.set_background_color(&gtk::gdk::RGBA::new(0.0, 0.0, 0.0, 0.0));
        }
        overlay.show_all();
        if let Some(fps) = fps.filter(|fps| *fps > 0) {
            let period = std::time::Duration::from_micros(1_000_000 / u64::from(fps));
            gtk::glib::timeout_add_local(period, move || {
                area.queue_render();
                gtk::glib::ControlFlow::Continue
            });
        }
    }
}

#[cfg(feature = "wry")]
fn tune(window: &tauri::WebviewWindow, url: String) {
    use webkit2gtk::{HardwareAccelerationPolicy, SettingsExt, WebViewExt};
    let policy = match std::env::var("BENCH_ACCEL").as_deref() {
        Ok("never") => Some(HardwareAccelerationPolicy::Never),
        Ok("always") => Some(HardwareAccelerationPolicy::Always),
        _ => None,
    };
    let features = std::env::var("BENCH_FEATURES").ok();
    let underlay = std::env::var("BENCH_UNDERLAY").ok();
    let reload = std::env::var("BENCH_RELOAD").is_ok();
    let fps = std::env::var("BENCH_UNDERLAY_FPS").ok().and_then(|fps| fps.parse().ok());
    if policy.is_none() && features.is_none() && underlay.is_none() {
        return;
    }
    window
        .with_webview(move |webview| {
            let webview = webview.inner();
            if let Some(kind) = &underlay {
                underlay::attach(&webview, kind == "seethrough", fps);
            }
            let Some(settings) = webview.settings() else {
                return;
            };
            if let Some(features) = &features {
                features::apply(&settings, features);
            }
            if let Some(policy) = policy {
                settings.set_hardware_acceleration_policy(policy);
            }
            if reload || features.as_deref().is_some_and(|spec| spec != "list") {
                let (page, url) = (webview.clone(), url.clone());
                gtk::glib::timeout_add_local_once(std::time::Duration::from_millis(300), move || {
                    page.terminate_web_process();
                    page.load_uri(&url);
                });
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
            tune(&window, url.clone());
            #[cfg(not(feature = "wry"))]
            let _ = window;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("bench");
}
