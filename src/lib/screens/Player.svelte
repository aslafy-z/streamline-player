<script lang="ts">
import {
	ArrowLeft,
	AudioLines,
	Captions,
	CaptionsOff,
	Gauge,
	Maximize,
	Minimize,
	Pause,
	PictureInPicture2,
	Play,
	RotateCcw,
	RotateCw,
	Settings,
} from "@lucide/svelte";
import { onMount, untrack } from "svelte";
import { localKey, localLaunch } from "#lib/core/download-launch.ts";
import { dl } from "#lib/core/downloads.svelte.ts";
import { episodesOf } from "#lib/core/format.ts";
import { lib } from "#lib/core/library.svelte.ts";
import { account } from "#lib/core/me.svelte.ts";
import { net } from "#lib/core/online.svelte.ts";
import { rememberedThroughput } from "#lib/core/playback/auto.ts";
import { localPort } from "#lib/core/playback/local-port.ts";
import { digits, modeName, resBadge, subInfo } from "#lib/core/playback/names.ts";
import {
	type Launch,
	nowPlaying,
	play,
	setVolume,
	stop,
	toFull,
	toggleMute,
	toMini,
} from "#lib/core/playback/now-playing.svelte.ts";
import { fmtOffset, panelWords } from "#lib/core/playback/panel-words.ts";
import { UP_NEXT_SECS } from "#lib/core/playback/playback.svelte.ts";
import type { PlaybackPort } from "#lib/core/playback/port.ts";
import { DEFAULT_SIZE_PX, SIZE_PX } from "#lib/core/playback/rules.ts";
import {
	audioRows,
	haltView,
	qualityRows,
	speedRows,
	statsRows,
	subtitleRows,
} from "#lib/core/player-panels.ts";
import {
	clock,
	endsAt,
	keyFor,
	loadLaunch,
	type PlayerKey,
	SEEK_STEP,
	type SeekFlash,
	seekFlash,
	segments,
} from "#lib/core/player-view.ts";
import { prefs, setPref as savePref } from "#lib/core/prefs.svelte.ts";
import { toast } from "#lib/core/toast.svelte.ts";
import type { DownloadEntry, Kind } from "#lib/core/types.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { getLocale } from "#lib/paraglide/runtime.js";
import { isTablet } from "#lib/platform/form-factor.svelte.ts";
import { downloadsPort } from "#lib/screens/downloads-port.ts";
import PlayerChrome from "#lib/screens/tablet/PlayerChrome.svelte";
import BufferingSpinner from "#lib/ui/BufferingSpinner.svelte";
import Button from "#lib/ui/Button.svelte";
import EmptyState from "#lib/ui/EmptyState.svelte";
import EndScreen from "#lib/ui/EndScreen.svelte";
import HaltOverlay from "#lib/ui/HaltOverlay.svelte";
import { goto } from "#lib/ui/nav.ts";
import Osd from "#lib/ui/Osd.svelte";
import PausedCard from "#lib/ui/PausedCard.svelte";
import PlayerBar from "#lib/ui/PlayerBar.svelte";
import PlayerMenu from "#lib/ui/PlayerMenu.svelte";
import Scrubber from "#lib/ui/Scrubber.svelte";
import SkipButton from "#lib/ui/SkipButton.svelte";
import StatsPanel from "#lib/ui/StatsPanel.svelte";
import Stepper from "#lib/ui/Stepper.svelte";
import SubtitleStyle from "#lib/ui/SubtitleStyle.svelte";
import Tip from "#lib/ui/Tip.svelte";
import UpNextCard from "#lib/ui/UpNextCard.svelte";
import {
	adminScan,
	artwork,
	artworkAt,
	canDownload,
	everything,
	title as fetchTitle,
	isFullscreen,
	localPlayback,
	noteOffline,
	playbackPort,
	setFullscreen,
	watchState,
} from "#platform";
import { afterNavigate, beforeNavigate } from "$app/navigation";

type Tab = "subs" | "audio" | "quality" | "speed";
type Phase = "idle" | "in" | "out";
type Flash = { ph: Phase; amt: number; rot: number };

const HIDE_MS = 3200;
const OSD_MS = 900;
const MAX_EXTRAPOLATION = 1.5;
const VOLUME_STEP = 0.05;
const CUE_BOTTOM = { shown: 140, hidden: 48 };
const CARD_BOTTOM = { shown: 130, hidden: 40 };
const TABLET_CUE_BOTTOM = { shown: 130, hidden: 48 };
const TABLET_CARD_BOTTOM = { shown: 110, hidden: 40 };
const QUALITY_AND_SPEED: Tab[] = ["quality", "speed"];
const MENU_SWITCH_MS = 170;
const SUB_STEP = 0.1;
const AUDIO_STEP = 10;
const TONE = {
	ok: "var(--status-available)",
	conv: "var(--status-downloading)",
	warn: "var(--status-warning)",
};
// Prefs hold the English values; only the label shown to the viewer follows the locale.
const STYLE_LABEL: Record<string, () => string> = {
	None: i18n.player_style_bg_none,
	Shadow: i18n.player_style_bg_shadow,
	Box: i18n.player_style_bg_box,
	White: i18n.player_style_color_white,
	Yellow: i18n.player_style_color_yellow,
};
const styleText = (v: string) => STYLE_LABEL[v]?.() ?? v;
const words = panelWords(playbackPort.playerName);

let {
	kind,
	id,
	epId,
	resume,
	local = null,
}: {
	kind: Kind;
	id: number;
	epId: number | null;
	resume: boolean;
	/** Set when the Downloads screen opened this: the saved file plays, whatever the server says. */
	local?: { season: number | null; episode: number | null } | null;
} = $props();

let launch = $state.raw<Launch | null>(null);
let failed = $state(false);
let controls = $state(true);
let hovering = $state(false);
let fullscreen = $state(false);
let osd = $state<string | null>(null);
let pf = $state<Phase>("idle");
let pfPause = $state(false);
let skL = $state<Flash>({ ph: "idle", amt: 0, rot: 0 });
let skR = $state<Flash>({ ph: "idle", amt: 0, rot: 0 });
let frameAt = $state(0);
let menu = $state<Tab | null>(null);
let menuGroup = $state<Tab[] | null>(null);
let styleOpen = $state(false);

