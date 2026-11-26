# Tauri: the Linux graphics workaround reverses in WebKitGTK 2.54, and there is no way to configure the web view before it loads

Two things, for the "Linux Graphics Issues" documentation page and for wry. Related: tauri-apps/tauri#14424 (hardware acceleration policy), tauri-apps/tauri#15936 (blank window under software GL).

## 1. `WEBKIT_DISABLE_COMPOSITING_MODE=1` helps up to 2.52 and hurts from 2.54

Measured without a GPU (Mesa llvmpipe, X11, 4 CPUs, a 1440×900 window), CPU of the app's processes in % of one core, on a page with a full-window animation:

| | WebKitGTK 2.52.6 | WebKitGTK 2.54.3 |
|---|---|---|
| nothing set | 269 % | 217 % |
| `WEBKIT_DISABLE_COMPOSITING_MODE=1` | 106 % | 252 % |
| `WEBKIT_DISABLE_DMABUF_RENDERER=1` | 106 % | 103 % |

On Wayland (headless Weston) with 2.54.3: 237 %, 274 % and 106 %.

Scrolling the same page: 26, 52 and 50 fps on 2.52.6; 35, 16 and 45 fps on 2.54.3.

In 2.54 the first variable turns compositing off and keeps OpenGL for painting, so on a software rasterizer the page is still drawn through llvmpipe and read back; the second leaves no buffer type to hand to the UI process and lands on the path that paints with Skia on the CPU, in both versions. On a machine without a GPU, `WEBKIT_DISABLE_DMABUF_RENDERER=1` is the one that is safe on both. With a GPU neither should be set: compositing is the cheaper path there (measured on a Radeon 780M with 2.54.2: 24 % composited, 36 % with compositing off).

## 2. The hardware acceleration policy cannot be set early enough

The advice in #14424 is to call `with_webview` and set the policy with webkit2gtk's `SettingsExt::set_hardware_acceleration_policy`. That runs after wry has created the web view and called `load_uri` (`wry/src/webkitgtk/mod.rs`, in `new_gtk`).

- WebKitGTK 2.52.6: the late call works, the view switches to the non-composited path.
- WebKitGTK 2.54.3: the view goes blank and stays blank.

The same timing problem applies to WebKit's runtime features (`webkit_settings_set_feature_enabled`): the web process reads some of them once, when it creates the page, so a feature set after `load_uri` has no effect until the web process is restarted.

What would fix both: a hook in wry's Linux builder that runs on the `WebKitSettings` (or on the `WebView`) after they are created and before `load_uri`, for instance `WebViewBuilderExtUnix::with_settings(|settings| …)`, or at least a `hardware_acceleration_policy` attribute, and the matching option in Tauri's window configuration.

Until then an application has two ways: the environment variable above, set before the first web view exists, or setting the policy, ending the web process (`terminate_web_process`) and loading the page again.
