//! Video under the page on Linux: the webview moves into a GtkOverlay whose bottom layer is a
//! GtkGLArea that libmpv draws into through its OpenGL render API. One window, one compositor
//! surface, so the page's controls and panels blend over the picture.

use crate::{
    mpv::{self, RenderParam},
    probe::{self, Display, Rect},
};
use gtk::{glib, prelude::*};
use std::{
    cell::{Cell, RefCell},
    ffi::{c_char, c_int, c_void},
    ptr,
    sync::Arc,
};
use webkit2gtk::WebViewExt;

const PARAM_END: c_int = 0;
const PARAM_API_TYPE: c_int = 1;
const PARAM_GL_INIT: c_int = 2;
const PARAM_GL_FBO: c_int = 3;
const PARAM_FLIP_Y: c_int = 4;
const PARAM_WL_DISPLAY: c_int = 9;
const PARAM_BLOCK_FOR_TARGET_TIME: c_int = 12;
const GL_FRAMEBUFFER_BINDING: u32 = 0x8CA6;

#[repr(C)]
struct GlInitParams {
    get_proc_address: unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void,
    ctx: *mut c_void,
}

#[repr(C)]
struct GlFbo {
    fbo: c_int,
    w: c_int,
    h: c_int,
    internal_format: c_int,
}

// ponytail: EGL only. GTK draws through EGL on Wayland; an X11 session (GLX) gets no video
// until a glXGetProcAddress path is added here.
#[link(name = "EGL")]
unsafe extern "C" {
    fn eglGetProcAddress(name: *const c_char) -> *mut c_void;
}

unsafe extern "C" {
    fn gdk_wayland_display_get_wl_display(display: *mut c_void) -> *mut c_void;
}

thread_local! {
    static AREA: RefCell<Option<gtk::GLArea>> = const { RefCell::new(None) };
    static WEBVIEW: RefCell<Option<webkit2gtk::WebView>> = const { RefCell::new(None) };
    static RENDER: Cell<*mut c_void> = const { Cell::new(ptr::null_mut()) };
    static PLAYER: RefCell<Option<Arc<mpv::Mpv>>> = const { RefCell::new(None) };
    static RECT: Cell<Option<Rect>> = const { Cell::new(None) };
    static LIFT: Cell<f64> = const { Cell::new(0.0) };
}

unsafe extern "C" fn proc_address(_: *mut c_void, name: *const c_char) -> *mut c_void {
    unsafe { eglGetProcAddress(name) }
}

// mpv calls this from its own threads; the GLArea belongs to the GTK one.
unsafe extern "C" fn on_update(_: *mut c_void) {
    glib::idle_add_once(|| {
        AREA.with(|a| {
            if let Some(a) = a.borrow().as_ref() {
                a.queue_render();
            }
        })
    });
}

fn wayland_display() -> *mut c_void {
    let Some(display) = gdk::Display::default() else {
        return ptr::null_mut();
    };
    if display.type_().name() != "GdkWaylandDisplay" {
        return ptr::null_mut();
    }
    use glib::translate::ToGlibPtr;
    let d: *mut gdk::ffi::GdkDisplay = display.to_glib_none().0;
    unsafe { gdk_wayland_display_get_wl_display(d.cast()) }
}

fn create_render_context(area: &gtk::GLArea, player: &mpv::Mpv) {
    area.make_current();
    if let Some(e) = area.error() {
        eprintln!("no GL context for the video: {e}");
        return;
    }
    let mut gl = GlInitParams {
        get_proc_address: proc_address,
        ctx: ptr::null_mut(),
    };
    // With the Wayland display, VA-API frames reach GL as dmabufs instead of being copied back.
    let wl = wayland_display();
    let mut params = vec![
        RenderParam {
            kind: PARAM_API_TYPE,
            data: c"opengl".as_ptr() as *mut c_void,
        },
        RenderParam {
            kind: PARAM_GL_INIT,
            data: (&raw mut gl).cast(),
        },
    ];
    if !wl.is_null() {
        params.push(RenderParam {
            kind: PARAM_WL_DISPLAY,
            data: wl,
        });
    }
    params.push(RenderParam {
        kind: PARAM_END,
        data: ptr::null_mut(),
    });
    let mut ctx = ptr::null_mut();
    let err =
        unsafe { mpv::mpv_render_context_create(&mut ctx, player.raw(), params.as_mut_ptr()) };
    if err < 0 {
        eprintln!("mpv render context failed: {err}");
        return;
    }
    unsafe { mpv::mpv_render_context_set_update_callback(ctx, Some(on_update), ptr::null_mut()) };
    RENDER.with(|r| r.set(ctx));
}

