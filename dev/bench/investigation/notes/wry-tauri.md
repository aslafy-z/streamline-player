# wry / Tauri / app: what controls WebKitGTK compositing

Source reading only, nothing built or run. Every statement is tagged READ (file:line, crate
version) or INFERRED. Registry root: `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/`
(written `$R` below). App paths are relative to the repository root.

Locked versions (READ, `Cargo.lock`): wry 0.57.1, tauri 2.12.5, tauri-runtime 2.12.2,
tauri-runtime-wry 2.12.3, tauri-utils 2.10.2, tao 0.37.2, webkit2gtk 2.0.2, webkit2gtk-sys 2.0.2,
gtk 0.18.2, gdk 0.18.2, glib 0.18.5. All of these are present in the registry (newer siblings
wry 0.57.4, tao 0.37.3, tauri-runtime-wry 2.12.5 are also there and were NOT read).

## 1. What wry 0.57.1 sets on Linux

All in `$R/wry-0.57.1/src/webkitgtk/`.

WebKitSettings (READ, `mod.rs:427-467`, `set_webview_settings`), on the web view's own default
settings object (`WebViewExt::settings(webview)`, wry never passes a `Settings` to the builder):

- `set_enable_webgl(true)` (`mod.rs:441`)
- `set_enable_webaudio(true)` (`mod.rs:442`)
- `set_enable_back_forward_navigation_gestures(attr)` (`mod.rs:443-444`)
- `set_javascript_can_access_clipboard(true)` if `attributes.clipboard` (`mod.rs:447-449`)
- `set_enable_page_cache(true)` (`mod.rs:452`)
- `set_user_agent(attr)` (`mod.rs:455`)
- `set_enable_developer_extras(true)` if devtools (`mod.rs:458-460`)
- `set_enable_javascript(false)` if `javascript_disabled` (`mod.rs:462-464`)
- Not settings but same function: input method `set_enable_preedit(false)` (`mod.rs:430-432`),
  `context.set_use_system_appearance_for_scrollbars(false)` (`mod.rs:435-437`).

Hardware acceleration policy: NOT set anywhere (READ: `grep -i 'hardware|accelerat|compositing'`
over `src/webkitgtk` and `src/lib.rs` returns only unrelated "accelerator keys" hits). So the
WebKitGTK default applies. No `enable-accelerated-2d-canvas`, no feature flags.

WebView construction (READ, `mod.rs:402-425`): `WebView::builder()` with a fresh
`UserContentManager`, `is_controlled_by_automation`, optional `WebsitePolicies` (autoplay), and
either `related_view` or `web_context`. Nothing else.

WebContext / WebsiteDataManager (READ, `web_context.rs:32-52`): `WebContext::builder()`; when a
data directory is given, a `WebsiteDataManager` with `base_cache_directory` and
`base_data_directory` both set to it, cookie persistent storage `cookies` in text format. Then
`set_automation_allowed(false)` (`web_context.rs:60-62`). Optional
`set_web_extensions_directory` (`web_context.rs:91-94`), optional proxy settings
(`mod.rs:270-283`). No process model, cache model or sandbox call.

Background / transparency (READ, `mod.rs:292-305`): `attributes.transparent` gives
`webview.set_background_color(RGBA 0,0,0,0)`; otherwise the given `background_color` if any;
otherwise nothing (WebKit default). Runtime setter at `mod.rs:872-873`.

Environment variables: none read or set on Linux (READ: `grep 'env::|set_var'` over
`src/webkitgtk` and `src/lib.rs` gives only `env::current_dir` at `web_context.rs:14`).
GL code: none. The only GDK/X11 code is the X11 child window path (`mod.rs:143-246`), which
Tauri does not use (it calls `build_gtk`, see section 2).

Load order inside `new_gtk` (READ, `mod.rs:248-400`): create web view (`:290`), background
(`:292-305`), settings (`:308`), handlers, add to container (`:327`), init scripts, then
`load_uri` / `load_html` (`:384-388`), then `show_all` (`:390-392`). There is no caller hook
between creation and the first `load_uri`.

## 2. What tauri-runtime-wry 2.12.3 and tao 0.37.2 add

- tao calls `gtk::init()` then `gtk::Application::new` + `register` in `EventLoop::new_gtk`
  (READ, `$R/tao-0.37.2/src/platform_impl/linux/event_loop.rs:224-231`). This is the first GTK/GDK
  init of the process.