let lastMove = Date.now();
let osdTimer: ReturnType<typeof setTimeout> | undefined;
let pfTimer: ReturnType<typeof setTimeout> | undefined;
let seekTimer: ReturnType<typeof setTimeout> | undefined;
let menuTimer: ReturnType<typeof setTimeout> | undefined;
let run: SeekFlash | null = null;
let fromApp = false;
let leaving = false;
let pressClosedMenu = false;
let pressedOn = false;

afterNavigate(({ from }) => {
	// Another episode replaces this entry, so the page that opened the player stays the one behind it.
	if (from?.route.id && !from.route.id.startsWith("/player")) fromApp = true;
});

// Any way out of the player that is neither another player route nor a hand-over to the mini player ends the session.
beforeNavigate(({ to }) => {
	if (!to?.route.id?.startsWith("/player") && !nowPlaying.mini) stop();
});

const pb = $derived(launch && nowPlaying.launch?.key === launch.key ? nowPlaying.pb : null);
const view = $derived(launch?.view ?? null);
const tablet = $derived(isTablet());
const controlsOn = $derived(!!pb && (controls || (!pb.playing && !pb.buffering) || !!menu));
const showBar = $derived(controlsOn && !pb?.ended && !pb?.halt);

// Where a launch gets its server calls: the server's, or the saved file's when that is all there is.
async function openLocal(
	entry: DownloadEntry,
	resuming: boolean,
	serverStart?: number,
): Promise<{ launch: Launch; port: PlaybackPort }> {
	const found = await localPlayback(entry.key);
	if (!found) throw new Error("no local file");
	const noted = entry.offline !== null;
	const watched =
		serverStart ??
		(await watchState().catch(() => lib.watch)).find((w) => w.media_id === entry.media_id)
			?.position_seconds ??
		0;
	const position = !resuming ? 0 : noted ? found.position : watched;
	const launch = localLaunch(entry, artworkAt, position);
	const file = {
		key: entry.key,
		url: found.url,
		tracks: found.tracks,
		position,
		duration: entry.meta.runtime * 60,
		size: entry.bytes,
	};
	return { launch, port: localPort(playbackPort, file, noteOffline) };
}

async function downloaded(key: string | null) {
	if (!canDownload || !key) return null;
	const items = dl.items.length > 0 ? dl.items : await downloadsPort.downloads().catch(() => []);
	return items.find((e) => e.key === key && e.state === "done") ?? null;
}

function libraryKey(k: Kind, i: number, e: number | null) {
	if (k === "movies") return localKey(k, i, null, null);
	const found = lib.shows.find((t) => t.id === i);
	const ep = found && episodesOf(found).find((x) => x.id === e);
	return ep ? localKey(k, i, ep.season, ep.number) : null;
}

async function open(
	k: Kind,
	i: number,
	e: number | null,
	r: boolean,
	file: { season: number | null; episode: number | null } | null,
) {
	if (file) {
		const entry = await downloaded(localKey(k, i, file.season, file.episode));
		if (!entry) throw new Error("not downloaded");
		return openLocal(entry, true);
	}
	try {
		const launch = await loadLaunch(
			{ title: fetchTitle, watchState, artwork, everything },
			k,
			i,
			e,
			r,
		);
		if (!net.online) {
			const entry = await downloaded(
				dl.items.find((x) => x.media_id === launch.item.mediaId)?.key ?? null,
			);
			if (entry) return await openLocal(entry, r, launch.item.start);
		}
		return { launch, port: playbackPort as PlaybackPort };
	} catch (error) {
		const entry = net.online ? null : await downloaded(libraryKey(k, i, e));
		if (!entry) throw error;
		return openLocal(entry, r);
	}
}

$effect(() => {
	const [k, i, e, r, file] = [kind, id, epId, resume, local];
	let stale = false;
	failed = false;
	leaving = false;
	untrack(() => open(k, i, e, r, file)).then(
		({ launch: l, port }) => {
			if (stale) return;
			launch = l;
			startPlayback(l, port);
		},
		() => {
			if (!stale) failed = true;
		},
	);
	return () => {
		stale = true;
	};
});

function startPlayback(l: Launch, port: PlaybackPort) {
	const next = l.view.next;
	// The controller calls onEnd when the file ends, autoplay or not; without autoplay the end screen takes over.
	const onEnd = () => (prefs.autoplay ? goNext() : nowPlaying.pb?.skip());
	play(
		port,
		{ ...l, item: { ...l.item, onEnd: next ? onEnd : undefined } },
		{
			started: () => show(),
			subtitlesUnavailable: () => flashOsd(i18n.player_subtitles_unavailable()),
		},
	);
	toFull();
	playbackPort.command("viewport", { full: true }).catch(() => {});
}

function show() {
	lastMove = Date.now();
	controls = true;
}

function flashOsd(text: string) {
	clearTimeout(osdTimer);
	osd = text;
	osdTimer = setTimeout(() => (osd = null), OSD_MS);
}

const percent = (v: number) => i18n.player_osd_volume({ percent: Math.round(v * 100) });

function flashPlay(wasPlaying: boolean) {
	pfPause = wasPlaying;
	clearTimeout(pfTimer);
	pf = "in";
	pfTimer = setTimeout(() => {
		pf = "out";
		pfTimer = setTimeout(() => (pf = "idle"), 220);
	}, 520);
}

function togglePlay() {
	if (!pb || pb.ended || pb.halt) return;
	const was = pb.playing;
	pb.togglePlay();
	flashPlay(was);
	show();
}

function seek(delta: number) {
	if (!pb) return;
	pb.seek(delta);
	const left = delta < 0;
	const next = seekFlash(run, left ? "left" : "right", Date.now());
	const cur = left ? skL : skR;
	const continued = run !== null && next.amount > Math.abs(delta) && cur.ph !== "idle";
	run = next;
	const flash: Flash = {
		ph: "in",
		amt: next.amount,
		rot: (continued ? cur.rot : 0) + (left ? -360 : 360),
	};
	if (left) {
		skL = flash;
		if (skR.ph === "in") skR = { ...skR, ph: "out" };
	} else {
		skR = flash;
		if (skL.ph === "in") skL = { ...skL, ph: "out" };
	}
	clearTimeout(seekTimer);
	seekTimer = setTimeout(() => {
		if (left) skL = { ...skL, ph: "out" };
		else skR = { ...skR, ph: "out" };
		seekTimer = setTimeout(() => {
			skL = { ...skL, ph: "idle", rot: 0 };
			skR = { ...skR, ph: "idle", rot: 0 };
		}, 220);
	}, 720);
	show();
}

