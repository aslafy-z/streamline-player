import {
	audioName,
	audioOutName,
	digits,
	fileMbit,
	hdrName,
	languageLabel,
	modeName,
	originalName,
	rangeName,
	subInfo,
	subName,
	videoName,
} from "#lib/core/playback/names.ts";
import type { Session, SubKind } from "#lib/core/playback/port.ts";
import type { Words } from "#lib/core/player-panels.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { getLocale } from "#lib/paraglide/runtime.js";

const times = (x: number) =>
	`${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }).format(x)}×`;
const rate = (bits: number) =>
	i18n.player_mbit({ value: digits(bits / 1_000_000, bits < 1_000_000 ? 2 : 1) });

export function fmtOffset(v: number, seconds: boolean) {
	const sign = v > 0 ? "+" : v < 0 ? "−" : "";
	return (
		sign +
		(seconds
			? i18n.player_unit_seconds({ value: digits(Math.abs(v), 1) })
			: i18n.player_unit_ms({ value: Math.abs(v) }))
	);
}

/** The panels' labels in the viewer's language; `playerName` is who draws the picture ("mpv", "Shaka Player"). */
export function panelWords(playerName: string): Words {
	const subRenderer = (kind: SubKind) =>
		kind === "styled" ? "libass" : kind === "image" ? playerName : i18n.player_renderer_web_view();
	return {
		off: i18n.player_subtitles_off(),
		preparing: i18n.player_preparing(),
		original: i18n.player_original(),
		auto: i18n.player_auto(),
		asIs: i18n.player_badge_as_is(),
		converted: i18n.player_badge_converted(),
		convertsVideo: i18n.player_badge_converts_video(),
		normal: i18n.player_speed_normal(),
		measuring: i18n.player_measuring(),
		statLabels: {
			mode: i18n.player_stat_mode(),
			player: i18n.player_stat_player(),
			video: i18n.player_stat_video(),
			audio: i18n.player_audio(),
			container: i18n.player_stat_container(),
			why: i18n.player_stat_why(),
			encode: i18n.player_stat_encode(),
			subtitles: i18n.player_subtitles(),
			offsets: i18n.player_stat_offsets(),
			bitrate: i18n.player_stat_bitrate(),
			throughput: i18n.player_stat_throughput(),
			buffer: i18n.player_stat_buffer(),
			frames: i18n.player_stat_frames(),
			speed: i18n.player_speed(),
			server: i18n.player_stat_server(),
		},
		language: languageLabel,
		originalLanguage: (code) => i18n.player_audio_original({ language: languageLabel(code) }),
		times,
		mbit: (value) => i18n.player_mbit({ value }),
		rate,
		digits,
		number: (n) => n.toLocaleString(getLocale()),
		modeName,
		audioName,
		audioOut: audioOutName,
		videoName: (codec, width, height) => videoName(codec, width, height),
		videoIn: (v) =>
			`${videoName(v.codec, v.width, v.height, v.profile)}${rangeName(v.hdr, !!v.dv)}`,
		videoOut: (s: Session, profile) => {
			const name = videoName(s.video.codec, s.video.width, s.video.height, profile);
			if (s.video.action === "copy")
				return `${name}${rangeName(s.video.hdr, s.video.dv_profile !== undefined)}`;
			return `${name} ${hdrName(s.video.hdr) ?? "SDR"}`;
		},
		originalName,
		fileRate: fileMbit,
		subName,
		subInfo,
		subSdh: (label) => i18n.player_sub_sdh({ label }),
		subBurnIn: (label) => i18n.player_sub_burn_in({ label }),
		subRenderer,
		sameAsOriginal: (size) => i18n.player_quality_same_as_original({ size }),
		originalUnavailable: (reason) => i18n.player_original_unavailable({ reason }),
		autoNow: (quality, why) => i18n.player_auto_now({ quality, why }),
		autoNowOnly: (quality) => i18n.player_auto_now_only({ quality }),
		autoBasedOnConnection: i18n.player_auto_based_on_connection(),
		autoCappedOnCellular: i18n.player_auto_capped_cellular(),
		awayFromHome: i18n.player_stat_away(),
		autoConnectionAllows: i18n.player_auto_connection_allows(),
		originalFile: i18n.player_stat_original_file(),
		nothingConverted: i18n.player_stat_nothing_converted(),
		statAsIs: i18n.player_stat_as_is(),
		passThrough: i18n.player_pass_through(),
		fileItself: i18n.player_stat_file_itself(),
		audioOnly: i18n.player_stat_audio_only(),
		burnedIn: i18n.player_stat_burned_in(),
		notPlayable: (container) => i18n.player_stat_not_playable({ container, player: playerName }),
		realtime: (speed) => i18n.player_stat_realtime({ speed }),
		bufferAhead: (seconds) => i18n.player_stat_buffer_ahead({ seconds }),
		frames: (dropped, rendered) => i18n.player_stat_frames_value({ dropped, rendered }),
		bitrateVideo: (r) => i18n.player_stat_bitrate_video({ rate: r }),
		bitrateAudio: (r) => i18n.player_stat_bitrate_audio({ rate: r }),
		offsets: (subtitles, audio) => i18n.player_stat_offsets_value({ subtitles, audio }),
		offsetSeconds: (v) => fmtOffset(v, true),
		offsetMs: (v) => fmtOffset(v, false),
		backTo: (title) => i18n.player_back_to({ title }),
		downloadsStillPlay: i18n.halt_downloads_still_play(),
		watchDownload: i18n.dl_watch(),
		openServerSettings: i18n.halt_open_server(),
		scanLibrary: i18n.halt_scan_library(),
		adminNotes: {
			missing: i18n.halt_missing_note_admin(),
			nocodec: i18n.halt_nocodec_note_admin(),
		},
	};
}
