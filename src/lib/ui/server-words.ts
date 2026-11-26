import type { TextId, Words } from "#lib/core/server-view.ts";
import { m as i18n } from "#lib/paraglide/messages.js";

const TEXT: Record<TextId, () => string> = {
	sec_overview: i18n.server_sec_overview,
	sec_streams: i18n.server_sec_streams,
	sec_devices: i18n.server_sec_devices,
	sec_transcoding: i18n.server_sec_transcoding,
	sec_library: i18n.server_sec_library,
	sec_engine: i18n.server_sec_engine,
	sec_access: i18n.server_sec_access,
	sec_engine_intro: i18n.server_sec_engine_intro,
	sec_access_intro: i18n.server_sec_access_intro,
	sec_overview_intro: i18n.server_sec_overview_intro,
	sec_streams_intro: i18n.server_sec_streams_intro,
	sec_devices_intro: i18n.server_sec_devices_intro,
	sec_transcoding_intro: i18n.server_sec_transcoding_intro,
	sec_library_intro: i18n.server_sec_library_intro,
	group_streaming: i18n.server_group_streaming,
	group_library: i18n.server_sec_library,
	group_system: i18n.server_group_system,
	cap_now: i18n.server_cap_now,
	cap_engine: i18n.server_cap_engine,
	blk_build: i18n.server_blk_build,
	blk_restart: i18n.server_blk_restart,
	blk_waiting: i18n.server_blk_waiting,
	blk_waiting_desc: i18n.server_blk_waiting_desc,
	blk_apps: i18n.server_blk_apps,
	blk_browsers: i18n.server_blk_browsers,
	blk_browsers_desc: i18n.server_blk_browsers_desc,
	blk_hw: i18n.server_blk_hw,
	blk_live: i18n.server_blk_live,
	blk_cache: i18n.server_blk_cache,
	blk_cache_desc: i18n.server_blk_cache_desc,
	blk_folders: i18n.server_blk_folders,
	blk_folders_desc: i18n.server_blk_folders_desc,
	blk_ready: i18n.server_blk_ready,
	blk_ready_desc: i18n.server_blk_ready_desc,
	blk_kept: i18n.server_blk_kept,
	blk_connection: i18n.server_blk_connection,
	blk_secret: i18n.server_blk_secret,
	blk_secret_desc: i18n.server_blk_secret_desc,
	blk_web: i18n.server_blk_web,
	blk_app_links: i18n.server_blk_app_links,
	blk_home: i18n.server_blk_home,
	act_restart_title: i18n.server_act_restart_title,
	act_restart_desc: i18n.server_act_restart_desc,
	act_restart: i18n.server_act_restart,
	act_cache_title: i18n.server_act_cache_title,
	act_clear: i18n.keyboard_clear,
	act_rotate_title: i18n.server_act_rotate_title,
	act_rotate_desc: i18n.server_act_rotate_desc,
	act_rotate: i18n.server_act_rotate,
	btn_restart_now: i18n.server_btn_restart_now,
	btn_scan_all: i18n.server_btn_scan_all,
	btn_scan: i18n.server_btn_scan,
	btn_scanning: i18n.server_btn_scanning,
	btn_revoke: i18n.server_btn_revoke,
	btn_end: i18n.server_btn_end,
	btn_open: i18n.server_btn_open,
	btn_make_secret: i18n.server_btn_make_secret,
	tile_streams: i18n.server_tile_streams,
	tile_pairing: i18n.server_tile_pairing,
	tile_library: i18n.server_tile_library,
	tile_engine: i18n.server_cap_engine,
	tile_connected: i18n.server_tile_connected,
	tile_no_secret: i18n.server_tile_no_secret,
	tile_needs_secret: i18n.server_tile_needs_secret,
	tile_engine_addr: i18n.server_tile_engine_addr,
	tile_public_addr: i18n.server_tile_public_addr,
	tile_players_stream: i18n.server_tile_players_stream,
	tile_waiting_secret: i18n.server_tile_waiting_secret,
	tile_cache: i18n.server_tile_cache,
	tile_nobody: i18n.server_tile_nobody,
	tile_no_requests: i18n.server_tile_no_requests,
	tile_nothing_kept: i18n.server_tile_nothing_kept,
	tile_empty: i18n.server_tile_empty,
	tile_ffmpeg_missing: i18n.server_tile_ffmpeg_missing,
	tile_engine_down: i18n.server_tile_engine_down,
	health_ok: i18n.server_health_ok,
	health_restart: i18n.server_health_restart,
	status_restarting: i18n.server_status_restarting,
	hw_software: i18n.server_hw_software,
	hw_status_desc: i18n.server_hw_status_desc,
	kv_version: i18n.server_kv_version,
	kv_location: i18n.server_kv_location,
	on_engine: i18n.server_on_engine,
	kv_status: i18n.server_kv_status,
	kv_ffmpeg: i18n.server_kv_ffmpeg,
	kv_analysis: i18n.server_kv_analysis,
	kv_tonemap: i18n.server_kv_tonemap,
	kv_dovi: i18n.server_kv_dovi,
	kv_dovi_desc: i18n.server_kv_dovi_desc,
	kv_secret: i18n.server_kv_secret,
	kv_secret_desc: i18n.server_kv_secret_desc,
	kv_last_scan: i18n.server_kv_last_scan,
	pill_off: i18n.common_off,
	pill_ready: i18n.server_pill_ready,
	pill_not_ready: i18n.server_pill_not_ready,
	pill_found: i18n.server_pill_found,
	pill_not_found: i18n.server_pill_not_found,
	pill_connected: i18n.server_tile_connected,
	pill_no_secret: i18n.server_tile_no_secret,
	pill_set: i18n.server_pill_set,
	pill_this_device: i18n.settings_this_device,
	pill_this_browser: i18n.settings_this_browser,
	pill_new: i18n.home_new,
	status_not_connected: i18n.server_status_not_connected,
	note_no_secret: i18n.server_note_no_secret,
	open_general: i18n.server_open_general,
	open_general_desc: i18n.server_open_general_desc,
	open_logs: i18n.server_open_logs,
	open_logs_desc: i18n.server_open_logs_desc,
	open_import: i18n.server_open_import,
	open_import_desc: i18n.server_open_import_desc,
	note_nobody: i18n.server_note_nobody,
	note_no_apps: i18n.server_note_no_apps,
	note_no_browsers: i18n.server_note_no_browsers,
	note_cache_cleared: i18n.server_note_cache_cleared,
	mode_copy: i18n.server_mode_copy,
	mode_audio: i18n.server_mode_audio,
	mode_transcode: i18n.server_mode_transcode,
	net_home: i18n.server_net_home,
	net_remote: i18n.server_net_remote,
	sent_as_is: i18n.server_sent_as_is,
	video_as_is: i18n.server_video_as_is,
	kind_browser: i18n.server_kind_browser,
	kind_tablet: i18n.server_kind_tablet,
	kind_phone: i18n.server_kind_phone,
	kind_tv: i18n.server_kind_tv,
	kind_desktop: i18n.server_kind_desktop,
	aside_streaming: i18n.server_aside_streaming,
	ago_now: i18n.server_ago_now,
	ago_yesterday: i18n.activity_yesterday,
	vaapi: i18n.server_vaapi,
};

