// A plain-browser stand-in for Tauri: the Rust commands go to the mock through bridge.py, and the
// player plugin is a fake that reports playback without decoding anything.
(() => {
  const B = "http://127.0.0.1:8099";
  const cbs = new Map();
  let next = 1;
  const listeners = {};
  const evListeners = {};
  const send = (event, payload) => (listeners[event] || []).forEach((l) => cbs.get(l.id)?.({ message: payload, index: l.i++ }));
  const call = async (method, path, body) => {
    const r = await fetch(B + "/extensions/player" + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    const v = text ? JSON.parse(text) : null;
    if (!r.ok) throw JSON.stringify(v);
    return v;
  };
  const caps = { video: ["h264", "hevc", "av1"].map((codec) => ({ codec, profiles: codec === "h264" ? ["baseline", "constrained baseline", "main", "high", "high 10"] : codec === "hevc" ? ["main", "main 10"] : ["main"], max_level: null, max_width: 3840, max_height: 2160, max_fps: 60 })), hdr: { formats: ["hdr10", "hdr10plus", "hlg"], dv_profiles: [] }, audio: { codecs: ["aac", "ac3", "dts", "eac3", "flac", "mp3", "opus", "truehd", "vorbis"], max_channels: 8, passthrough: [] }, containers: ["mp4", "mkv"], subtitles: ["webvtt", "srt", "ass", "pgs"], hls_keyframe_exact: false };
  const p = { pos: 0, dur: 0, playing: false, timer: 0, speed: 1 };
  const tickOn = () => {
    clearInterval(p.timer);
    p.timer = setInterval(() => {
      if (!p.playing || !window.__fakeTick) return;
      p.pos = Math.min(p.dur, p.pos + 0.5 * p.speed);
      send("position", { position: p.pos, buffered: Math.min(p.dur, p.pos + 30), duration: p.dur });
      if (p.pos >= p.dur) { p.playing = false; send("state", { state: "ended" }); }
    }, 500);
  };
  window.__fake = { p, send, tickOn };
  // window.__picture = true: a stand-in for the video the real player draws under the page.
  const picture = (rect) => {
    if (!window.__picture) return;
    let el = document.getElementById("__fake-picture");
    if (!el) {
      el = document.createElement("div");
      el.id = "__fake-picture";
      document.documentElement.appendChild(el);
    }
    const box = !rect || rect.full ? "inset:0" : `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;
    el.style.cssText = `position:fixed;${box};z-index:-1;background:radial-gradient(circle at 30% 35%,#3a4766,#12151f 70%)`;
  };
  const plugin = {
    capabilities: () => caps,
    register_listener: ({ event, handler }) => { (listeners[event] ||= []).push({ id: typeof handler === "object" ? handler.id : Number(String(handler).split(":")[1]), i: 0 }); },
    remove_listener: ({ event, channelId }) => { listeners[event] = (listeners[event] || []).filter((l) => l.id !== channelId); },
    load: async ({ url, at }) => { (window.__fake.loads ||= []).push({ url, at }); picture(window.__fake.viewport); p.pos = 0; p.dur = window.__fakeDuration || 5400; send("state", { state: "buffering" }); await new Promise((r) => setTimeout(r, 300)); send("state", { state: "paused" }); send("position", { position: 0, buffered: 30, duration: p.dur }); },
    play: () => { p.playing = true; send("state", { state: "playing" }); tickOn(); },
    pause: () => { p.playing = false; send("state", { state: "paused" }); },
    seek: ({ seconds }) => { p.pos = seconds; send("position", { position: p.pos, buffered: p.pos + 30, duration: p.dur }); },
    speed: ({ speed }) => { p.speed = speed; },
    stop: () => { p.playing = false; clearInterval(p.timer); send("state", { state: "idle" }); document.getElementById("__fake-picture")?.remove(); },
    stats: () => ({ player: "fake · browser", version: "fake", buffer: 30, videoBitrate: 8e6, audioBitrate: 6.4e5, rendered: Math.round(p.pos * 24), dropped: 0, displayHz: 60, width: 3840, height: 2160 }),
    subtitle: () => null,
    timing: (a) => { window.__fake.timing = a; return null; },
    voice: () => ({ text: "" }),
    frameRate: () => null,
    restoreDisplay: () => null,
    volume: ({ volume, muted }) => { window.__fake.volume = { volume, muted }; send("volume", { volume, muted }); },
    subtitleLift: (args) => { window.__fake.lift = args; },
    viewport: (rect) => { window.__fake.viewport = rect; if (document.getElementById("__fake-picture")) picture(rect); },
    deviceInfo: () => ({ name: "Living room", model: "Ugoos AM9 Pro", platform: "Android TV", player: "ExoPlayer 1.8.0", display: { name: "HDMI", width: 3840, height: 2160, refresh_hz: 60, hdr: ["HDR10", "HLG", "Dolby Vision"] }, ...(window.__deviceInfo || {}) }),
  };
  // window.__shim.downloads: a fake of the desktop's download queue, driven by the scenarios.
  const dl = { items: [], rate: 0, storage: { used: 0, other: 0, free: 0 }, reachable: true, log: [] };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const emitDownloads = () => (evListeners.downloads || []).forEach((id) => cbs.get(id)?.({ event: "downloads", id, payload: { items: clone(dl.items), rate: dl.rate } }));
  const dlSet = (key, apply) => { const e = dl.items.find((i) => i.key === key); if (e) { apply(e); emitDownloads(); } };
  window.__shim = {
    downloads: {
      seed: (entries, rate = 0) => { dl.items = clone(entries); dl.rate = rate; emitDownloads(); },
      advance: (bytes, rate = 8e6) => {
        const e = dl.items.find((i) => ["queued", "preparing", "downloading", "waiting"].includes(i.state));
        if (!e) return;
        e.state = "downloading";
        e.bytes = Math.min(e.size, e.bytes + bytes);
        e.progress = e.bytes / e.size;
        dl.rate = rate;
        if (e.bytes >= e.size) {
          e.state = "done"; e.progress = 1; dl.rate = 0;
          const next = dl.items.find((i) => i.state === "queued");
          if (next) next.state = "downloading";
        }
        emitDownloads();
      },
      fail: (key, code) => {
        dlSet(key, (e) => { e.state = "failed"; e.error = code; dl.rate = 0; });
        const next = dl.items.find((i) => i.state === "queued");
        if (next && !dl.items.some((i) => i.state === "downloading")) { next.state = "downloading"; emitDownloads(); }
      },
      storage: (used, other, free) => { dl.storage = { used, other, free }; },
      reach: (on) => { dl.reachable = !!on; },
      log: dl.log,
      get items() { return clone(dl.items); },
    },
  };
  const kp = (k) => (k === "movies" ? "/movies" : "/series");
  // __holdStart parks start_session until __releaseStart(), to press Back while it is in flight.
  const startSession = ({ mediaId, capabilities, position, tracks }) => window.__failStart ? Promise.reject(window.__failStart) : call("POST", "/playback/sessions", { media_id: mediaId, capabilities, position, ...(tracks || {}) });
  const fakePairStart = () => {
    const code = "K7F-Q2M", uri = "https://streamline.home.arpa/pair";
    const q = window.qrcode(0, "M"); q.addData(`${uri}?code=${code}`); q.make();
    return { code, name: "Living room · SHIELD", uri, uri_complete: `${uri}?code=${code}`, expires_in: 600, interval: 1, qr: q.createSvgTag({ cellSize: 8, margin: 0 }) };
  };
  // sign_in stands in for the browser round trip: __signInFail names the error it ends with, else it keeps a key.
  const signIn = () => new Promise((resolve, reject) => setTimeout(() => {
    (window.__opened ||= []).push("https://streamline.home.arpa/extensions/player/authorize");
    if (window.__signInFail) return reject(window.__signInFail);
    window.__auth = { ...(window.__auth || {}), paired: true };
    resolve({ name: "framework-13" });
  }, window.__signInMs ?? 1200));
  const cmds = {
    server_host: () => "127.0.0.1:8081",
    software_rendering: () => window.__softwareRendering === true,
    auth_state: () => ({ server: null, paired: true, keystore: "Android Keystore", ...(window.__auth || {}) }),
    connect: ({ url }) => (/bad/.test(url) ? Promise.reject(`Can’t reach ${url}`) : new Promise((r) => setTimeout(() => r(38), 600))),
    pair_start: () => fakePairStart(),
    sign_in: signIn,
    auth_methods: () => ({ register_url: null }),
    open_external: ({ url }) => { (window.__opened ||= []).push(url); return null; },
    pair_poll: () => window.__pairAnswer || "pending",
    sign_out: () => { window.__auth = { ...(window.__auth || {}), paired: false }; return null; },
    "plugin:event|listen": ({ event, handler }) => { (evListeners[event] ||= []).push(handler); return handler; },
    "plugin:event|unlisten": ({ event, eventId }) => { evListeners[event] = (evListeners[event] || []).filter((h) => h !== eventId); return null; },
    library: ({ kind }) => call("GET", kp(kind)),
    title: ({ kind, id }) => call("GET", `${kp(kind)}/${id}`),
    person: ({ id }) => call("GET", `/people/${id}`),
    watch_state: () => call("GET", "/watchstate"),
    set_watched: ({ mediaId, watched }) => call("PUT", `/watchstate/${mediaId}`, { watched }),
    me: () => call("GET", "/me"),
    home: () => call("GET", "/home"),
    set_picture: (bytes, options) => fetch(`${B}/extensions/player/me/picture`, { method: "PUT", headers: { "Content-Type": options.headers["x-picture-type"] }, body: bytes }).then(async (r) => { if (!r.ok) throw await r.text(); return null; }),
    remove_picture: () => call("DELETE", "/me/picture"),
    revoke_device: ({ id }) => call("DELETE", `/devices/${encodeURIComponent(id)}`),
    devices: () => call("GET", "/devices"),
    activity: () => call("GET", "/activity"),
    activity_read: ({ ids }) => call("POST", "/activity/read", { ids }),
    admin_overview: () => call("GET", "/admin/overview"),
    admin_settings: () => call("GET", "/admin/settings"),
    save_admin_settings: ({ patch }) => call("PATCH", "/admin/settings", patch),
    admin_restart: ({ message }) => call("POST", "/admin/restart", message === undefined ? {} : { message }),
    admin_streams: () => call("GET", "/admin/streams"),
    stop_stream: ({ id, message }) => call("POST", `/admin/streams/${encodeURIComponent(id)}/stop`, message === undefined ? {} : { message }),
    admin_pairings: () => call("GET", "/admin/pairings"),
    admin_devices: () => call("GET", "/admin/devices"),
    admin_users: () => call("GET", "/admin/users"),
    admin_resolve_pairing: ({ code, approve, userId }) => call("POST", `/admin/pairings/${encodeURIComponent(code)}/${approve ? "approve" : "deny"}`, approve ? { user_id: userId } : undefined),
    admin_revoke_device: ({ id }) => call("DELETE", `/admin/devices/${encodeURIComponent(id)}`),
    admin_library: () => call("GET", "/admin/library"),
    admin_scan: ({ folderId }) => call("POST", "/admin/library/scan", folderId === undefined ? {} : { folder_id: folderId }),
    admin_clear_cache: () => call("POST", "/admin/cache/clear"),
    playback_status: () => call("GET", "/playback/status"),
    start_session: (a) => window.__holdStart ? new Promise((r) => { window.__releaseStart = r; }).then(() => startSession(a)) : startSession(a),
    decisions: ({ mediaId, capabilities, options }) => call("POST", "/playback/decisions", { media_id: mediaId, capabilities, options }),
    media_tracks: ({ mediaId }) => call("GET", `/playback/media/${mediaId}/tracks`).then((t) => { if (t?.duration) window.__fakeDuration = t.duration; return { ...t, ...(window.__tracks || {}), ...(localStorage.getItem("__noTrickplay") ? { trickplay: null } : {}) }; }),
    media_text: ({ url }) => /^fake:/.test(url) ? "WEBVTT\n\n00:00:01.000 --> 01:00:00.000\nHello there\n" : fetch(`${B}/raw/${url}`).then((r) => r.text()),
    patch_session: ({ id, changes }) => window.__failStart ? Promise.reject(window.__failStart) : call("PATCH", `/playback/sessions/${id}`, changes),
    session_info: ({ id }) => call("GET", `/playback/sessions/${id}`),
    stop_session: ({ id }) => call("DELETE", `/playback/sessions/${id}`).then(() => null),
    list_downloads: () => clone(dl.items),
    start_downloads: ({ items, capabilities }) => {
      dl.log.push({ call: "start", keys: items.map((i) => i.key), capabilities });
      for (const r of items) if (!dl.items.some((e) => e.key === r.key)) dl.items.push({ ...clone(r), state: "queued", progress: 0, bytes: 0, error: null, added_at: new Date().toISOString(), offline: null });
      emitDownloads();
      return null;
    },
    remove_downloads: ({ keys }) => { dl.log.push({ call: "remove", keys }); dl.items = dl.items.filter((e) => !keys.includes(e.key)); emitDownloads(); return null; },
    retry_download: ({ key }) => { dl.log.push({ call: "retry", key }); dlSet(key, (e) => { if (e.state === "failed") { e.state = "queued"; e.error = null; } }); return null; },
    download_storage: () => ({ ...dl.storage }),
    // window.__localUrl stands in for the file on disk; the mock is asked for tracks only while it is reachable.
    local_playback: async ({ key }) => {
      dl.log.push({ call: "local", key });
      const e = dl.items.find((i) => i.key === key && i.state === "done");
      if (!e) return null;
      const t = dl.reachable ? await call("GET", `/playback/media/${e.media_id}/tracks`).catch(() => ({})) : {};
      const saved = { preparing: false, container: "mkv", video: { codec: "h264", width: 1920, height: 1080 }, chapters: [], markers: { intro: null, credits: null }, audio: [{ index: 0, codec: "aac", channels: 2, language: "eng", default: true }], subtitles: [], fonts: [], trickplay: null };
      return { url: window.__localUrl || `/downloads/${key.replace(/:/g, "-")}/video.mkv`, tracks: { ...saved, ...t, ...(window.__tracks || {}) }, position: e.offline?.position || 0 };
    },
    note_offline: ({ key, position, done }) => { dl.log.push({ call: "note", key, position, done }); dlSet(key, (e) => { e.offline = { position, done, at: new Date().toISOString() }; if (done) e.watched = true; }); return null; },
    sync_offline: () => {
      dl.log.push({ call: "sync" });
      if (!dl.reachable) return 0;
      const noted = dl.items.filter((e) => e.offline);
      noted.forEach((e) => { e.offline = null; });
      if (noted.length) emitDownloads();
      return noted.length;
    },
    reachable: () => dl.reachable,
    heartbeat: ({ id, position, paused }) => call("POST", `/playback/sessions/${id}/progress`, { position, paused }).then(() => null),
  };

  window.__calls = [];
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback(cb, once) { const id = next++; cbs.set(id, (m) => { if (once) cbs.delete(id); cb(m); }); return id; },
    unregisterCallback(id) { cbs.delete(id); },
    convertFileSrc(path, proto) { return `${B}/${proto}/${path}`; },
    async invoke(cmd, args = {}, options) {
      window.__calls.push(cmd);
      if (cmd === "plugin:window|set_fullscreen") { window.__fake.fullscreen = !!args.value; return null; }
      if (cmd === "plugin:window|is_fullscreen") return !!window.__fake.fullscreen;
      if (cmd.startsWith("plugin:window|")) return null;
      if (cmd.startsWith("plugin:player|")) { const f = plugin[cmd.slice(14)]; if (!f) throw `no ${cmd}`; return f(args); }
      const f = cmds[cmd];
      if (!f) throw `unknown command ${cmd}`;
      return f(args, options);
    },
  };
})();