- tao window visual (READ, `$R/tao-0.37.2/src/platform_impl/linux/window.rs:140-154`): RGBA
  visual only if `rgba_visual || transparent`; `set_app_paintable(true)` only if
  `app_paintable || transparent`. Defaults are false (`mod.rs:61-64`). Double buffering is
  switched off on X11 only when `!double_buffered` (`window.rs:156-163`). A transparent window
  gets a cairo `connect_draw` that fills with the background colour
  (`event_loop.rs:931-962`).
- The web view goes into tao's `default_vbox` (a `gtk::Box` added to the window,
  `window.rs:165-171`) through `webview_builder.build_gtk(vbox)` (READ,
  `$R/tauri-runtime-wry-2.12.3/src/lib.rs:5171-5174` and `:5197-5199`).
- tauri-runtime-wry passes to wry: `with_transparent(webview_attributes.transparent)`
  (`lib.rs:4740`), `with_background_color` if set (`lib.rs:4779-4780`), `with_extensions_path`
  (`lib.rs:5021-5022`), `with_related_view` (`lib.rs:5034-5035`), and a `WryWebContext::new(
  data_directory)` per data directory (`lib.rs:4714-4735`).
- Environment variables: tauri-runtime-wry reads only `TAURI_WEBVIEW_AUTOMATION`
  (`lib.rs:4713`). tao linux reads/sets none (READ, grep). tauri 2.12.5 sets only
  `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` (Windows, `$R/tauri-2.12.5/src/app.rs:2494`).
- Hardware acceleration / arbitrary WebKit settings in the builder or config: NOT exposed.
  READ: `grep -i 'hardware_accel|acceleration|compositing|WEBKIT_|DMABUF|nvidia|llvmpipe'` over
  `src/` and `CHANGELOG.md` of tao, tauri-runtime-wry, tauri, tauri-runtime, tauri-utils returns
  nothing relevant. The only Linux specific builder knobs are `with_related_view`
  (`$R/tauri-2.12.5/src/webview/webview_window.rs:1452`) and `extensions_path` (`:1189`).
- The app config sets no `transparent` (READ, `src-tauri/tauri.conf.json`,
  `src-tauri/tauri.linux.conf.json`: only `decorations: false`), so: no RGBA visual, no app
  paintable, and wry sets no background colour at creation.

## 3. What the application can reach

- `Webview::with_webview(|w: PlatformWebview| ..)` (READ, `$R/tauri-2.12.5/src/webview/mod.rs:
  1857-1866`); on Linux `w.inner()` returns `webkit2gtk::WebView` (`mod.rs:177-179`). The runtime
  hands over `webview.webview()` (READ, `tauri-runtime-wry lib.rs:3891-3901`).
- Timing: the closure is dispatched with `send_user_message`, which runs it IMMEDIATELY when
  called on the main thread (READ, `tauri-runtime-wry lib.rs:263-273`), otherwise posts it to the
  event loop. The earliest call sites are a plugin's `on_webview_ready` (called from
  `attach_webview` through `run_on_main_thread`, `$R/tauri-2.12.5/src/manager/webview.rs:
  659-668`) and the app `setup` closure. Both run AFTER wry has created the web view and already
  called `load_uri` (section 1), but in the same main loop turn, so before GLib has dispatched
  anything for that load. INFERRED: the web process has not painted yet at that point; whether
  WebKit applies a policy change made then is the other agent's question.
- `WebViewExt::settings()` then `SettingsExt::set_hardware_acceleration_policy(policy)` IS bound
  (READ, `$R/webkit2gtk-2.0.2/src/auto/settings.rs:1796-1801`, gated `v2_16`). The enum
  `HardwareAccelerationPolicy` has `OnDemand`, `Always`, `Never` (+ `__Unknown`) (READ,
  `src/auto/enums.rs:1364-1379`, gated `v2_16`; sys constants 0/1/2 at
  `$R/webkit2gtk-sys-2.0.2/src/lib.rs:128-130`).
- `set_feature_enabled` / `Feature` / `FeatureList` (WebKitGTK 2.42 API) are NOT bound: the crate
  has no feature above `v2_40` (READ, `$R/webkit2gtk-2.0.2/Cargo.toml` `[features]`), and grep
  for `FeatureList|feature_enabled|WebKitFeature` in webkit2gtk and webkit2gtk-sys is empty.
  Reaching them would need hand written `extern "C"` declarations (INFERRED: the symbols are in
  the libwebkit2gtk-4.1 the app already links, if the runtime is 2.42 or newer).