// The render context holds GL objects, so it goes before GTK drops the GL context.
fn free_render_context(area: &gtk::GLArea) {
    let ctx = RENDER.with(|r| r.replace(ptr::null_mut()));
    if !ctx.is_null() {
        area.make_current();
        unsafe { mpv::mpv_render_context_free(ctx) };
    }
}

fn render(area: &gtk::GLArea) -> glib::Propagation {
    let ctx = RENDER.with(Cell::get);
    if ctx.is_null() {
        return glib::Propagation::Stop;
    }
    let get_integer: unsafe extern "C" fn(u32, *mut c_int) =
        unsafe { std::mem::transmute(eglGetProcAddress(c"glGetIntegerv".as_ptr())) };
    let mut fbo = 0;
    unsafe { get_integer(GL_FRAMEBUFFER_BINDING, &mut fbo) };
    let scale = area.scale_factor();
    let mut target = GlFbo {
        fbo,
        w: area.allocated_width() * scale,
        h: area.allocated_height() * scale,
        internal_format: 0,
    };
    let mut flip: c_int = 1;
    // GTK also redraws the area whenever the page above it repaints. mpv would hold each of
    // those redraws until the video frame's display time, stalling the page for frames on end.
    let mut block: c_int = 0;
    let mut params = [
        RenderParam {
            kind: PARAM_GL_FBO,
            data: (&raw mut target).cast(),
        },
        RenderParam {
            kind: PARAM_FLIP_Y,
            data: (&raw mut flip).cast(),
        },
        RenderParam {
            kind: PARAM_BLOCK_FOR_TARGET_TIME,
            data: (&raw mut block).cast(),
        },
        RenderParam {
            kind: PARAM_END,
            data: ptr::null_mut(),
        },
    ];
    unsafe { mpv::mpv_render_context_render(ctx, params.as_mut_ptr()) };
    glib::Propagation::Stop
}

/// Puts the GL area under `webview`, hidden until something plays (`see_through`). Runs on the
/// GTK thread.
pub fn attach(webview: webkit2gtk::WebView, player: Arc<mpv::Mpv>) {
    let Some(parent) = webview.parent().and_downcast::<gtk::Container>() else {
        eprintln!("the webview has no container; no video layer");
        return;
    };
    parent.remove(&webview);
    let overlay = gtk::Overlay::new();
    let area = gtk::GLArea::new();
    PLAYER.with(|p| *p.borrow_mut() = Some(player.clone()));
    area.connect_resize(|_, _, _| apply_layout());
    area.connect_realize(move |a| {
        create_render_context(a, &player);
        if let Some(hz) = refresh_rate(a) {
            let _ = player.set("display-fps-override", &hz.to_string());
        }
    });
    area.connect_unrealize(free_render_context);
    area.connect_render(|a, _| render(a));
    overlay.add(&area);
    overlay.add_overlay(&webview);
    match parent.downcast_ref::<gtk::Box>() {
        Some(b) => b.pack_start(&overlay, true, true, 0),
        None => parent.add(&overlay),
    }
    // GTK3 paints a window in software before GL goes over it, so every background it fills is
    // a full-window fill per frame. The page and the picture cover all of it.
    let css = gtk::CssProvider::new();
    if css
        .load_from_data(b"window, window.background, box, overlay { background: none; }")
        .is_ok()
        && let Some(screen) = gdk::Screen::default()
    {
        gtk::StyleContext::add_provider_for_screen(
            &screen,
            &css,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
    }
    #[cfg(debug_assertions)]
    if let Some(settings) = WebViewExt::settings(&webview) {
        use webkit2gtk::SettingsExt;
        settings.set_enable_write_console_messages_to_stdout(true);
    }
    // Once GTK3 has drawn a GL area in a window, it draws that whole window through OpenGL for
    // every frame, and goes on after the area is hidden. A window that never played has none.
    area.set_no_show_all(true);
    overlay.show_all();
    AREA.with(|a| *a.borrow_mut() = Some(area));
    WEBVIEW.with(|w| *w.borrow_mut() = Some(webview));
}

/// Shows the picture and lets it through the page, or takes both back. A see-through webview
/// makes GTK3 upload the whole window to GL on every frame, and a GL area on show has GTK3 draw
/// it on every frame: while nothing plays the page is opaque and the area hidden. The area's
/// first show is what realizes it, which is when mpv gets its render context.
pub fn see_through(on: bool) {
    AREA.with(|a| {
        if let Some(a) = a.borrow().as_ref() {
            a.set_visible(on);
        }
    });
    WEBVIEW.with(|w| {
        if let Some(w) = w.borrow().as_ref() {
            let alpha = if on { 0.0 } else { 1.0 };
            w.set_background_color(&gdk::RGBA::new(0.0, 0.0, 0.0, alpha));
        }
    });
}

pub fn refresh_rate(widget: &impl IsA<gtk::Widget>) -> Option<f64> {
    let window = widget
        .as_ref()
        .window()
        .or_else(|| widget.as_ref().toplevel()?.window())?;
    let monitor = window.display().monitor_at_window(&window)?;
    let mhz = monitor.refresh_rate();
    (mhz > 0).then(|| f64::from(mhz) / 1000.0)
}

/// Runs `f` on the GTK thread and waits for it. Tauri runs a plain command there already, where
/// this is a direct call; an async one hops over.
pub fn on_gtk<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = std::sync::mpsc::channel();
    glib::MainContext::default().invoke(move || {
        let _ = tx.send(f());
    });
    rx.recv_timeout(std::time::Duration::from_secs(2)).ok()
}