const LABELS: Record<string, () => string> = {
	"transcoding.hw_accel": i18n.server_set_hw_accel,
	"transcoding.hw_device": i18n.server_set_hw_device,
	"stream.tonemap": i18n.server_set_tonemap,
	"stream.max_live": i18n.server_set_max_live,
	"engine.url": i18n.server_set_engine_url,
	"engine.public_url": i18n.server_set_engine_public_url,
	"player.url": i18n.server_set_player_url,
	"player.origins": i18n.server_set_player_origins,
	"player.app_links": i18n.server_set_app_links,
	"network.home": i18n.server_set_network_home,
};

const DESCS: Record<string, () => string> = {
	"transcoding.hw_accel": i18n.server_desc_hw_accel,
	"transcoding.hw_device": i18n.server_desc_hw_device,
	"stream.tonemap": i18n.server_desc_tonemap,
	"stream.max_live": i18n.server_desc_max_live,
	"engine.url": i18n.server_desc_engine_url,
	"engine.public_url": i18n.server_desc_engine_public_url,
	"player.url": i18n.server_desc_player_url,
	"player.origins": i18n.server_desc_player_origins,
	"player.app_links": i18n.server_desc_app_links,
	"network.home": i18n.server_desc_network_home,
};

const CHOICES: Record<string, () => string> = {
	auto: i18n.value_auto,
	none: i18n.common_off,
	vaapi: i18n.server_vaapi,
};

const SIZES = {
	B: i18n.server_size_b,
	KB: i18n.server_size_kb,
	MB: i18n.library_size_mb,
	GB: i18n.library_size_gb,
	TB: i18n.server_size_tb,
};

const one = (n: number) => n === 1;