function volume(v: number, silent = false) {
	const level = Math.max(0, Math.min(1, v));
	if (nowPlaying.muted) toggleMute();
	setVolume(level);
	if (!silent) flashOsd(percent(level));
}

function mute() {
	toggleMute();
	flashOsd(nowPlaying.muted ? i18n.player_osd_muted() : percent(nowPlaying.volume));
}

async function toggleFullscreen(on = !fullscreen) {
	await setFullscreen(on).catch(() => {});
	fullscreen = await isFullscreen().catch(() => on);
}

const detail = $derived(`/detail/${kind}/${id}`);

function leaveRoute() {
	stop();
	if (local) goto("/downloads", { replace: true });
	else if (fromApp) history.back();
	else goto(view?.season ? `${detail}?s=${view.season}` : detail, { replace: true });
}

function toPip() {
	if (!pb || pb.ended || pb.halt) return;
	if (fullscreen) toggleFullscreen(false);
	closeMenu();
	toMini();
	if (local) goto("/downloads", { replace: true });
	else if (fromApp) history.back();
	else goto(view?.season ? `${detail}?s=${view.season}` : detail, { replace: true });
}

function openMenu(tab: Tab) {
	clearTimeout(menuTimer);
	const group = tablet && QUALITY_AND_SPEED.includes(tab) ? QUALITY_AND_SPEED : null;
	if (menu === tab || (menu && group?.includes(menu))) return closeMenu();
	show();
	if (!menu) {
		menu = tab;
		menuGroup = group;
		return;
	}
	menu = null;
	menuTimer = setTimeout(() => {
		menu = tab;
		menuGroup = group;
	}, MENU_SWITCH_MS);
}

function closeMenu() {
	clearTimeout(menuTimer);
	menu = null;
	menuGroup = null;
}

// A touch fires mousemove before its click and that shows the controls, so the tap reads the
// state from its press.
function pressSurface() {
	pressedOn = controlsOn && !!pb?.playing;
}

// Tablet: a second tap on the same side within this long skips that way, and so does each tap after it.
const DOUBLE_TAP_MS = 320;
const SIDE = 0.4;
let lastTap = { side: 0, at: 0, running: false, controls: true };

function tapSurface(e: MouseEvent) {
	if (pressClosedMenu) {
		pressClosedMenu = false;
		return;
	}
	const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
	const x = (e.clientX - r.left) / r.width;
	const side = x < SIDE ? -1 : x > 1 - SIDE ? 1 : 0;
	const now = Date.now();
	if (side !== 0 && lastTap.side === side && now - lastTap.at < DOUBLE_TAP_MS && !pb?.ended) {
		// The pair's first tap toggled the controls: put them back as they were.
		if (!lastTap.running) controls = lastTap.controls;
		lastTap = { ...lastTap, at: now, running: true };
		seek(side * SEEK_STEP);
		return;
	}
	lastTap = { side, at: now, running: false, controls };
	controls = !pressedOn;
	lastMove = Date.now();
}

function exit() {
	if (fullscreen) toggleFullscreen(false);
	leaveRoute();
}

function goNext() {
	const next = view?.next;
	if (!next || leaving) return;
	leaving = true;
	const done = pb?.leave() ?? Promise.resolve();
	done.then(() => goto(next.href, { replace: true }));
}

function goPrevious() {
	const prev = view?.prev;
	if (prev) goto(prev.href, { replace: true });
}

function openMore(href: string) {
	stop();
	goto(href, { replace: true });
}

function onKey(e: KeyboardEvent) {
	// A tablet has no keyboard shortcuts; Escape stays, as it closes things everywhere else.
	if (!pb || (tablet && e.key !== "Escape")) return;
	const act = keyFor(
		{
			key: e.key,
			ctrlKey: e.ctrlKey,
			metaKey: e.metaKey,
			altKey: e.altKey,
			target: e.target as Element | null,
		},
		{ ended: pb.ended, menuOpen: menu !== null, fullscreen },
	);
	if (!act) return;
	e.preventDefault();
	// A focused button would also click on the key's release.
	if (e.target instanceof HTMLButtonElement) e.target.blur();
	const actions: Record<PlayerKey, () => void> = {
		toggle: togglePlay,
		back10: () => seek(-10),
		forward10: () => seek(10),
		volumeUp: () => {
			volume(Math.round((nowPlaying.volume + VOLUME_STEP) * 20) / 20);
			show();
		},
		volumeDown: () => {
			volume(Math.round((nowPlaying.volume - VOLUME_STEP) * 20) / 20);
			show();
		},
		mute,
		subtitles: () => openMenu("subs"),
		stats: () => pb?.setStats(!pb.stats),
		next: goNext,
		previous: goPrevious,
		fullscreen: () => toggleFullscreen(),
		audio: () => openMenu("audio"),
		quality: () => openMenu("quality"),
		speed: () => openMenu("speed"),
		pip: toPip,
		closeMenu,
		exitFullscreen: () => toggleFullscreen(false),
		exit,
	};
	actions[act]();
}

onMount(() => {
	const hide = setInterval(() => {
		if (controls && pb?.playing && !hovering && !menu && Date.now() - lastMove > HIDE_MS)
			controls = false;
	}, 250);
	// No click-catcher over the bar, so its buttons keep their cursor: a press outside the panel closes it.
	const outside = (e: PointerEvent) => {
		const t = e.target as Element | null;
		if (menu && !t?.closest("[data-menu-panel], [data-menu-btn]")) {
			closeMenu();
			pressClosedMenu = true;
			setTimeout(() => (pressClosedMenu = false), 400);
		}
	};
	document.addEventListener("pointerdown", outside, true);
	const sync = () =>
		isFullscreen().then(
			(v) => (fullscreen = v),
			() => {},
		);
	document.addEventListener("fullscreenchange", sync);
	// The mini player's F opens this screen already in fullscreen.
	sync();
	return () => {
		clearInterval(hide);
		clearTimeout(osdTimer);
		clearTimeout(pfTimer);
		clearTimeout(seekTimer);
		document.removeEventListener("fullscreenchange", sync);
		document.removeEventListener("pointerdown", outside, true);
		clearTimeout(menuTimer);
		if (fullscreen) setFullscreen(false).catch(() => {});
	};
});