- Feature set in the locked graph: wry asks `webkit2gtk` `v2_38` (`$R/wry-0.57.1/Cargo.toml:
  220-222`) and its `linux-body` feature adds `webkit2gtk/v2_40` (`:52-55`), enabled by
  tauri-runtime-wry (`Cargo.toml:96-101`); tauri, tauri-runtime and tauri-runtime-wry each ask
  `v2_40` (`tauri Cargo.toml:343-345`, `tauri-runtime:103-105`, `tauri-runtime-wry:111-113`). So
  the unified build has `v2_40`, which includes `v2_16`. The plugin declares
  `webkit2gtk = "2.0.2"` with no feature (READ, `plugins/tauri-plugin-player/Cargo.toml:17`) and
  gets the API through unification; declaring `features = ["v2_16"]` there would make it explicit.
  `src-tauri` has no direct `webkit2gtk` dependency (only `gtk`), and tauri does not re-export
  it (READ, grep `pub use` in tauri and tauri-runtime-wry: only `tao` and `wry`).
- Other settings reachable the same way and bound: `set_enable_accelerated_2d_canvas`
  (`settings.rs:1442`), `set_enable_webgl` (`:1746`), `set_draw_compositing_indicators` (`:1428`).

## 4. What the app does today

- Entry: `src-tauri/src/main.rs:4-6` calls `streamline_player_lib::run()`
  (`src-tauri/src/lib.rs:917-918`), which is `tauri::Builder::default().plugin(..)...run(ctx)`.
- Startup order (READ, `$R/tauri-2.12.5/src/app.rs`): `Builder::build` creates the runtime
  (`:2504-2511`, this is `gtk::init`), then `initialize_plugins` (`:2607`); `App::run` then, on
  `RuntimeRunEvent::Ready` (`:1442-1443`), runs `setup()` which FIRST creates the config windows
  (`:2691-2693`, web view created and `load_uri` called) and THEN the app `setup` closure
  (`:2696-2698`).
- Threads before the web view exists: the player plugin's `setup` runs in `initialize_plugins`
  and creates libmpv plus a `mpv-events` thread (READ,
  `plugins/tauri-plugin-player/src/lib.rs:28-32`, `desktop.rs:215-256`). INFERRED: libmpv has its
  own threads from then on, and `gtk::init` / `app.register` may have started GLib worker threads
  (gdbus, dconf, at-spi). So the process is multi-threaded from inside `Builder::build` onwards.
- Earliest point for an env var: the first line of `run()` (or `main`), before
  `tauri::Builder::default()`. Nothing in the app runs before it; INFERRED single-threaded there
  (no static constructors in the app; not checked for linked C libraries). That point is before
  GDK init, so no GTK based detection is possible there.
- The app `setup` closure touches GTK only for the `gtk-xft-dpi` workaround
  (`src-tauri/src/lib.rs:962-973`), after the web view exists.
- `with_webview`: one use, `plugins/tauri-plugin-player/src/desktop.rs:259-271` (`attach`,
  registered as `on_webview_ready` at `lib.rs:59`), which calls `view::attach(w.inner(), mpv)`.
- `view::attach` (`plugins/tauri-plugin-player/src/view.rs:183-229`): removes the web view from
  tao's vbox, puts a `gtk::Overlay` there with a `gtk::GLArea` as the base child and the web view
  as the overlay child; installs screen CSS `window, window.background, box, overlay
  { background: none; }` (`:209-220`); in debug builds sets
  `set_enable_write_console_messages_to_stdout(true)` (`:221-225`), the only WebKit setting the
  app touches.
- GL: libmpv renders into the GLArea's FBO through the mpv render API (`view.rs:88-180`),
  procs resolved with `eglGetProcAddress` from a directly linked libEGL (`view.rs:43-46`,
  "EGL only" comment at `:41-42`), Wayland display passed when present (`:76-86`, `:110-115`).
- Opaque unless playing (commit 582ec5f, READ `view.rs:231-240`): `see_through(on)` sets the web
  view background alpha to 0 while playing and 1 otherwise; called from `load`
  (`desktop.rs:371`) and `stop` (`desktop.rs:380`). The page side has `background: transparent`
  (`src/routes/+layout.svelte:101`, `src/lib/screens/Player.svelte:1380`).
- No env var is set by the app; the only reads are `EXPECT_VA_PROBE` in a test
  (`probe.rs:342`) and `COMPUTERNAME` (Windows). `WEBKIT_*` appears only in `dev/bench/`.
- The draft PR (`fork/perf/home-billboard-software:src-tauri/src/rendering.rs`, READ): creates a
  never shown `gtk::Window`, `realize()`, `window.create_gl_context()`, `make_current`, reads
  `epoxy_glGetString(GL_RENDERER)` through `#[link(name = "epoxy")]`, matches
  `llvmpipe|softpipe|swrast|swiftshader`, and runs from the app `setup` closure
  (`app.manage(rendering::detect())`), that is after the web view was created.

