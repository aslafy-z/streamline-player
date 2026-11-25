//! Whether the webview draws on the CPU. WebKitGTK names no renderer to the page (WebGL answers
//! "Apple GPU" on llvmpipe too), so the page asks here.

#[cfg(target_os = "linux")]
mod gl {
    use gtk::prelude::*;
    use std::ffi::{CStr, c_char};

    const GL_RENDERER: u32 = 0x1F01;
    /// Mesa's and Chromium's CPU rasterizers, as they name themselves in GL_RENDERER.
    const ON_CPU: [&str; 4] = ["llvmpipe", "softpipe", "swrast", "swiftshader"];

    // libepoxy is what GTK itself calls OpenGL through: its entry points are function pointers
    // that resolve on first use, for GLX and for EGL.
    #[link(name = "epoxy")]
    unsafe extern "C" {
        static epoxy_glGetString: unsafe extern "C" fn(u32) -> *const c_char;
    }

    /// The OpenGL renderer GTK gets on this display, from a context on a window never shown.
    /// GTK thread only.
    fn renderer() -> Option<String> {
        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.realize();
        let context = window.window()?.create_gl_context().ok()?;
        context.realize().ok()?;
        context.make_current();
        let name = unsafe { epoxy_glGetString(GL_RENDERER) };
        let name = (!name.is_null()).then(|| {
            unsafe { CStr::from_ptr(name) }
                .to_string_lossy()
                .into_owned()
        });
        gtk::gdk::GLContext::clear_current();
        unsafe { window.destroy() };
        name
    }

    pub fn on_cpu() -> bool {
        renderer().is_some_and(|name| {
            let name = name.to_lowercase();
            ON_CPU.iter().any(|cpu| name.contains(cpu))
        })
    }
}

/// Read once at startup, on the main thread.
pub struct OnCpu(pub bool);

pub fn detect() -> OnCpu {
    #[cfg(target_os = "linux")]
    return OnCpu(gl::on_cpu());
    #[cfg(not(target_os = "linux"))]
    OnCpu(false)
}

#[tauri::command]
pub fn software_rendering(on_cpu: tauri::State<'_, OnCpu>) -> bool {
    on_cpu.0
}