$effect(() => {
	if (pb?.tracks) void pb.loadTrickplay();
});

// The player reports every 500 ms; between reports the bar moves on each frame at the playback speed.
$effect(() => {
	if (!pb?.playing || !(controlsOn || pb.upNextOn)) return;
	let raf = requestAnimationFrame(function tick(t) {
		frameAt = t;
		raf = requestAnimationFrame(tick);
	});
	return () => cancelAnimationFrame(raf);
});

const shown = $derived(
	pb?.playing
		? Math.min(
				pb.duration || Infinity,
				pb.position +
					Math.min(MAX_EXTRAPOLATION, Math.max(0, ((frameAt - pb.positionAt) / 1000) * pb.speed)),
			)
		: (pb?.position ?? 0),
);
const duration = $derived(pb?.duration ?? 0);
const segs = $derived(segments(duration, pb?.tracks?.chapters ?? []));
const paused = $derived(
	!!pb && !pb.playing && !pb.buffering && !pb.ended && !pb.halt && duration > 0,
);
const upNextFrac = $derived(
	!pb || pb.creditsAt === null
		? 0
		: Math.min(1, Math.max(0, (shown - pb.creditsAt) / UP_NEXT_SECS)),
);
const skipOn = $derived(
	!!pb && ((pb.introOn && !prefs.autoSkip) || pb.creditsOn) && !pb.ended && !pb.halt,
);
const cardRule = $derived(tablet ? TABLET_CARD_BOTTOM : CARD_BOTTOM);
const cueRule = $derived(tablet ? TABLET_CUE_BOTTOM : CUE_BOTTOM);
const cardBottom = $derived(controlsOn ? cardRule.shown : cardRule.hidden);
const cueBottom = $derived(controlsOn ? cueRule.shown : cueRule.hidden);

$effect(() => {
	if (!pb) return;
	const px = showBar ? cueRule.shown - cueRule.hidden : 0;
	playbackPort.command("subtitleLift", { px }).catch(() => {});
});

const times = (x: number) =>
	`${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }).format(x)}×`;
const qualText = $derived(
	!pb || pb.qSel === "auto"
		? i18n.player_auto()
		: pb.qSel === "original"
			? i18n.player_original()
			: i18n.player_mbit({ value: pb.qSel }),
);
const modeLabel = $derived.by(() => {
	const s = pb?.session;
	if (!s) return "";
	const { width, height, hdr, dv_profile } = s.video;
	const size = resBadge(width, height);
	if (prefs.techDetails)
		return `${modeName(s.mode)} · ${s.video.action === "copy" ? size : i18n.player_mbit({ value: digits(s.bandwidth / 1_000_000, 1) })}`;
	const range = dv_profile !== undefined ? " · Dolby Vision" : hdr === "sdr" ? "" : " · HDR";
	return `${size}${range}`;
});

const chapterTitles = $derived(pb?.tracks?.chapters ?? []);
const subtitleCue = $derived.by(() => {
	const bg = prefs.subBg;
	return {
		size: SIZE_PX[prefs.subSize] ?? DEFAULT_SIZE_PX,
		color: prefs.subColor === "Yellow" ? "#FDE68A" : "#FFFFFF",
		shadow:
			bg === "Shadow"
				? "0 2px 4px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.6)"
				: bg === "None"
					? "0 0 2px rgba(0,0,0,0.9)"
					: "none",
		background: bg === "Box" ? "rgba(0,0,0,0.72)" : "transparent",
		padding: bg === "Box" ? "4px 12px" : "0",
	};
});

const selectedSub = $derived(pb?.tracks?.subtitles.find((t) => t.index === pb.subPick) ?? null);
const subKind = $derived(pb?.burn ? "burn" : selectedSub ? subInfo(selectedSub).kind : "text");
const audioList = $derived(
	pb ? audioRows(pb.tracks, pb.selectedAudio, pb.preview, pb.session, words, pb.passthrough) : [],
);
const subList = $derived(pb ? subtitleRows(pb.tracks, pb.subPick, words) : []);
const qualityList = $derived(
	pb
		? qualityRows(
				{
					qSel: pb.qSel,
					autoPick: pb.autoPick,
					measuredOnce: pb.measuredOnce,
					originalPlays: pb.originalPlays,
					mobileLimit: pb.mobileLimit,
					preview: pb.preview,
					tracks: pb.tracks,
				},
				words,
			)
		: [],
);
const speedList = $derived(speedRows(pb?.speed ?? 1, words));
const menuRows = $derived(
	menu === "audio"
		? audioList
		: menu === "subs"
			? subList
			: menu === "quality"
				? qualityList
				: speedList,
);
const MENU_TITLES: Record<Tab, () => string> = {
	audio: i18n.player_audio,
	subs: i18n.player_subtitles,
	quality: i18n.player_quality,
	speed: i18n.player_speed,
};
const menuNote = $derived.by(() => {
	const session = pb?.session;
	if (!pb || !session) return undefined;
	if (menu === "quality") {
		const why = (r: { text: string }[]) => r.map((x) => x.text).join(", ");
		const text =
			session.mode === "direct"
				? i18n.player_note_direct()
				: session.mode === "remux"
					? i18n.player_note_remux({
							player: playbackPort.playerName,
							container: pb.tracks?.container.toUpperCase() ?? "",
						})
					: session.mode === "audio_transcode"
						? i18n.player_note_audio_transcode({
								audio: words.audioOut(session),
								why: why(session.audio_reasons),
							})
						: i18n.player_note_transcode({
								video: words.videoOut(session),
								why: why(session.video_reasons),
							});
		return { text, color: pb.full ? TONE.ok : TONE.conv };
	}
	if (menu === "audio") {
		const track = pb.selectedAudio;
		if (!track) return undefined;
		const name = words.audioName(track);
		const asIs = session.audio.action === "copy";
		return {
			text: asIs
				? pb.passthrough.includes(session.audio.codec)
					? i18n.player_audio_note_pass({ name })
					: i18n.player_audio_note_as_is({ player: playbackPort.playerName, name })
				: i18n.player_audio_note_convert({
						player: playbackPort.playerName,
						name,
						out: words.audioOut(session),
					}),
			color: asIs ? TONE.ok : TONE.conv,
		};
	}
	if (menu === "subs") {
		if (pb.tracks?.preparing)
			return { text: i18n.player_subtitles_preparing_note(), color: TONE.conv };
		if (pb.burn && selectedSub)
			return {
				text: i18n.player_subtitles_burn_note({
					player: playbackPort.playerName,
					format: subInfo(selectedSub).fmt,
					name: words.subName(selectedSub),
					back: pb.burnBack,
				}),
				color: TONE.warn,
			};
	}
	return undefined;
});