/// Puts the picture in `rect`, or back over the whole window.
pub fn place(rect: Option<Rect>) {
    RECT.with(|r| r.set(rect));
    apply_layout();
}

/// Raises subtitles `px` CSS pixels above where mpv puts them.
pub fn lift(px: f64) {
    LIFT.with(|l| l.set(px));
    apply_lift();
}

fn area_size() -> Option<(f64, f64, f64)> {
    AREA.with(|a| {
        a.borrow().as_ref().map(|a| {
            (
                f64::from(a.allocated_width()),
                f64::from(a.allocated_height()),
                f64::from(a.scale_factor()),
            )
        })
    })
}

// The margins are ratios and a lift is in the window's own pixels, so both follow a resize.
fn apply_layout() {
    let Some(player) = PLAYER.with(|p| p.borrow().clone()) else {
        return;
    };
    let Some((width, height, _)) = area_size() else {
        return;
    };
    let ratios = probe::margin_ratios(RECT.with(Cell::get), width, height);
    for (side, ratio) in ["left", "right", "top", "bottom"].iter().zip(ratios) {
        let _ = player.set(&format!("video-margin-ratio-{side}"), &ratio.to_string());
    }
    apply_lift();
}

fn apply_lift() {
    let Some(player) = PLAYER.with(|p| p.borrow().clone()) else {
        return;
    };
    let Some((_, height, scale)) = area_size() else {
        return;
    };
    let margin = probe::sub_margin_y(LIFT.with(Cell::get), scale, height * scale);
    // Off the GTK thread: mpv answers a property write between two frames, and waiting for it
    // here stalls the page just as the controls start to fade.
    std::thread::spawn(move || {
        // mpv takes whole pixels here and refuses a fraction.
        let _ = player.set("sub-margin-y", &(margin.round() as i64).to_string());
    });
}

/// The monitor the window is on, in device pixels.
pub fn display() -> Display {
    let area = AREA.with(|a| a.borrow().clone());
    let monitor = area
        .as_ref()
        .and_then(|a| {
            let window = a.window().or_else(|| a.toplevel()?.window())?;
            a.display().monitor_at_window(&window)
        })
        .or_else(|| gdk::Display::default()?.primary_monitor());
    let Some(m) = monitor else {
        return Display::default();
    };
    let g = m.geometry();
    let scale = m.scale_factor();
    Display {
        name: m.model().map(|s| s.to_string()).unwrap_or_default(),
        width: (g.width() * scale).max(0) as u32,
        height: (g.height() * scale).max(0) as u32,
        refresh_hz: f64::from(m.refresh_rate()) / 1000.0,
    }
}
