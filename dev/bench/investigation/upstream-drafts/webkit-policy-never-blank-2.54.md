# [GTK] Blank view when the hardware acceleration policy is set to NEVER after the first load (2.54.3, works in 2.52.6)

Product: WebKit, component: WebKitGTK. GTK 3 (`webkit2gtk-4.1`).

## Summary

An application that calls `webkit_settings_set_hardware_acceleration_policy(settings, WEBKIT_HARDWARE_ACCELERATION_POLICY_NEVER)` on a web view after `webkit_web_view_load_uri()` gets a view that stays blank in 2.54.3. The same call switches the view to the non-composited path in 2.52.6. Embedders that do not create the view themselves can only reach its settings after the first load: wry (Tauri) calls `load_uri` in its constructor.

## Steps

1. Create a `WebKitWebView`, add it to a window, call `webkit_web_view_load_uri()`.
2. In the same main loop iteration, or later, set the hardware acceleration policy of `webkit_web_view_get_settings()` to `NEVER`.

Measured on X11 (Xvfb) with Mesa llvmpipe, no DRM render node, 2.54.3 from Arch Linux: the window stays blank (screenshots: `../shots/2.54.3-wry-never-home-idle.png`, against `../shots/2.54.3-wry-nodmabuf-home-idle.png` for the same page with `WEBKIT_DISABLE_DMABUF_RENDERER=1`). The page runs: its `requestAnimationFrame` callbacks fire at 60 Hz.

With 2.52.6 (Ubuntu 24.04), same steps: the page is drawn, non-composited.

Ending the web process and loading the page again after setting the policy (`webkit_web_view_terminate_web_process()`, then `webkit_web_view_load_uri()`) gives a drawn, non-composited page on both versions.

## Expected

Either the policy change takes effect, as in 2.52, or it is refused and the view keeps drawing. The documentation of `webkit_settings_set_hardware_acceleration_policy` does not say the policy must be set before the first load.

## Not verified

With a GPU, and on Wayland. The source of 2.54.2 suggests the renderer is chosen once per page when the page is created in the web process, which would make this independent of the GL implementation; that was read, not tested.