function pickRow(id: string) {
	if (!pb) return;
	if (menu === "audio") {
		const t = pb.tracks?.audio.find((a) => String(a.index) === id);
		if (t) pb.pickAudio(t);
	} else if (menu === "subs") {
		pb.pickSub(
			id === "off" ? null : (pb.tracks?.subtitles.find((t) => String(t.index) === id) ?? null),
		);
	} else if (menu === "quality") {
		pb.pickQuality(id === "auto" || id === "original" ? id : Number(id));
	} else if (menu === "speed") {
		pb.pickSpeed(Number(id));
	}
}

function nudgeSub(step: number) {
	if (!pb) return;
	if (step === 0) pb.resetTiming("sub");
	else pb.nudgeSub(step);
	show();
	flashOsd(i18n.player_osd_subtitles({ offset: fmtOffset(pb.subOffset, true) }));
}

function nudgeAudio(step: number) {
	if (!pb) return;
	if (step === 0) pb.resetTiming("audio");
	else pb.nudgeAudio(step);
	show();
	flashOsd(i18n.player_osd_audio({ offset: fmtOffset(pb.audioDelay, false) }));
}

function setStyle(key: "subSize" | "subBg" | "subColor", value: string) {
	savePref(key, value);
	pb?.syncTiming();
}

const styleOk = (key: string) => subKind === "text" || (subKind === "styled" && key === "subSize");
const styleNote = $derived(
	subKind === "styled"
		? i18n.player_style_note_styled()
		: subKind === "image"
			? i18n.player_style_note_image()
			: subKind === "burn"
				? i18n.player_style_note_burn()
				: "",
);
const styleSummary = $derived(
	subKind === "text"
		? `${prefs.subSize} · ${styleText(prefs.subBg)} · ${styleText(prefs.subColor)}`
		: subKind === "styled"
			? i18n.player_style_own_look({ size: prefs.subSize })
			: i18n.player_style_drawn(),
);
const styleGroups = $derived(
	(
		[
			[i18n.player_style_size(), "subSize", ["S", "M", "L", "XL"]],
			[i18n.player_style_background(), "subBg", ["None", "Shadow", "Box"]],
			[i18n.player_style_color(), "subColor", ["White", "Yellow"]],
		] as const
	).map(([label, key, values]) => ({
		label,
		values: values.map((value) => ({ value, label: styleText(value) })),
		current: prefs[key],
		enabled: styleOk(key),
		onpick: (value: string) => setStyle(key, value),
	})),
);

const statList = $derived.by(() => {
	if (!pb?.session) return [];
	return statsRows(
		{
			session: pb.session,
			live: pb.live,
			encodeSpeed: pb.encodeSpeed,
			tracks: pb.tracks,
			selectedAudio: pb.selectedAudio,
			subPick: pb.subPick,
			burn: pb.burn,
			subOffset: pb.subOffset,
			audioDelay: pb.audioDelay,
			measured: pb.measured,
			throughput: pb.network ? rememberedThroughput(pb.network) : null,
			away: pb.network === "away",
			passAudio:
				pb.session?.audio.action === "copy" && pb.passthrough.includes(pb.session.audio.codec),
			host: URL.canParse(pb.session.url) ? new URL(pb.session.url).host : "",
			playerName: playbackPort.playerName,
			full: pb.full,
			speed: pb.speed,
		},
		words,
	);
});

const haltModel = $derived(
	pb?.halt && launch
		? haltView(
				pb.halt,
				{
					title: launch.item.titleName,
					host: pb.host,
					position: pb.position,
					isAdmin: account.me?.role === "Admin",
					routes: { serverSettings: true },
					canDownload,
				},
				words,
			)
		: null,
);

function haltAction(id: string) {
	if (id === "retry") pb?.retry();
	else if (id === "back") exit();
	else if (id === "downloads" || id === "server-settings") {
		if (fullscreen) toggleFullscreen(false);
		goto(id === "downloads" ? "/downloads" : "/admin");
	} else if (id === "scan") {
		adminScan().then(
			() => toast(i18n.halt_toast_scan_started()),
			() => {},
		);
		exit();
	}
}

$effect(() => {
	if (pb?.halt) closeMenu();
});

const menuButtons = $derived.by(() => {
	const label = (name: string, key?: string) => ({ label: name, key: tablet ? undefined : key });
	return [
		{
			id: "subtitles",
			icon: pb?.subPick === null ? CaptionsOff : Captions,
			...label(i18n.player_subtitles(), "C"),
			active: menu === "subs",
			onclick: () => openMenu("subs"),
		},
		{
			id: "audio",
			icon: AudioLines,
			...label(i18n.player_audio(), "A"),
			active: menu === "audio",
			onclick: () => openMenu("audio"),
		},
		{
			id: "quality",
			icon: Settings,
			...label(i18n.player_quality(), "Q"),
			active: menu === "quality",
			text: qualText,
			onclick: () => openMenu("quality"),
		},
		{
			id: "speed",
			icon: Gauge,
			...label(i18n.player_speed(), "S"),
			active: menu === "speed",
			text: pb && pb.speed !== 1 ? times(pb.speed) : undefined,
			onclick: () => openMenu("speed"),
		},
		{
			id: "pip",
			icon: PictureInPicture2,
			...label(i18n.player_pip(), "W"),
			active: false,
			disabled: !pb || pb.ended || !!pb.halt,
			onclick: toPip,
		},
		{
			id: "fullscreen",
			icon: fullscreen ? Minimize : Maximize,
			label: fullscreen ? i18n.player_fullscreen_exit() : i18n.player_fullscreen(),
			key: "F",
			active: false,
			onclick: () => toggleFullscreen(),
		},
	];
});