export const serverWords = (): Words => ({
	keptDesc: (host) => i18n.server_kept_desc({ host }),
	reachable: (version) => i18n.server_reachable({ version }),
	engineBuild: (version, api) =>
		api === undefined ? version : i18n.server_engine_build({ version, api }),
	analysisVersion: (n) => i18n.server_analysis_version({ n }),
	secretSince: (date) => i18n.server_secret_since({ date }),
	t: (id) => TEXT[id](),
	label: (key) => LABELS[key]?.() ?? key,
	desc: (key) => DESCS[key]?.(),
	choice: (_key, value) => CHOICES[value]?.() ?? value,
	size: (n, unit) => SIZES[unit]({ n }),
	pairWaiting: (device, code) => i18n.server_tile_pair_code({ device, code }),
	sumOverview: (version, secretSet) =>
		secretSet
			? i18n.server_sum_overview_ok({ version })
			: i18n.server_sum_overview_no_secret({ version }),
	sumStreams: (count, video, audio) =>
		count
			? i18n.server_sum_streams({
					streams: one(count)
						? i18n.server_stream_count_one({ count })
						: i18n.server_stream_count_other({ count }),
					video,
					audio,
				})
			: i18n.server_sum_streams_none(),
	sumDevices: (count, waiting) =>
		(one(count)
			? i18n.server_sum_devices_one({ count })
			: i18n.server_sum_devices_other({ count })) +
		(waiting ? ` · ${i18n.server_sum_waiting({ count: waiting })}` : ""),
	sumTranscoding: (software, count) =>
		i18n.server_sum_transcoding({
			hw: software ? i18n.server_sum_software() : i18n.server_vaapi(),
			count,
		}),
	sumLibrary: (count, day) =>
		(one(count)
			? i18n.server_sum_folders_one({ count })
			: i18n.server_sum_folders_other({ count })) +
		(day ? ` · ${i18n.server_sum_checked({ day })}` : ""),
	sumEngine: (version) => i18n.server_sum_engine({ version }),
	sumAccess: (origins, networks) =>
		`${
			one(origins)
				? i18n.server_sum_origins_one({ count: origins })
				: i18n.server_sum_origins_other({ count: origins })
		} · ${
			one(networks)
				? i18n.server_sum_networks_one({ count: networks })
				: i18n.server_sum_networks_other({ count: networks })
		}`,
	streamCount: (count) =>
		one(count)
			? i18n.server_stream_count_one({ count })
			: i18n.server_stream_count_other({ count }),
	appsDesc: (count) =>
		one(count) ? i18n.server_apps_desc_one({ count }) : i18n.server_apps_desc_other({ count }),
	changeCount: (count) =>
		one(count)
			? i18n.server_changes_waiting_one({ count })
			: i18n.server_changes_waiting_other({ count }),
	changesWaiting: (count) =>
		one(count)
			? i18n.server_changes_waiting_one({ count })
			: i18n.server_changes_waiting_other({ count }),
	restartNote: (count, keys) =>
		one(count)
			? i18n.server_restart_note_one({ count, keys })
			: i18n.server_restart_note_other({ count, keys }),
	streamSummary: (video, audio, mbps) => i18n.server_stream_summary({ video, audio, mbps }),
	mbps: (n) => i18n.server_mbps({ n }),
	you: (name) => i18n.server_you({ name }),
	cannotDecode: (kind, codec) => i18n.server_cannot_decode({ kind, codec }),
	realtime: (speed) => i18n.player_stat_realtime({ speed }),
	runtime: (min) =>
		min >= 60
			? i18n.common_runtime_hm({ h: Math.floor(min / 60), m: min % 60 })
			: i18n.common_runtime_m({ m: min }),
	healthSub: (ffmpeg, software) =>
		software ? i18n.server_health_sub_soft({ ffmpeg }) : i18n.server_health_sub_hw({ ffmpeg }),
	cacheUsed: (size, count) =>
		one(count)
			? i18n.server_cache_used_one({ size, count })
			: i18n.server_cache_used_other({ size, count }),
	minutesAgo: (n) => i18n.server_minutes_ago({ n }),
	hoursAgo: (n) => i18n.server_hours_ago({ n }),
	daysAgo: (n) => i18n.server_days_ago({ n }),
	expiresIn: (count) =>
		one(count) ? i18n.server_expires_one({ count }) : i18n.server_expires_other({ count }),
	folderCount: (kind, count) =>
		kind === "movies"
			? one(count)
				? i18n.person_movies_one({ count })
				: i18n.person_movies_other({ count })
			: one(count)
				? i18n.server_shows_one({ count })
				: i18n.server_shows_other({ count }),
	scanProgress: (pct, left) =>
		left === null ? i18n.server_scan_percent({ pct }) : i18n.server_scan_progress({ pct, left }),
	lastScan: (when, added, replaced, errors) =>
		i18n.server_last_scan({
			when,
			added: one(added)
				? i18n.server_new_files_one({ count: added })
				: i18n.server_new_files_other({ count: added }),
			replaced: i18n.server_replaced({ count: replaced }),
			errors: one(errors)
				? i18n.activity_errors_one({ count: errors })
				: i18n.activity_errors_other({ count: errors }),
		}),
});