## 5. Detecting "software rasterizer" early enough

GL crates in `Cargo.lock` (READ): none of `khronos-egl`, `glutin`, `gl`, `epoxy`. Only
`gdkx11`, `gdkwayland-sys`, `x11`, `x11-dl`, `libloading`. libEGL is already linked by the plugin
(`view.rs:43`), libepoxy is a GTK 3 dependency (INFERRED: always present next to libgtk-3).

(a) Throwaway GdkGLContext before the Tauri window. Needs GDK initialised. Possible points:
    between `Builder::build()` and `App::run()` (split the current `.run(ctx)`), or a
    `gtk::init()` of our own at the top of `run()` (READ: `gtk::init` returns `Ok` when already
    initialised on the same thread, `$R/gtk-0.18.2/src/rt.rs:117-121`, so tao's later call is
    harmless). Pro: asks the very GL stack GTK and WebKit's UI process use; the PR code already
    does it. Con: by then threads exist (section 4), so pairing it with `std::env::set_var` is the
    unsafe case; fine if paired with (d) instead.
(b) EGL surfaceless / pbuffer without GTK. Pro: can run at the first line of `run()`,
    single-threaded, so `set_var` is sound. Con: no crate for it in the lock file, so raw FFI
    (eglGetPlatformDisplay, eglInitialize, eglChooseConfig, eglCreateContext, eglMakeCurrent,
    glGetString); INFERRED it can pick another device than the compositor display gives GTK
    (multi GPU, proprietary drivers, no surfaceless platform), so it can disagree with what
    WebKit really gets.
(c) Re-exec with the env var after detection. Pro: env is set before anything exists in the
    new process, no `set_var` race, uses the accurate GTK detection. Con: double startup, a
    second GTK init, breaks under debuggers and single instance / D-Bus activation
    (`gtk::Application::register` already ran with the app id), /proc/self/exe pitfalls in
    AppImage or Nix wrappers. Most invasive.
(d) Runtime setting through `with_webview`:
    `WebViewExt::settings(&w)` then
    `SettingsExt::set_hardware_acceleration_policy(HardwareAccelerationPolicy::Never)`.
    Pro: no env var, no `set_var`, per web view, main thread only, detection can stay the PR's
    GTK context (GDK is up, called from `on_webview_ready` or `setup`, before the main loop
    handles the first load). Con: it happens after `load_uri` was issued; depends on WebKit
    honouring the change at that time and on `Never` being equivalent to
    `WEBKIT_DISABLE_COMPOSITING_MODE=1` in the installed WebKitGTK (NOT verifiable from these
    crates; other agent). Fallback if a late change is ignored: none inside wry (no hook before
    `load_uri`), so it would have to be (a)+`set_var` or (c).

Most prudent: (d) with the PR's detection (a) moved before or into `on_webview_ready`,
provided the WebKit source confirms the late policy change. If it does not, (a) with a
`gtk::init()` and `set_var` at the top of `run()` is second (small real race with GLib threads),
(c) last.

mpv GLArea and a non-composited web view. READ: the web view is the overlay child above the
GLArea in ONE GtkWindow (`view.rs:189-206`); the window has no RGBA visual and needs none, since
the blend happens inside GTK's own drawing of the window, not in the desktop compositor. The app
DOES rely on the web view being transparent while playing (`see_through(true)`, alpha 0,
`view.rs:233-239`, `desktop.rs:371`). INFERRED: with compositing off WebKit paints its backing
store with cairo in the widget's draw, and a zero alpha background should let the GLArea show
through as it does today, but the existing comment (`view.rs:231-232`, "a see-through webview
makes GTK3 upload the whole window to GL on every frame") says this path is already the costly
one; whether the non-composited backing store keeps alpha must be checked in WebKit source or on
screen. Playback transparency under `Never` is the main thing to verify before shipping.
The GLArea itself keeps using GL (llvmpipe on such a machine) whatever the web view does.

## 6. Workarounds mentioned in wry

READ: `grep -ril 'llvmpipe|DISABLE_COMPOSITING|DMABUF|nvidia'` over the whole `$R/wry-0.57.1`
tree (source, CHANGELOG.md, README) returns nothing; "software rendering" has no hit either
(the only "software" match in CHANGELOG.md is a contributor name). Same greps over tao 0.37.2,
tauri-runtime-wry 2.12.3, tauri 2.12.5, tauri-runtime 2.12.2, tauri-utils 2.10.2: nothing.
So none of the locked crates carries a compositing, DMABUF or NVIDIA workaround; any such env
var seen in the wild comes from packaging (AppImage hooks, distro wrappers), not read here.