const tabletButtons = $derived.by(() => {
	const off = !pb || pb.ended || !!pb.halt;
	return [
		{
			id: "subtitles",
			icon: pb?.subPick === null ? CaptionsOff : Captions,
			label: i18n.player_subtitles(),
			active: menu === "subs" || pb?.subPick !== null,
			onclick: () => openMenu("subs"),
		},
		{
			id: "audio",
			icon: AudioLines,
			label: i18n.player_audio(),
			active: menu === "audio",
			onclick: () => openMenu("audio"),
		},
		{
			id: "quality",
			icon: Settings,
			label: i18n.player_quality_and_speed(),
			active: menu === "quality" || menu === "speed",
			onclick: () => openMenu("quality"),
		},
		{
			id: "pip",
			icon: PictureInPicture2,
			label: i18n.player_pip(),
			active: false,
			disabled: off,
			onclick: toPip,
		},
	];
});
// A movie's sub line leads with its year.
const tabletSub = $derived(
	view?.season
		? i18n.common_episode_code({ season: view.season, episode: view.episode ?? 0 })
		: (view?.sub?.split(" · ")[0] ?? ""),
);
const tabletBadge = $derived.by(() => {
	const s = pb?.session;
	if (!s) return "";
	if (!prefs.techDetails) return modeLabel;
	const { width, height, hdr, dv_profile } = s.video;
	const range = dv_profile !== undefined ? " DV" : hdr === "sdr" ? "" : " HDR";
	return `${resBadge(width, height)}${range} · ${modeName(s.mode).toLowerCase()}`;
});

const labels = {
	play: i18n.player_play(),
	pause: i18n.player_pause(),
	back: i18n.player_back_10(),
	forward: i18n.player_forward_10(),
	next: i18n.player_next_episode(),
	mute: i18n.player_mute(),
	volume: i18n.player_volume(),
};
</script>

<svelte:window onkeydown={onKey} onmousemove={show} />

