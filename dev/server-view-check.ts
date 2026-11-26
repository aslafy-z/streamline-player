process.env.TZ = "UTC";
// node dev/server-view-check.ts
import { strictEqual as eq, deepStrictEqual as same, ok } from "node:assert";
import { must } from "./must.ts";
import {
	canRestart,
	commitNumber,
	commitText,
	pairUser,
	type AdminData,
	type Row,
	type Section,
	sections,
	status,
	type TextId,
	type Words,
} from "../src/lib/core/server-view.ts";
import type { Title } from "../src/lib/core/types.ts";

const now = new Date("2026-11-09T12:00:00Z");

const EN: Record<TextId, string> = {
	sec_overview: "Overview",
	sec_streams: "Now playing",
	sec_devices: "Devices",
	sec_transcoding: "Transcoding",
	sec_library: "Library",
	sec_engine: "Engine",
	sec_access: "Player access",
	sec_engine_intro: "Where the player reaches the engine.",
	sec_access_intro: "Where the web player lives.",
	sec_overview_intro: "What the engine runs.",
	sec_streams_intro: "Everyone watching right now.",
	sec_devices_intro: "TVs paired with this server.",
	sec_transcoding_intro: "When a player can’t decode a file.",
	sec_library_intro: "The folders the engine serves.",
	group_streaming: "Streaming",
	group_library: "Library",
	group_system: "System",
	cap_now: "Right now",
	cap_engine: "Engine",
	blk_build: "Versions",
	blk_restart: "Restart",
	blk_waiting: "Waiting for approval",
	blk_waiting_desc: "Check the code matches the one on the TV. Codes expire after 10 minutes.",
	blk_apps: "Apps and TVs",
	blk_browsers: "Browsers",
	blk_browsers_desc: "Signed in through Streamline from a web browser.",
	blk_hw: "Hardware acceleration",
	blk_live: "Live streams",
	blk_cache: "Cache",
	blk_cache_desc: "Converted segments are kept while a stream runs.",
	blk_folders: "Folders",
	blk_folders_desc: "A scan compares what Streamline holds with what the player has prepared.",
	blk_ready: "Getting files ready",
	blk_ready_desc: "After each import or scan, the engine prepares new files.",
	blk_kept: "Kept by Streamline",
	blk_connection: "Connection",
	blk_secret: "Shared secret",
	blk_secret_desc: "The engine only answers the player when its requests carry this secret.",
	blk_web: "Web player",
	blk_app_links: "Apps",
	blk_home: "Home network",
	act_restart_title: "Restart the engine",
	act_restart_desc: "Streams in progress stop for about 10 seconds.",
	act_restart: "Restart",
	act_cache_title: "Clear the cache",
	act_clear: "Clear",
	act_rotate_title: "Rotate the secret",
	act_rotate_desc: "Makes a new secret and shows it once.",
	act_rotate: "Rotate",
	btn_restart_now: "Restart now",
	btn_scan_all: "Scan all",
	btn_scan: "Scan",
	btn_scanning: "Scanning…",
	btn_revoke: "Revoke",
	btn_end: "End",
	btn_open: "Open in Streamline",
	btn_make_secret: "Make a secret",
	tile_streams: "Streams",
	tile_pairing: "Pairing",
	tile_library: "Library",
	tile_engine: "Engine",
	tile_connected: "Connected",
	tile_no_secret: "No secret",
	tile_needs_secret: "Playback is off until the engine has one",
	tile_engine_addr: "Engine address",
	tile_public_addr: "Public address",
	tile_players_stream: "Players stream from here",
	tile_waiting_secret: "Waiting for a secret",
	tile_cache: "Transcode cache",
	tile_nobody: "Nobody is watching",
	tile_no_requests: "No TV waiting",
	tile_nothing_kept: "Nothing kept",
	tile_empty: "Empty",
	tile_ffmpeg_missing: "ffmpeg not found",
	tile_engine_down: "Engine unreachable",
	health_ok: "All good",
	health_restart: "Restart needed",
	status_restarting: "Restarting…",
	hw_software: "Software encoding",
	hw_status_desc: "Checked with a short test encode after every change.",
	kv_version: "Player extension",
	kv_location: "Location",
	on_engine: "On the engine",
	kv_status: "Status",
	kv_ffmpeg: "ffmpeg",
	kv_analysis: "File analysis",
	kv_tonemap: "HDR tone mapping",
	kv_dovi: "Dolby Vision profile 7",
	kv_dovi_desc: "Turns profile 7 into 8.1.",
	kv_secret: "Secret",
	kv_secret_desc: "It is shown once, when it is made.",
	kv_last_scan: "Last scan",
	pill_off: "Off",
	pill_ready: "Ready",
	pill_not_ready: "Not ready",
	pill_found: "Found",
	pill_not_found: "Not found",
	pill_connected: "Connected",
	pill_no_secret: "No secret",
	pill_set: "Set",
	pill_this_device: "This device",
	pill_this_browser: "This browser",
	pill_new: "New",
	status_not_connected: "Not connected",
	note_no_secret: "No secret yet.",
	open_general: "General settings",
	open_general_desc: "Address, sign-in, users and metadata",
	open_logs: "Logs",
	open_logs_desc: "What Streamline and its extensions write",
	open_import: "Import settings",
	open_import_desc: "Where new files come from",
	note_nobody: "Nobody is watching right now.",
	note_no_apps: "No apps are paired.",
	note_no_browsers: "No browser sessions.",
	note_cache_cleared: "Cache cleared. Streams in progress rebuild what they need.",
	mode_copy: "Original",
	mode_audio: "Audio transcoded",
	mode_transcode: "Transcoding",
	net_home: "Home network",
	net_remote: "Remote",
	sent_as_is: "sent as-is",
	video_as_is: "video sent as-is",
	kind_browser: "browser",
	kind_tablet: "tablet",
	kind_phone: "phone",
	kind_tv: "TV",
	kind_desktop: "device",
	aside_streaming: "Streaming",
	ago_now: "Now",
	ago_yesterday: "Yesterday",
	vaapi: "VAAPI",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const LABELS: Record<string, string> = {
	"transcoding.hw_accel": "Acceleration",
	"transcoding.hw_device": "Device",
	"stream.tonemap": "Convert HDR for SDR screens",
	"stream.max_live": "Conversions at once",
};
const DESCS: Record<string, string> = {
	"stream.max_live": "Players past this limit wait for a free slot.",
};
const CHOICES: Record<string, string> = {
	auto: "Auto",
	none: "Off",
	vaapi: "VAAPI",
};

const words: Words = {
	keptDesc: (host) => `Managed in Streamline, at ${host}.`,
	reachable: (v) => `Reachable · ${v}`,
	engineBuild: (v, api) => (api === undefined ? v : `${v} · API ${api}`),
	analysisVersion: (n) => `version ${n}`,
	secretSince: (date) => `Set ${date}`,
	pairWaiting: (device, code) => `${device} · code ${code}`,
	sumOverview: (version, ok) => `${version} · ${ok ? "all good" : "no engine secret"}`,
	sumStreams: (n, video, audio) =>
		n
			? `${plural(n, "stream")} · ${video} video · ${audio} audio transcoding`
			: "Nobody is watching",
	sumDevices: (n, waiting) =>
		`${plural(n, "device")} paired${waiting ? ` · ${waiting} waiting` : ""}`,
	sumTranscoding: (software, n) => `${software ? "Software" : "VAAPI"} · ${n} at once`,
	sumLibrary: (n, day) => plural(n, "folder") + (day ? ` · checked ${day}` : ""),
	sumEngine: (version) => `connected · ${version}`,
	sumAccess: (origins, networks) =>
		`${plural(origins, "web origin")} · ${plural(networks, "home network")}`,
	t: (id) => EN[id],
	label: (k) => LABELS[k] ?? k,
	desc: (k) => DESCS[k],
	choice: (_k, v) => CHOICES[v] ?? v,
	size: (n, unit) => `${n} ${unit}`,
	streamCount: (n) => plural(n, "stream"),
	appsDesc: (n) => `${plural(n, "device")}, each with its own key in the device’s secure storage.`,
	changeCount: (n) => plural(n, "change"),
	changesWaiting: (n) => `${plural(n, "change")} waiting`,
	restartNote: (n, keys) =>
		`${plural(n, "change")} only ${n === 1 ? "applies" : "apply"} after a restart: ${keys}.`,
	streamSummary: (v, a, m) => `${v} video · ${a} audio transcoding · ${m} out`,
	mbps: (n) => `${n} Mbps`,
	you: (name) => `${name} (you)`,
	cannotDecode: (kind, codec) => `this ${kind} can’t decode ${codec}`,
	realtime: (s) => `${s}× realtime`,
	runtime: (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`,
	healthSub: (f, soft) => `ffmpeg ${f} · ${soft ? "software encoding" : "VAAPI ready"}`,
	cacheUsed: (s, n) => `${s} used by ${plural(n, "stream")}.`,
	minutesAgo: (n) => `${n} min ago`,
	hoursAgo: (n) => `${n} h ago`,
	daysAgo: (n) => `${n} days ago`,
	expiresIn: (n) => `expires in ${plural(n, "day")}`,
	folderCount: (kind, n) => (kind === "movies" ? plural(n, "movie") : plural(n, "show")),
	scanProgress: (p, left) => (left === null ? `${p}%` : `${p}% · ${left} left`),
	lastScan: (when, a, r, e) =>
		`${when} · ${plural(a, "new file")} · ${r} replaced · ${plural(e, "error")}`,
};

const titles: Record<string, Title> = {
	"series:1": {
		id: 1,
		title: "Severance",
		year: 2022,
		seasons: [
			{ number: 1, name: "Season 1", episodes: [] },
			{
				number: 2,
				name: "Season 2",
				episodes: [{ id: 24, number: 4, title: "Woe’s Hollow" }],
			},
		],
	} as unknown as Title,
	"movies:1": { id: 1, title: "Dune: Part Two", year: 2024, runtime: 166 } as Title,
	"series:4": {
		id: 4,
		title: "Arcane",
		year: 2021,
		seasons: [{ number: 2, name: "Season 2", episodes: [{ id: 42, number: 2, title: "Heavy" }] }],
	} as unknown as Title,
};
const find = (kind: string, id: number) => titles[`${kind}:${id}`];

const demo = (): AdminData => ({
	overview: {
		extension: { version: "0.1.0" },
		engine: {
			reachable: true,
			version: "0.4.2",
			api_version: 1,
			ffmpeg_version: "7.1",
			analysis_version: 1,
			hw: { mode: "vaapi", ready: true },
			libplacebo: true,
			dovi_tool: true,
		},
		storage: { cache: { size: 3200000000, streams: 3 } },
		folders: { reachable: 2, total: 2 },
		streamline_url: "https://streamline.home.arpa",
	},
	settings: {
		values: {
			"transcoding.hw_accel": "auto",
			"transcoding.hw_device": "/dev/dri/renderD128",
			"stream.tonemap": true,
			"stream.max_live": 2,
			"engine.url": "http://engine:8097",
			"engine.public_url": "https://engine.example.net",
			"player.url": "https://watch.example.net",
			"player.origins": ["https://watch.example.net"],
			"player.app_links": ["streamline://signin"],
			"network.home": ["192.168.1.0/24", "fd00::/8"],
		},
		owners: {
			"transcoding.hw_accel": "engine",
			"transcoding.hw_device": "engine",
			"stream.tonemap": "engine",
			"stream.max_live": "engine",
			"engine.url": "player",
			"engine.public_url": "player",
			"player.url": "player",
			"player.origins": "player",
			"player.app_links": "player",
			"network.home": "player",
		},
		read_only: { engine: false, player: false },
		pending: [],
		restart_keys: ["transcoding.hw_accel", "transcoding.hw_device"],
	},
	streams: [
		{
			id: "s1",
			user: { name: "Antoine Langlois", you: true },
			title: { kind: "series", id: 1 },
			season: 2,
			episode: 4,
			device: { name: "Living room · SHIELD", kind: "tv" },
			network: "home",
			position: 1872,
			duration: 2940,
			playing: true,
			mode: "copy",
			video: "HEVC Main10 Dolby Vision",
			audio: "EAC3 Atmos 5.1",
			bitrate: 15800000,
		},
		{
			id: "s2",
			user: { name: "Camille Roux", you: false },
			title: { kind: "movies", id: 1 },
			device: { name: "Chrome on Linux", kind: "browser" },
			network: "remote",
			position: 4364,
			duration: 9960,
			playing: true,
			mode: "transcode",
			from: "HEVC Main10 HDR10",
			to: "H.264 1080p SDR",
			hw: "VAAPI",
			speed: 2.1,
			cannot_decode: "HEVC",
			bitrate: 8000000,
		},
		{
			id: "s3",
			user: { name: "Hugo Bernard", you: false },
			title: { kind: "series", id: 4 },
			season: 2,
			episode: 2,
			device: { name: "Galaxy Tab S9", kind: "tablet" },
			network: "home",
			position: 1205,
			duration: 2460,
			playing: false,
			mode: "audio",
			from: "EAC3 5.1",
			to: "AAC 5.1",
			cannot_decode: "EAC3",
			bitrate: 6100000,
		},
	],
	pairings: [
		{
			user_code: "R4W-X9P",
			name: "iPad mini",
			platform: "iPadOS",
			created_at: "2026-11-09T11:58:00+00:00",
			expires_at: "2026-11-09T12:08:00+00:00",
		},
	],
	devices: [
		{
			id: "dev-self",
			kind: "app",
			name: "Desktop · app",
			platform: "Linux",
			last_seen: "2026-11-09T12:00:00+00:00",
			streaming: false,
			current: true,
			user: { name: "Antoine Langlois" },
			key_store: "Secret Service",
		},
		{
			id: "d2",
			kind: "app",
			name: "Living room · SHIELD",
			platform: "Android TV",
			last_seen: "2026-11-09T12:00:00+00:00",
			streaming: true,
			current: false,
			user: { name: "Antoine Langlois" },
			key_store: "Android Keystore",
		},
		{
			id: "d5",
			kind: "app",
			name: "Pixel 9",
			platform: "Android",
			last_seen: "2026-11-06T12:00:00+00:00",
			streaming: false,
			current: false,
			user: { name: "Camille Roux" },
			key_store: "Android Keystore",
		},
		{
			id: "w1",
			kind: "browser",
			name: "Chrome on Linux",
			platform: "Web browser",
			last_seen: "2026-11-09T12:00:00+00:00",
			streaming: true,
			current: false,
			user: { name: "Camille Roux" },
			expires_at: "2026-11-15T12:00:00+00:00",
		},
		{
			id: "w2",
			kind: "browser",
			name: "Safari on macOS",
			platform: "Web browser",
			last_seen: "2026-11-04T12:00:00+00:00",
			streaming: false,
			current: false,
			user: { name: "Hugo Bernard" },
			expires_at: "2026-11-11T12:00:00+00:00",
		},
	],
	library: {
		folders: [
			{
				id: "movies",
				name: "Movies",
				path: "/media/movies",
				kind: "movies",
				count: 42,
				size: 1300000000000,
			},
			{
				id: "series",
				name: "Series",
				path: "/media/series",
				kind: "series",
				count: 28,
				size: 2200000000000,
			},
		],
		last_scan: { at: "2026-11-03T03:00:00+00:00", added: 4, replaced: 2, errors: 0 },
	},
	users: [
		{ id: 1, name: "Antoine Langlois", role: "Admin" },
		{ id: 2, name: "Camille Roux", role: "Member" },
		{ id: 3, name: "Hugo Bernard", role: "Member" },
	],
	secret: { set: true, created_at: "2026-11-16T09:00:00Z" },
	viewer: 1,
	cacheCleared: false,
	web: false,
	tick: 0,
});

const build = (d: AdminData = demo()) => sections(d, find, now, "en", words);
const section = (s: Section[], key: string) => must(s.find((x) => x.key === key));
const rows = (s: Section) => s.blocks.flatMap((b) => b.rows);
const titled = (s: Section, title: string) => must(s.blocks.find((b) => b.title === title));
const kinds = <T extends Row["t"]>(r: Row[], t: T) =>
	r.filter((x): x is Extract<Row, { t: T }> => x.t === t);
const setting = (s: Section[], key: string) =>
	s.flatMap(rows).find((r) => "key" in r && r.key === key) as Extract<Row, { key: string }>;
const hasRestart = (s: Section[]) => JSON.stringify(s).includes('"do":"restart"');

const all = build();
same(
	all.map((s) => s.title),
	["Overview", "Now playing", "Devices", "Transcoding", "Library", "Engine", "Player access"],
);
same(
	all.map((s) => s.group),
	["", "Streaming", "Streaming", "Streaming", "Library", "System", "System"],
);
eq(section(all, "streams").count, 3);
eq(
	all.map((x) => x.sum).join(" | "),
	"0.1.0 · all good | 3 streams · 1 video · 1 audio transcoding | 3 devices paired · 1 waiting | VAAPI · 2 at once | 2 folders · checked Tue | connected · 0.4.2 | 1 web origin · 2 home networks",
);
eq(section(all, "devices").badge, 1);
eq(section(all, "overview").badge, undefined);

const tiles = kinds(rows(section(all, "overview")), "tiles").flatMap((t) => t.tiles);
const tile = (label: string) => must(tiles.find((t) => t.label === label));
eq(tile("Streams").value, "3");
eq(tile("Streams").sub, "1 video · 1 audio transcoding · 29.9 Mbps out");
eq(tile("Pairing").value, "1");
eq(tile("Pairing").sub, "iPad mini · code R4W-X9P");
eq(tile("Library").value, "70");
eq(tile("Library").sub, "42 movies · 28 shows · 3.5 TB");
eq(tile("Library").go, "library");
eq(tile("Engine").value, "Connected");
eq(tile("Engine").sub, "ffmpeg 7.1 · VAAPI ready");
eq(tile("Engine").tone, "ok");
eq(tile("Engine").go, "engine");
eq(tile("Transcode cache").value, "3.2 GB");
eq(tile("Transcode cache").sub, "3 streams");
eq(tile("Transcode cache").go, "transcoding");
eq(tile("Engine address").mono, true);
eq(tile("Engine address").value, "http://engine:8097");
eq(tile("Engine address").sub, "Reachable · 0.4.2");
eq(tile("Public address").value, "https://engine.example.net");
eq(tile("Public address").sub, "Players stream from here");
eq(
	tiles.some((t) => ["Media storage", "Data directory", "Database", "Health"].includes(t.label)),
	false,
);

const versions = titled(section(all, "overview"), "Versions").rows as Extract<Row, { t: "kv" }>[];
same(
	versions.map((r) => [r.label, r.value, r.pill?.[0]]),
	[
		["Player extension", "0.1.0", undefined],
		["Engine", "0.4.2 · API 1", undefined],
		["ffmpeg", "7.1", undefined],
		["File analysis", "version 1", undefined],
		["HDR tone mapping", "libplacebo", "Ready"],
		["Dolby Vision profile 7", "dovi_tool", "Found"],
	],
);
const kept = titled(section(all, "overview"), "Kept by Streamline");
eq(kept.desc, "Managed in Streamline, at streamline.home.arpa.");
same(
	kinds(kept.rows, "item").map((r) => [r.title, r.buttons[0]?.act]),
	[
		["General settings", { do: "open", path: "/settings/general" }],
		["Logs", { do: "open", path: "/settings/logs" }],
	],
);
const noEngine = demo();
noEngine.overview.engine = { reachable: false };
noEngine.overview.storage = {};
const downOverview = section(build(noEngine), "overview");
same(
	(titled(downOverview, "Versions").rows as Extract<Row, { t: "kv" }>[]).map((r) => r.label),
	["Player extension"],
);
const downTiles = kinds(rows(downOverview), "tiles").flatMap((t) => t.tiles);
const downEngine = must(downTiles.find((t) => t.label === "Engine"));
same([downEngine.value, downEngine.tone], ["Engine unreachable", "err"]);
eq(must(downTiles.find((t) => t.label === "Engine address")).sub, "Engine unreachable");
eq(
	downTiles.some((t) => t.label === "Transcode cache"),
	false,
);
same(titled(section(build(noEngine), "transcoding"), "Cache").rows, [
	{ t: "kv", label: "Location", value: "On the engine" },
	{ t: "note", tone: "warn", text: "Engine unreachable" },
]);
const soft0 = build(noEngine);
eq(setting(soft0, "transcoding.hw_accel").value, "auto");
eq(setting(soft0, "stream.tonemap").value, true);
const emptyCache = demo();
must(emptyCache.overview.storage.cache).size = 0;
eq(
	must(
		kinds(rows(section(build(emptyCache), "overview")), "tiles")
			.flatMap((t) => t.tiles)
			.find((t) => t.label === "Transcode cache"),
	).value,
	"Empty",
);
const noSecret = demo();
noSecret.secret = { set: false };
const noSecretTiles = kinds(rows(section(build(noSecret), "overview")), "tiles").flatMap(
	(t) => t.tiles,
);
same(
	[
		must(noSecretTiles.find((t) => t.label === "Engine")).value,
		must(noSecretTiles.find((t) => t.label === "Engine")).tone,
	],
	["No secret", "warn"],
);
eq(must(noSecretTiles.find((t) => t.label === "Engine address")).sub, "Waiting for a secret");

const stream = (s: Section[], id: string) =>
	must(kinds(rows(section(s, "streams")), "stream").find((r) => r.id === id));
const sev = stream(all, "s1");
eq(sev.title, "Severance");
ok(sev.sub.startsWith("S2 E4 · "));
eq(sev.user, "Antoine Langlois (you)");
eq(sev.short, "Antoine");
eq(sev.mode, "Original");
eq(sev.tone, "ok");
eq(sev.path, "HEVC Main10 Dolby Vision · EAC3 Atmos 5.1 · sent as-is");
eq(sev.mbps, "15.8 Mbps");
eq(sev.time, "31:12 / 49:00");
eq(sev.where, "Home network");
eq(sev.poster, titles["series:1"]);
const dune = stream(all, "s2");
eq(dune.mode, "Transcoding");
eq(dune.tone, "warn");
eq(
	dune.path,
	"HEVC Main10 HDR10 → H.264 1080p SDR · VAAPI · 2.1× realtime · this browser can’t decode HEVC",
);
eq(dune.sub, "2024 · 2h 46m");
eq(dune.time, "1:12:44 / 2:46:00");
eq(dune.where, "Remote");
const arc = stream(all, "s3");
eq(arc.mode, "Audio transcoded");
eq(arc.tone, "accent");
ok(arc.path.endsWith("video sent as-is · this tablet can’t decode EAC3"));
eq(arc.playing, false);

const ticked = demo();
ticked.tick = 3;
eq(stream(build(ticked), "s1").time, "31:15 / 49:00");
eq(stream(build(ticked), "s3").time, "20:05 / 41:00");

const quiet = demo();
quiet.streams = [];
const quietAll = build(quiet);
const quietTile = must(
	kinds(rows(section(quietAll, "overview")), "tiles")
		.flatMap((t) => t.tiles)
		.find((t) => t.label === "Streams"),
);
eq(quietTile.value, "0");
eq(quietTile.sub, "Nobody is watching");
eq(quietTile.tone, "muted");
same(rows(section(quietAll, "streams")), [
	{ t: "note", tone: "muted", text: "Nobody is watching right now." },
]);

const devices = section(all, "devices");
eq(must(devices.blocks[0]).title, "Waiting for approval");
eq(must(devices.blocks[0]).desc, EN.blk_waiting_desc);
same(must(devices.blocks[0]).rows, [
	{
		t: "pair",
		code: "R4W-X9P",
		device: "iPad mini",
		icon: "tablet",
		sub: "iPadOS · 2 min ago",
		users: [
			{ id: 1, label: "Antoine (you)", on: true },
			{ id: 2, label: "Camille", on: false },
			{ id: 3, label: "Hugo", on: false },
		],
	},
]);
const picked = demo();
picked.pairFor = { "R4W-X9P": 3 };
same(
	(kinds(rows(section(build(picked), "devices")), "pair")[0]?.users ?? []).map((u) => u.on),
	[false, false, true],
);
eq(pairUser(picked, "R4W-X9P")?.name, "Hugo Bernard");
eq(pairUser(demo(), "R4W-X9P")?.name, "Antoine Langlois");
const stranger = demo();
stranger.viewer = 99;
eq(pairUser(stranger, "R4W-X9P")?.id, 1);
eq(pairUser({ ...demo(), users: [] }, "R4W-X9P"), undefined);
const twins = demo();
twins.users = [
	{ id: 2, name: "Alex Martin", role: "Member" },
	{ id: 5, name: "Alex Martin", role: "Admin" },
	{ id: 6, name: "Camille Roux", role: "Member" },
	{ id: 7, name: "Camille Martin", role: "Member" },
	{ id: 8, name: "Hugo Bernard", role: "Member" },
];
twins.viewer = 5;
eq(pairUser(twins, "R4W-X9P")?.id, 5);
same(
	(kinds(rows(section(build(twins), "devices")), "pair")[0]?.users ?? []).map((u) => u.label),
	["Alex Martin", "Alex Martin (you)", "Camille Roux", "Camille Martin", "Hugo"],
);
const noPair = demo();
noPair.pairings = [];
eq(must(section(build(noPair), "devices").blocks[0]).title, "Apps and TVs");
eq(section(build(noPair), "devices").badge, undefined);
eq(
	must(
		kinds(rows(section(build(noPair), "overview")), "tiles")
			.flatMap((t) => t.tiles)
			.find((t) => t.label === "Pairing"),
	).sub,
	"No TV waiting",
);

const apps = titled(devices, "Apps and TVs");
eq(apps.desc, "3 devices, each with its own key in the device’s secure storage.");
const item = (b: { rows: Row[] }, title: string) =>
	must(kinds(b.rows, "item").find((r) => r.title === title));
const pixel = item(apps, "Pixel 9");
eq(pixel.meta, "Android · Camille Roux · Android Keystore");
eq(pixel.aside, "3 days ago");
eq(pixel.icon, "smartphone");
same(pixel.buttons, [
	{ label: "Revoke", act: { do: "revoke", id: "d5" }, tone: "danger", disabled: false },
]);
const bare = demo();
delete must(bare.devices[2]).key_store;
eq(
	item(titled(section(build(bare), "devices"), "Apps and TVs"), "Pixel 9").meta,
	"Android · Camille Roux",
);
const shield = item(apps, "Living room · SHIELD");
eq(shield.aside, "Streaming");
eq(shield.asideTone, "ok");
eq(shield.icon, "tv");
const self = item(apps, "Desktop · app");
same(self.pills, [["This device", "accent"]]);
same(self.buttons, []);
const web = demo();
web.web = true;
must(web.devices[0]).kind = "browser";
const webSessions = titled(section(build(web), "devices"), "Browsers");
same(item(webSessions, "Desktop · app").pills, [["This browser", "accent"]]);

const sessions = titled(devices, "Browsers");
eq(sessions.desc, "Signed in through Streamline from a web browser.");
const safari = item(sessions, "Safari on macOS");
eq(safari.meta, "Hugo Bernard · expires in 2 days");
eq(safari.aside, "5 days ago");
eq(item(sessions, "Chrome on Linux").meta, "Camille Roux · expires in 6 days");
same(safari.buttons, [
	{ label: "End", act: { do: "end", id: "w2" }, tone: "danger", disabled: false },
]);

const empty = demo();
empty.devices = [];
const emptyDevices = section(build(empty), "devices");
same(titled(emptyDevices, "Apps and TVs").rows, [
	{ t: "note", tone: "muted", text: "No apps are paired." },
]);
same(titled(emptyDevices, "Browsers").rows, [
	{ t: "note", tone: "muted", text: "No browser sessions." },
]);

const tr = section(all, "transcoding");
const hwRows = titled(tr, "Hardware acceleration").rows;
const accel = setting(all, "transcoding.hw_accel");
same(accel.options, [
	["auto", "Auto"],
	["none", "Off"],
	["vaapi", "VAAPI"],
]);
eq(accel.value, "auto");
eq((hwRows[1] as { disabled: boolean }).disabled, false);
same(hwRows[2], {
	t: "kv",
	label: "Status",
	value: "VAAPI",
	pill: ["Ready", "ok"],
	desc: EN.hw_status_desc,
});
const soft = demo();
soft.settings.values["transcoding.hw_accel"] = "none";
const softAll = build(soft);
const softRows = titled(section(softAll, "transcoding"), "Hardware acceleration").rows;
eq((softRows[1] as { disabled: boolean }).disabled, true);
same(softRows[2], {
	t: "kv",
	label: "Status",
	value: "Software encoding",
	pill: ["Off", "muted"],
	desc: EN.hw_status_desc,
});
eq(
	must(
		kinds(rows(section(softAll, "overview")), "tiles")
			.flatMap((t) => t.tiles)
			.find((t) => t.label === "Engine"),
	).sub,
	"ffmpeg 7.1 · software encoding",
);
for (const patch of [{ ready: false }, { mode: "software" as const }]) {
	const d = demo();
	Object.assign(must(d.overview.engine.hw), patch);
	eq(
		must(
			kinds(rows(section(build(d), "overview")), "tiles")
				.flatMap((t) => t.tiles)
				.find((t) => t.label === "Engine"),
		).sub,
		"ffmpeg 7.1 · software encoding",
	);
}
const softMode = demo();
must(softMode.overview.engine.hw).mode = "software";
same(titled(section(build(softMode), "transcoding"), "Hardware acceleration").rows[2], {
	t: "kv",
	label: "Status",
	value: "Software encoding",
	pill: ["Ready", "ok"],
	desc: EN.hw_status_desc,
});
eq(setting(all, "stream.max_live").min, 1);
eq(setting(all, "stream.max_live").max, 8);
const cache = titled(tr, "Cache").rows;
eq((cache[1] as { desc: string }).desc, "3.2 GB used by 3 streams.");
const cleared = demo();
cleared.cacheCleared = true;
same(titled(section(build(cleared), "transcoding"), "Cache").rows[1], {
	t: "note",
	tone: "ok",
	text: EN.note_cache_cleared,
});

const lib = section(all, "library");
const folders = titled(lib, "Folders");
eq(folders.button?.label, "Scan all");
const movies = item(folders, "Movies");
eq(movies.meta, "/media/movies");
eq(movies.aside, "42 movies · 1.3 TB");
same(movies.buttons, [
	{ label: "Scan", act: { do: "scan", folder: "movies" }, tone: "ghost", disabled: false },
]);
eq(item(folders, "Series").aside, "28 shows · 2.2 TB");
same(folders.rows.at(-1), {
	t: "kv",
	label: "Last scan",
	value: "Tue 03:00 · 4 new files · 2 replaced · 0 errors",
});
const scanning = demo();
must(scanning.library.folders[0]).scan = { progress: 0.5, eta_seconds: 8 };
const scanned = item(titled(section(build(scanning), "library"), "Folders"), "Movies");
eq(must(scanned.buttons[0]).label, "Scanning…");
eq(must(scanned.buttons[0]).disabled, true);
eq(scanned.aside, "50% · 0:08 left");
eq(scanned.progress, 0.5);
eq(item(titled(section(build(scanning), "library"), "Folders"), "Series").progress, undefined);

eq(titled(lib, "Folders").desc, EN.blk_folders_desc);
const ready = titled(lib, "Getting files ready");
same(
	kinds(ready.rows, "item").map((r) => [r.title, r.buttons[0]?.act]),
	[["Import settings", { do: "open", path: "/settings/library" }]],
);

const engineSec = section(all, "engine");
const connection = titled(engineSec, "Connection");
const engineUrl = setting(all, "engine.url");
eq(engineUrl.t === "text" && engineUrl.wide, true);
eq(setting(all, "engine.public_url").t, "text");
same(connection.rows[2], {
	t: "kv",
	label: "Status",
	value: "Reachable · 0.4.2",
	pill: ["Connected", "ok"],
});
const secretBlock = titled(engineSec, "Shared secret");
same(secretBlock.rows[0], {
	t: "kv",
	label: "Secret",
	value: "Set 16 Nov 2026",
	pill: ["Set", "ok"],
	desc: EN.kv_secret_desc,
});
same(secretBlock.rows[1], {
	t: "action",
	label: "Rotate the secret",
	desc: EN.act_rotate_desc,
	button: "Rotate",
	act: { do: "secret" },
	tone: "danger",
});
const shown = demo();
shown.secretShown = "ab12";
same(titled(section(build(shown), "engine"), "Shared secret").rows, [
	{ t: "secret", value: "ab12" },
]);
same(titled(section(build(noSecret), "engine"), "Shared secret").rows, [
	{ t: "note", tone: "warn", text: "No secret yet.", button: ["Make a secret", { do: "secret" }] },
]);
same(titled(section(build(noEngine), "engine"), "Connection").rows[2], {
	t: "kv",
	label: "Status",
	value: "Not connected",
	pill: ["Engine unreachable", "err"],
});

const access = section(all, "access");
const origins = setting(all, "player.origins");
same(origins.t === "list" && origins.items, ["https://watch.example.net"]);
eq(setting(all, "player.url").t, "text");
same(
	access.blocks.map((b) => b.title),
	["Web player", "Apps", "Home network"],
);
const homes = setting(all, "network.home");
same(homes.t === "list" && homes.items, ["192.168.1.0/24", "fd00::/8"]);
const readOnlyPlayer = demo();
readOnlyPlayer.settings.read_only.player = true;
eq(setting(build(readOnlyPlayer), "player.app_links").locked, true);
const lacking = demo();
delete lacking.settings.values["network.home"];
const lackingHomes = setting(build(lacking), "network.home");
same(lackingHomes.t === "list" && lackingHomes.items, []);

for (const r of all.flatMap(rows)) if ("restart" in r) eq(r.restart, false);
eq(hasRestart(all), true);
const waiting = demo();
waiting.settings.pending = ["transcoding.hw_accel", "stream.tonemap"];
const waitAll = build(waiting);
eq(setting(waitAll, "transcoding.hw_accel").restart, true);
eq(setting(waitAll, "stream.tonemap").restart, true);
eq(setting(waitAll, "stream.max_live").restart, false);
const ov = section(waitAll, "overview");
same(must(ov.blocks[1]).rows, [
	{
		t: "note",
		tone: "warn",
		text: "2 changes only apply after a restart: transcoding.hw_accel, stream.tonemap.",
		button: ["Restart now", { do: "restart" }],
	},
]);
same(status(waiting, false, words), { label: "Restart needed", tone: "warn" });
same(status(waiting, true, words), { label: "Restarting…", tone: "warn" });
same(status(demo(), false, words), { label: "All good", tone: "ok" });
const one = demo();
one.settings.pending = ["stream.tonemap"];
eq(
	(must(section(build(one), "overview").blocks[1]).rows[0] as { text: string }).text,
	"1 change only applies after a restart: stream.tonemap.",
);

const locked = demo();
locked.settings.read_only.engine = true;
locked.settings.pending = ["stream.tonemap"];
const lockedAll = build(locked);
for (const key of [
	"transcoding.hw_accel",
	"transcoding.hw_device",
	"stream.tonemap",
	"stream.max_live",
])
	eq(setting(lockedAll, key).locked, true, key);
eq(canRestart(locked.settings), false);
eq(hasRestart(lockedAll), false);
eq(canRestart(demo().settings), true);
for (const r of build().flatMap(rows)) if ("locked" in r) eq(r.locked, false);

const during = sections(one, find, now, "en", words, true);
const duringNote = must(section(during, "overview").blocks[1]).rows[0] as {
	button: [string, unknown];
	disabled?: boolean;
};
same([duringNote.button[0], duringNote.disabled], ["Restarting…", true]);
const duringAct = must(kinds(rows(section(during, "overview")), "action")[0]);
same([duringAct.button, duringAct.disabled], ["Restarting…", true]);
const idleAct = must(kinds(rows(section(build(), "overview")), "action")[0]);
same([idleAct.button, idleAct.disabled], ["Restart", undefined]);

const approved = demo();
approved.fresh = [must(approved.devices.find((d) => !d.current && d.kind === "app")).name];
const freshRows = kinds(rows(section(build(approved), "devices")), "item").filter((r) =>
	r.pills.some((p) => p[0] === "New"),
);
eq(freshRows.length, 1);
eq(must(must(freshRows[0]).pills[0])[1], "ok");

eq(commitNumber("abc", 1, 8), null);
eq(commitNumber("999", 1, 8), 8);
eq(commitNumber("0", 1, 8), 1);
eq(commitNumber("2.6", 1, 8), 3);
eq(commitNumber("", 1, 8), null);
eq(commitText("  ", false), null);
eq(commitText("", true), "");
eq(commitText(" a ", false), "a");

console.log("server-view-check: ok");