{#if failed}
	<div class="failed">
		<EmptyState icon="info" title={i18n.halt_error_title()}>
			{#snippet action()}
				<Button variant="secondary" onclick={leaveRoute}>{i18n.common_back()}</Button>
			{/snippet}
		</EmptyState>
	</div>
{:else if pb && view && launch}
	<div class="stage" style:cursor={controlsOn || pb.ended || pb.halt ? "default" : "none"}>
		<button
			type="button"
			class="surface"
			tabindex="-1"
			aria-label={pb.playing ? labels.pause : labels.play}
			onpointerdown={tablet ? pressSurface : undefined}
			onclick={tablet ? tapSurface : togglePlay}
			ondblclick={tablet ? undefined : () => toggleFullscreen()}
		></button>
		{#if !pb.picture && !pb.ended && !pb.halt}
			<div
				class="art"
				style:background-image="url({JSON.stringify(view.still)}), url({JSON.stringify(
					view.poster,
				)})"
			></div>
		{/if}
		<div class="scrim" class:off={!showBar} style:opacity={showBar ? 1 : 0}></div>

		{#if pb.buffering && !pb.ended}
			<BufferingSpinner label={i18n.player_buffering()} />
		{/if}

		{#if pb.cueText && !paused && !pb.ended && !pb.halt}
			<div class="cue-wrap" style:bottom="{cueBottom}px">
				<span
					class="cue"
					style:font-size="{subtitleCue.size}px"
					style:color={subtitleCue.color}
					style:text-shadow={subtitleCue.shadow}
					style:background={subtitleCue.background}
					style:padding={subtitleCue.padding}
					>{pb.cueText}</span
				>
			</div>
		{/if}

		{#if osd && !(tablet && showBar)}
			<Osd text={osd} />
		{/if}

		{#if !tablet}
			<div class="pf" aria-hidden="true">
				<div class="disc {pf}">
					{#if pfPause}
						<Pause size={36} fill="currentColor" strokeWidth={0} />
					{:else}
						<Play size={36} fill="currentColor" strokeWidth={0} />
					{/if}
				</div>
			</div>
		{/if}
		{#each [
			{ f: skL, side: "left" },
			{ f: skR, side: "right" },
		] as s (s.side)}
			<div class="sk {s.side}" class:half={tablet} aria-hidden="true">
				<div class="disc sdisc {s.f.ph}" style:--dir={s.side === "left" ? -14 : 14}>
					<span
						class="sk-ico"
						style:transform="rotate({s.f.rot}deg)"
						style:transition={s.f.ph === "idle" ? "none" : "transform 450ms var(--ease)"}
					>
						{#if s.side === "left"}
							<RotateCcw size={46} strokeWidth={1.5} />
						{:else}
							<RotateCw size={46} strokeWidth={1.5} />
						{/if}
					</span>
					<span class="sk-amt">{s.f.amt}</span>
				</div>
			</div>
		{/each}

		{#if tablet}
			<div class="chrome" class:off={!showBar} style:opacity={showBar ? 1 : 0}>
				<PlayerChrome
					live={showBar}
					title={launch.item.titleName}
					sub={tabletSub}
					buttons={tabletButtons}
					playing={pb.playing}
					{paused}
					pausedEyebrow={pb.chapterName
						? i18n.player_paused_in({ chapter: pb.chapterName })
						: i18n.player_paused()}
					pausedTitle={view.heading}
					pausedText={view.synopsis}
					pausedLeft={i18n.player_paused_left({
						remain: clock(duration - shown, duration),
						time: endsAt(new Date(), duration - shown, pb.speed, getLocale()),
					})}
					scrub={{
						segs,
						chapters: chapterTitles,
						position: shown,
						buffered: pb.buffered,
						duration,
						still: view.still,
						trickplay: pb.trickplay,
						label: i18n.player_seek(),
						onseek: (at) => pb.seekTo(at),
						onhovering: (on) => (hovering = on),
						onactivity: show,
					}}
					current={clock(shown, duration)}
					remaining={clock(duration - shown, duration)}
					badge={tabletBadge}
					badgeDot={prefs.techDetails
						? pb.full
							? "var(--status-available)"
							: "var(--status-downloading)"
						: null}
					chapter={pb.chapterName}
					hasNext={!!view.next}
					labels={{ ...labels, backTitle: i18n.common_back(), stats: i18n.player_stats_title() }}
					onback={exit}
					ontoggle={togglePlay}
					onseek={seek}
					onstats={() => pb.setStats(!pb.stats)}
					onnext={goNext}
				/>
			</div>
		{:else}
			<div class="chrome" class:off={!showBar} style:opacity={showBar ? 1 : 0}>
				<div class="top" style:pointer-events={showBar ? "auto" : "none"}>
					<button type="button" class="back" aria-label={i18n.common_back()} onclick={exit}>
						<ArrowLeft size={20} strokeWidth={2} />
					</button>
					<div class="heading">
						<span class="name">{launch.item.titleName}</span>
						<span class="sub">{view.sub ?? view.eyebrow}</span>
					</div>
					<div class="grow"></div>
					{#if modeLabel}
						<button
							type="button"
							class="pill"
							class:on={pb.stats}
							aria-label={i18n.player_stats_title()}
							onclick={() => pb.setStats(!pb.stats)}
						>
							<Tip text={i18n.player_stats_title()} key="I" />
							{#if prefs.techDetails}
								<span
									class="dot"
									style:background={pb.full
										? "var(--status-available)"
										: "var(--status-downloading)"}
								></span>
							{/if}
							{modeLabel}
						</button>
					{/if}
				</div>

				<PausedCard
					on={paused && showBar}
					eyebrow={pb.chapterName
						? i18n.player_paused_in({ chapter: pb.chapterName })
						: i18n.player_paused()}
					title={view.heading}
					text={view.synopsis}
					remaining={i18n.player_paused_left({
						remain: clock(duration - shown, duration),
						time: endsAt(new Date(), duration - shown, pb.speed, getLocale()),
					})}
				/>

				<div class="bottom" style:pointer-events={showBar ? "auto" : "none"}>
					<Scrubber
						{segs}
						chapters={chapterTitles}
						position={shown}
						buffered={pb.buffered}
						{duration}
						still={view.still}
						trickplay={pb.trickplay}
						label={i18n.player_seek()}
						onseek={(at) => pb.seekTo(at)}
						onhovering={(on) => (hovering = on)}
						onactivity={show}
					/>
					<PlayerBar
						playing={pb.playing}
						volume={nowPlaying.volume}
						muted={nowPlaying.muted}
						current={clock(shown, duration)}
						total={clock(duration, duration)}
						chapter={pb.chapterName}
						hasNext={!!view.next}
						buttons={menuButtons}
						{labels}
						ontoggle={togglePlay}
						onseek={seek}
						onnext={goNext}
						onvolume={(v) => volume(v, true)}
						onmute={mute}
					/>
				</div>
			</div>
		{/if}

		<SkipButton
			on={skipOn}
			label={pb.introOn ? i18n.player_skip_intro() : i18n.player_skip_credits()}
			bottom={cardBottom}
			onclick={() => pb.skip()}
		/>

		{#if pb.upNextOn && view.next && !pb.halt}
			<UpNextCard
				code={i18n.player_up_next_card({ code: view.next.code })}
				title={view.next.title}
				still={view.next.still}
				stillPos={view.next.stillPos}
				poster={view.poster}
				bottom={cardBottom}
				progress={upNextFrac}
				timer={prefs.autoplay}
				timerLabel={i18n.player_next_starts_when_filled()}
				playLabel={prefs.autoplay ? i18n.player_play_now() : i18n.player_play_next()}
				creditsLabel={i18n.player_watch_credits()}
				onplay={goNext}
				oncredits={() => pb.dismissUpNext()}
			/>
		{/if}

		{#if menu}
			<PlayerMenu
				title={MENU_TITLES[menu]()}
				rows={menuRows}
				note={menuNote}
				night={menu === "audio"}
				top={tablet}
				tabs={menuGroup?.map((id) => ({ id, label: MENU_TITLES[id](), on: menu === id }))}
				ontab={(id) => (menu = id as Tab)}
				onpick={pickRow}
				onclose={closeMenu}
			>
				{#if menu === "audio"}
					<Stepper
						label={i18n.player_audio_delay()}
						desc={pb.audioDelay > 0
							? i18n.player_audio_delay_later()
							: i18n.player_audio_delay_earlier()}
						value={fmtOffset(pb.audioDelay, false)}
						zero={pb.audioDelay === 0}
						what={i18n.player_audio()}
						ondec={() => nudgeAudio(-AUDIO_STEP)}
						oninc={() => nudgeAudio(AUDIO_STEP)}
						onreset={() => nudgeAudio(0)}
					/>
				{:else if menu === "subs"}
					<Stepper
						label={i18n.player_sync()}
						desc={pb.subOffset > 0 ? i18n.player_sync_later() : i18n.player_sync_earlier()}
						value={fmtOffset(pb.subOffset, true)}
						zero={pb.subOffset === 0}
						what={i18n.player_subtitles()}
						disabled={pb.subPick === null || !!pb.tracks?.preparing}
						ondec={() => nudgeSub(-SUB_STEP)}
						oninc={() => nudgeSub(SUB_STEP)}
						onreset={() => nudgeSub(0)}
					/>
					<SubtitleStyle
						title={i18n.player_style_title()}
						summary={styleSummary}
						note={styleNote}
						open={styleOpen}
						groups={styleGroups}
						ontoggle={() => (styleOpen = !styleOpen)}
					/>
				{/if}
			</PlayerMenu>
		{/if}

		{#if pb.stats}
			<StatsPanel
				title={i18n.player_stats_title()}
				closeLabel={i18n.player_close_stats()}
				rows={statList}
				left={tablet}
				onclose={() => pb.setStats(false)}
			/>
		{/if}

		{#if pb.halt && haltModel}
			<HaltOverlay
				view={haltModel}
				frame={view.still}
				poster={view.poster}
				framePos={view.framePos ?? "50% 40%"}
				leaving={pb.haltLeaving}
				onaction={haltAction}
				onalt={(id) => pb.halt?.alts?.[Number(id)]?.run()}
			/>
		{/if}

		{#if pb.ended}
			<EndScreen
				frame={view.still}
				framePos={view.framePos ?? "50% 40%"}
				poster={view.poster}
				next={view.next}
				eyebrow={view.season
					? i18n.player_finished_episode({
							episode: i18n.common_episode_code({
								season: view.season,
								episode: view.episode ?? 0,
							}),
						})
					: i18n.player_finished()}
				title={launch.item.titleName}
				more={view.more}
				labels={{
					upNext: view.next ? i18n.player_up_next({ code: view.next.code }) : "",
					playNext: view.next?.label ?? "",
					done: i18n.player_done(),
					again: i18n.player_watch_again(),
					more: i18n.player_more_like_this(),
				}}
				onnext={goNext}
				ondone={exit}
				onreplay={() => pb.replay()}
				onopen={openMore}
			/>
		{/if}
	</div>
{:else}
	<!-- The title and what was watched are still being read: nothing to draw yet but the wait. -->
	<div class="loading">
		<BufferingSpinner label={i18n.player_buffering()} />
	</div>
{/if}

<style>
.stage {
	position: fixed;
	inset: 0;
	overflow: hidden;
	color: var(--player-ink);
	user-select: none;
	-webkit-user-select: none;
}

.failed {
	position: fixed;
	inset: 0;
	display: grid;
	place-items: center;
	background: var(--bg-deep);
}

/* What stands in for the picture until its first frame: the title's backdrop, its poster when
   there is none, dimmed so the spinner and the controls read on it. */
.art {
	position: absolute;
	inset: 0;
	pointer-events: none;
	background: #000 center / cover no-repeat;
}

.art::after {
	content: "";
	position: absolute;
	inset: 0;
	background: rgba(0, 0, 0, 0.55);
}

.loading {
	position: fixed;
	inset: 0;
	background: #000;
	color: var(--player-ink);
}

.surface {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	padding: 0;
	border: 0;
	background: transparent;
	cursor: inherit;
}

.scrim {
	position: absolute;
	inset: 0;
	pointer-events: none;
	background: linear-gradient(
		180deg,
		rgba(0, 0, 0, 0.8) 0%,
		rgba(0, 0, 0, 0.55) 10%,
		rgba(0, 0, 0, 0) 26%,
		rgba(0, 0, 0, 0) 62%,
		var(--player-scrim) 100%
	);
	transition: opacity var(--dur-slow);
}

.cue-wrap {
	position: absolute;
	left: 0;
	right: 0;
	display: flex;
	justify-content: center;
	pointer-events: none;
	transition: bottom 250ms var(--ease);
}

.cue {
	display: inline-block;
	max-width: 80%;
	border-radius: var(--radius-sm);
	font-family: var(--font-sans);
	font-weight: 500;
	line-height: 1.3;
	text-align: center;
	white-space: pre-line;
}

.pf {
	position: absolute;
	inset: 0;
	display: grid;
	place-items: center;
	pointer-events: none;
}

.disc {
	width: 92px;
	height: 92px;
	display: grid;
	place-items: center;
	border-radius: 50%;
	background: rgba(0, 0, 0, 0.6);
	backdrop-filter: blur(12px);
	color: var(--player-ink);
	opacity: 0;
	transform: scale(0.85);
}

.disc.in {
	opacity: 1;
	transform: none;
	transition:
		opacity 120ms var(--ease),
		transform var(--dur-base) var(--ease);
}

.disc.out {
	transition:
		opacity var(--dur-exit) var(--ease-in),
		transform var(--dur-exit) var(--ease-in);
	transform: scale(1.15);
}

.sdisc.out {
	transform: translateX(calc(var(--dir) * 1px));
}

.sk {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 100%;
	display: grid;
	place-items: center;
	pointer-events: none;
}

.sk.half {
	width: 50%;
}

.sk.left {
	left: 0;
}

.sk.right {
	right: 0;
}

.sk-ico {
	grid-area: 1 / 1;
	display: grid;
}

.sk-amt {
	grid-area: 1 / 1;
	font: 700 13px var(--font-mono);
	font-variant-numeric: tabular-nums;
}

.chrome {
	position: absolute;
	inset: 0;
	pointer-events: none;
	transition: opacity var(--dur-slow);
}

/* Leaving is quicker than arriving, so the controls do not linger half-faded over the picture. */
.scrim.off,
.chrome.off {
	transition: opacity 160ms var(--ease-in);
}

.top {
	position: absolute;
	left: 0;
	right: 0;
	top: 0;
	display: flex;
	align-items: center;
	gap: 16px;
	padding: 18px 28px 0;
}

.back {
	width: 44px;
	height: 44px;
	display: grid;
	place-items: center;
	border-radius: 50%;
	border: 0;
	background: var(--player-chip);
	color: var(--player-ink);
	cursor: pointer;
}

.back:hover {
	background: rgba(255, 255, 255, 0.16);
}

.heading {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.name {
	font-size: 17px;
	font-weight: 600;
	letter-spacing: -0.01em;
}

.sub {
	font-size: 13px;
	color: var(--player-ink-muted);
	white-space: nowrap;
}

.grow {
	flex: 1;
}

.pill {
	height: 34px;
	display: flex;
	align-items: center;
	gap: 7px;
	padding: 0 11px;
	border-radius: var(--radius-full);
	border: 1px solid var(--border-strong);
	background: rgba(0, 0, 0, 0.25);
	color: var(--player-ink);
	font: 500 11.5px var(--font-mono);
	cursor: pointer;
	white-space: nowrap;
}

.pill:hover {
	background: rgba(255, 255, 255, 0.14);
}

.pill.on {
	background: color-mix(in srgb, var(--player-accent) 22%, transparent);
}

.dot {
	width: 7px;
	height: 7px;
	border-radius: 50%;
}

.bottom {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	padding: 0 28px 14px;
	display: flex;
	flex-direction: column;
	gap: 6px;
}
</style>
