<script lang="ts">
import {
	AudioLines,
	Captions,
	CaptionsOff,
	ChevronLeft,
	Gauge,
	Pause,
	PictureInPicture2,
	Play,
	RotateCcw,
	RotateCw,
	Settings,
	SkipForward,
} from "@lucide/svelte";
import { onMount } from "svelte";
import { fade } from "svelte/transition";
import { account } from "#lib/core/me.svelte.ts";
import { rememberedThroughput } from "#lib/core/playback/auto.ts";
import { modeName, resBadge, subInfo } from "#lib/core/playback/names.ts";
import type { Launch } from "#lib/core/playback/now-playing.svelte.ts";
import { fmtOffset, panelWords } from "#lib/core/playback/panel-words.ts";
import { type Playback, UP_NEXT_SECS } from "#lib/core/playback/playback.svelte.ts";
import { DEFAULT_SIZE_PX, SIZE_PX } from "#lib/core/playback/rules.ts";
import {
	audioRows,
	haltView,
	qualityRows,
	speedRows,
	statsRows,
	subtitleRows,
} from "#lib/core/player-panels.ts";
import { clock, SEEK_STEP, type SeekFlash, seekFlash, segments } from "#lib/core/player-view.ts";
import { prefs, setPref as savePref } from "#lib/core/prefs.svelte.ts";
import { toast } from "#lib/core/toast.svelte.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import BufferingSpinner from "#lib/ui/BufferingSpinner.svelte";
import EndScreen from "#lib/ui/EndScreen.svelte";
import HaltOverlay from "#lib/ui/HaltOverlay.svelte";
import { goto } from "#lib/ui/nav.ts";
import Osd from "#lib/ui/Osd.svelte";
import PlayerMenu from "#lib/ui/PlayerMenu.svelte";
import SkipButton from "#lib/ui/SkipButton.svelte";
import StatsPanel from "#lib/ui/StatsPanel.svelte";
import Stepper from "#lib/ui/Stepper.svelte";
import SubtitleStyle from "#lib/ui/SubtitleStyle.svelte";
import UpNextCard from "#lib/ui/UpNextCard.svelte";
import { adminScan, canDownload, playbackPort } from "#platform";

type Tab = "subs" | "audio" | "quality" | "speed";
type Flash = { ph: "idle" | "in" | "out"; amt: number; rot: number };

let {
	pb,
	launch,
	onexit,
	onpip,
	onnext,
	onopen,
}: {
	pb: Playback;
	launch: Launch;
	onexit: () => void;
	onpip: () => void;
	onnext: () => void;
	onopen: (href: string) => void;
} = $props();

const HIDE_MS = 3200;
const OSD_MS = 900;
const MAX_EXTRAPOLATION = 1.5;
const SUB_STEP = 0.1;
const AUDIO_STEP = 10;
const CUE_SCALE = 0.72;
const CUE_BOTTOM = { shown: 96, hidden: 30 };
const CARD_BOTTOM = { shown: 86, hidden: 24 };
const TONE = {
	ok: "var(--status-available)",
	conv: "var(--status-downloading)",
	warn: "var(--status-warning)",
};
const STYLE_LABEL: Record<string, () => string> = {
	None: i18n.player_style_bg_none,
	Shadow: i18n.player_style_bg_shadow,
	Box: i18n.player_style_bg_box,
	White: i18n.player_style_color_white,
	Yellow: i18n.player_style_color_yellow,
};
const styleText = (v: string) => STYLE_LABEL[v]?.() ?? v;
const TAB_TITLES: Record<Tab, () => string> = {
	audio: i18n.player_audio,
	subs: i18n.player_subtitles,
	quality: i18n.player_quality,
	speed: i18n.player_speed,
};
const words = panelWords(playbackPort.playerName);

let controls = $state(true);
let menu = $state<Tab | null>(null);
let styleOpen = $state(false);
let osd = $state<string | null>(null);
let skL = $state<Flash>({ ph: "idle", amt: 0, rot: 0 });
let skR = $state<Flash>({ ph: "idle", amt: 0, rot: 0 });
let frameAt = $state(0);
let drag = $state<number | null>(null);

let lastMove = Date.now();
let osdTimer: ReturnType<typeof setTimeout> | undefined;
let seekTimer: ReturnType<typeof setTimeout> | undefined;
let run: SeekFlash | null = null;

const view = $derived(launch.view);
const controlsOn = $derived(controls || (!pb.playing && !pb.buffering) || menu !== null);
const showBar = $derived(controlsOn && !pb.ended && !pb.halt);
const duration = $derived(pb.duration);
const shown = $derived(
	pb.playing
		? Math.min(
				pb.duration || Infinity,
				pb.position +
					Math.min(MAX_EXTRAPOLATION, Math.max(0, ((frameAt - pb.positionAt) / 1000) * pb.speed)),
			)
		: pb.position,
);
const at = $derived(drag !== null ? drag * duration : shown);
const pct = $derived(duration > 0 ? Math.min(100, (at / duration) * 100) : 0);
const segs = $derived(segments(duration, pb.tracks?.chapters ?? []));
const upNextFrac = $derived(
	pb.creditsAt === null ? 0 : Math.min(1, Math.max(0, (shown - pb.creditsAt) / UP_NEXT_SECS)),
);
const skipOn = $derived(((pb.introOn && !prefs.autoSkip) || pb.creditsOn) && !pb.ended && !pb.halt);
const cardBottom = $derived(showBar ? CARD_BOTTOM.shown : CARD_BOTTOM.hidden);
const cueBottom = $derived(showBar ? CUE_BOTTOM.shown : CUE_BOTTOM.hidden);

export function show() {
	lastMove = Date.now();
	controls = true;
}

export function flash(text: string) {
	clearTimeout(osdTimer);
	osd = text;
	osdTimer = setTimeout(() => (osd = null), OSD_MS);
}

onMount(() => {
	const hide = setInterval(() => {
		if (controls && pb.playing && !menu && drag === null && Date.now() - lastMove > HIDE_MS)
			controls = false;
	}, 250);
	return () => {
		clearInterval(hide);
		clearTimeout(osdTimer);
		clearTimeout(seekTimer);
	};
});

$effect(() => {
	if (!pb.playing || !(controlsOn || pb.upNextOn)) return;
	let raf = requestAnimationFrame(function tick(t) {
		frameAt = t;
		raf = requestAnimationFrame(tick);
	});
	return () => cancelAnimationFrame(raf);
});

$effect(() => {
	const px = showBar ? CUE_BOTTOM.shown - CUE_BOTTOM.hidden : 0;
	playbackPort.command("subtitleLift", { px }).catch(() => {});
});

$effect(() => {
	if (pb.halt) closeMenu();
});

// A second tap on the same side within this long is that side's skip button, and so is each tap after it.
const DOUBLE_TAP_MS = 320;
const SIDE = 0.4;
let lastTap = { side: 0, at: 0, running: false, controls: true };

function tap(e: MouseEvent) {
	if (menu) return closeMenu();
	const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
	const x = (e.clientX - r.left) / r.width;
	const side = x < SIDE ? -1 : x > 1 - SIDE ? 1 : 0;
	const now = Date.now();
	if (side !== 0 && lastTap.side === side && now - lastTap.at < DOUBLE_TAP_MS && !pb.ended) {
		// The pair's first tap toggled the controls: put them back as they were.
		if (!lastTap.running) controls = lastTap.controls;
		lastTap = { ...lastTap, at: now, running: true };
		seek(side * SEEK_STEP);
		return;
	}
	lastTap = { side, at: now, running: false, controls };
	controls = !controlsOn || !pb.playing ? true : !controls;
	lastMove = Date.now();
}

function togglePlay() {
	if (pb.ended || pb.halt) return;
	pb.togglePlay();
	show();
}

function seek(delta: number) {
	pb.seek(delta);
	const left = delta < 0;
	const next = seekFlash(run, left ? "left" : "right", Date.now());
	const cur = left ? skL : skR;
	const continued = run !== null && next.amount > Math.abs(delta) && cur.ph !== "idle";
	run = next;
	const flashed: Flash = {
		ph: "in",
		amt: next.amount,
		rot: (continued ? cur.rot : 0) + (left ? -360 : 360),
	};
	if (left) {
		skL = flashed;
		if (skR.ph === "in") skR = { ...skR, ph: "out" };
	} else {
		skR = flashed;
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

function openMenu(tab: Tab) {
	show();
	if (menu === tab) return closeMenu();
	menu = tab;
}

function closeMenu() {
	menu = null;
}

// A tap beside an open panel also lands on the control under it, so one tap is enough to pause or leave.
function catchTap(e: MouseEvent) {
	const el = e.currentTarget as HTMLElement;
	el.style.pointerEvents = "none";
	const under = document.elementFromPoint(e.clientX, e.clientY)?.closest("button");
	el.style.pointerEvents = "";
	const was = menu;
	if (under && !under.classList.contains("surface")) under.click();
	if (menu === was) closeMenu();
}

const ratio = (e: PointerEvent) => {
	const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
	return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
};

function scrubEnd(e: PointerEvent) {
	if (drag === null) return;
	const r = ratio(e);
	drag = null;
	pb.seekTo(r * duration);
	show();
}

const within = (pos: number, s: { from: number; to: number }) =>
	s.to > s.from && duration > 0
		? Math.max(0, Math.min(100, ((pos / duration - s.from) / (s.to - s.from)) * 100))
		: 0;

const modeLabel = $derived.by(() => {
	const s = pb.session;
	if (!s) return "";
	const { width, height, hdr, dv_profile } = s.video;
	const size = resBadge(width, height);
	if (prefs.techDetails) {
		const range = dv_profile !== undefined ? " DV" : hdr === "sdr" ? "" : " HDR";
		return `${size}${range} · ${modeName(s.mode).toLowerCase()}`;
	}
	const range = dv_profile !== undefined ? " · Dolby Vision" : hdr === "sdr" ? "" : " · HDR";
	return `${size}${range}`;
});

const selectedSub = $derived(pb.tracks?.subtitles.find((t) => t.index === pb.subPick) ?? null);
const subKind = $derived(pb.burn ? "burn" : selectedSub ? subInfo(selectedSub).kind : "text");
const cue = $derived.by(() => {
	const bg = prefs.subBg;
	const base =
		subKind === "text" || subKind === "styled"
			? (SIZE_PX[prefs.subSize] ?? DEFAULT_SIZE_PX)
			: DEFAULT_SIZE_PX;
	return {
		size: Math.round(base * CUE_SCALE),
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

const audioList = $derived(
	audioRows(pb.tracks, pb.selectedAudio, pb.preview, pb.session, words, pb.passthrough),
);
const subList = $derived(subtitleRows(pb.tracks, pb.subPick, words));
const qualityList = $derived(
	qualityRows(
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
	),
);
const speedList = $derived(speedRows(pb.speed, words));
const menuRows = $derived(
	menu === "audio"
		? audioList
		: menu === "subs"
			? subList
			: menu === "quality"
				? qualityList
				: speedList,
);
const menuNote = $derived.by(() => {
	const session = pb.session;
	if (!session) return undefined;
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
	if (step === 0) pb.resetTiming("sub");
	else pb.nudgeSub(step);
	show();
	flash(i18n.player_osd_subtitles({ offset: fmtOffset(pb.subOffset, true) }));
}

function nudgeAudio(step: number) {
	if (step === 0) pb.resetTiming("audio");
	else pb.nudgeAudio(step);
	show();
	flash(i18n.player_osd_audio({ offset: fmtOffset(pb.audioDelay, false) }));
}

function setStyle(key: "subSize" | "subBg" | "subColor", value: string) {
	savePref(key, value);
	pb.syncTiming();
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
	if (!pb.session) return [];
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
	pb.halt
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
	if (id === "retry") pb.retry();
	else if (id === "back") onexit();
	else if (id === "downloads") goto("/downloads");
	else if (id === "server-settings") goto("/admin");
	else if (id === "scan") {
		adminScan().then(
			() => toast(i18n.halt_toast_scan_started()),
			() => {},
		);
		onexit();
	}
}

const labels = $derived({
	toggle: pb.playing ? i18n.player_pause() : i18n.player_play(),
});
</script>

<div class="stage">
	<button
		type="button"
		class="surface"
		tabindex="-1"
		aria-label={labels.toggle}
		onclick={tap}
	></button>
	{#if !pb.picture && !pb.ended && !pb.halt}
		<div
			class="art"
			style:background-image="url({JSON.stringify(view.still)}), url({JSON.stringify(
				view.poster ?? "",
			)})"
		></div>
	{/if}
	<div class="scrim" class:off={!showBar} style:opacity={showBar ? 1 : 0}></div>

	{#if pb.buffering && !pb.ended}
		<BufferingSpinner label={i18n.player_buffering()} />
	{/if}

	{#if pb.cueText && !pb.ended && !pb.halt}
		<div class="cue-wrap" style:bottom="{cueBottom}px">
			<span
				class="cue"
				style:font-size="{cue.size}px"
				style:color={cue.color}
				style:text-shadow={cue.shadow}
				style:background={cue.background}
				style:padding={cue.padding}
				>{pb.cueText}</span
			>
		</div>
	{/if}

	{#if osd && !showBar}
		<Osd text={osd} />
	{/if}

	<div class="center" class:live={showBar}>
		{#each [
			{ f: skL, step: -SEEK_STEP, label: i18n.player_back_10(), icon: RotateCcw },
			{ f: skR, step: SEEK_STEP, label: i18n.player_forward_10(), icon: RotateCw },
		] as k, i (k.step)}
			{#if i === 1}
				<button
					type="button"
					class="toggle"
					class:shown={showBar}
					aria-label={labels.toggle}
					onclick={togglePlay}
				>
					{#if pb.playing}
						<Pause size={32} fill="currentColor" strokeWidth={0} />
					{:else}
						<Play size={32} fill="currentColor" strokeWidth={0} />
					{/if}
				</button>
			{/if}
			<button
				type="button"
				class="seek"
				class:shown={showBar || k.f.ph === "in"}
				class:hit={k.f.ph === "in"}
				aria-label={k.label}
				onclick={() => seek(k.step)}
			>
				<span
					class="turn"
					style:transform="rotate({k.f.rot}deg)"
					style:transition={k.f.ph === "idle" ? "none" : "transform 450ms var(--ease)"}
					><k.icon size={28} strokeWidth={1.6} /></span
				><span>{k.f.ph !== "idle" && k.f.amt ? k.f.amt : SEEK_STEP}</span>
			</button>
		{/each}
	</div>

	<div class="chrome" class:off={!showBar} style:opacity={showBar ? 1 : 0}>
		<div class="top" class:live={showBar}>
			<button type="button" class="back" aria-label={i18n.common_back()} onclick={onexit}>
				<ChevronLeft size={24} strokeWidth={2} />
			</button>
			<span class="heading">
				<span class="name">{launch.item.titleName}</span>
				<span class="sub">{view.sub ?? view.eyebrow}</span>
			</span>
			<span class="grow"></span>
			<button
				type="button"
				class="round"
				class:on={pb.subPick !== null || menu === "subs"}
				aria-label={i18n.player_subtitles()}
				onclick={() => openMenu("subs")}
			>
				{#if pb.subPick === null}
					<CaptionsOff size={22} strokeWidth={1.75} />
				{:else}
					<Captions size={22} strokeWidth={1.75} />
				{/if}
			</button>
			{#each [
				{ tab: "audio", label: i18n.player_audio(), icon: AudioLines },
				{ tab: "quality", label: i18n.player_quality(), icon: Settings },
				{ tab: "speed", label: i18n.player_speed(), icon: Gauge },
			] as const as b (b.tab)}
				<button
					type="button"
					class="round"
					class:on={menu === b.tab}
					aria-label={b.label}
					onclick={() => openMenu(b.tab)}
				>
					<b.icon size={22} strokeWidth={1.75} />
				</button>
			{/each}
			<button
				type="button"
				class="round"
				aria-label={i18n.player_pip()}
				disabled={pb.ended || !!pb.halt}
				onclick={onpip}
			>
				<PictureInPicture2 size={22} strokeWidth={1.75} />
			</button>
		</div>

		<div class="bottom" class:live={showBar}>
			<div class="times">
				<span class="cur">{clock(at, duration)}</span>
				<div
					class="scrub"
					role="slider"
					tabindex="-1"
					aria-label={i18n.player_seek()}
					aria-valuemin="0"
					aria-valuemax={Math.round(duration)}
					aria-valuenow={Math.round(at)}
					onpointerdown={(e) => {
						(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
						drag = ratio(e);
						show();
					}}
					onpointermove={(e) => {
						if (drag !== null) drag = ratio(e);
					}}
					onpointerup={scrubEnd}
					onpointercancel={() => (drag = null)}
				>
					<div class="track">
						{#each segs as s}
							<div class="seg" style:flex={s.to - s.from}>
								<div class="fill" style:width="{within(at, s)}%"></div>
							</div>
						{/each}
					</div>
					<div class="thumb" style:left="{pct}%"></div>
				</div>
				<span class="remaining">-{clock(duration - at, duration)}</span>
			</div>
			<div class="meta">
				{#if modeLabel}
					<button
						type="button"
						class="quality"
						aria-label={i18n.player_stats_title()}
						onclick={() => pb.setStats(!pb.stats)}
					>
						{#if prefs.techDetails}
							<span
								class="dot"
								style:background={pb.full ? "var(--status-available)" : "var(--status-downloading)"}
							></span>
						{/if}
						{modeLabel}
					</button>
					<span class="faint">·</span>
				{/if}
				<span class="chapter">{pb.chapterName}</span>
				<span class="grow"></span>
				{#if view.next}
					<button type="button" class="next" onclick={onnext}>
						<SkipForward size={16} fill="currentColor" strokeWidth={0} />
						{i18n.player_next_episode()}
					</button>
				{/if}
			</div>
		</div>
	</div>

	<div class="zoomed cards">
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
				onplay={onnext}
				oncredits={() => pb.dismissUpNext()}
			/>
		{/if}
	</div>

	{#if pb.stats}
		<div class="zoomed stats">
			<StatsPanel
				title={i18n.player_stats_title()}
				closeLabel={i18n.player_close_stats()}
				rows={statList}
				onclose={() => pb.setStats(false)}
			/>
		</div>
	{/if}

	{#if menu}
		<button
			type="button"
			class="catch"
			tabindex="-1"
			aria-label={i18n.player_close()}
			transition:fade={{ duration: 180 }}
			onclick={catchTap}
		></button>
		<PlayerMenu
			sheet
			title={TAB_TITLES[menu]()}
			rows={menuRows}
			note={menuNote}
			night={menu === "audio"}
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

	{#if pb.halt && haltModel}
		<div class="zoomed overlay">
			<HaltOverlay
				view={haltModel}
				frame={view.still}
				poster={view.poster ?? ""}
				framePos={view.framePos ?? "50% 40%"}
				leaving={pb.haltLeaving}
				onaction={haltAction}
				onalt={(i) => pb.halt?.alts?.[Number(i)]?.run()}
			/>
		</div>
	{/if}

	{#if pb.ended}
		<div class="zoomed overlay">
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
				{onnext}
				ondone={onexit}
				onreplay={() => pb.replay()}
				{onopen}
			/>
		</div>
	{/if}
</div>

<style>
.stage {
	position: fixed;
	inset: 0;
	overflow: hidden;
	color: var(--player-ink);
	user-select: none;
	-webkit-user-select: none;
	touch-action: manipulation;
	-webkit-tap-highlight-color: transparent;
}

.surface {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	padding: 0;
	border: 0;
	background: transparent;
}

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

.scrim.off,
.chrome.off {
	transition: opacity 160ms var(--ease-in);
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

.chrome {
	position: absolute;
	inset: 0;
	pointer-events: none;
	transition: opacity var(--dur-slow);
}

.top {
	position: absolute;
	left: 0;
	right: 0;
	top: 0;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: calc(14px + env(safe-area-inset-top)) 56px 0 60px;
}

.top.live,
.center.live,
.bottom.live {
	pointer-events: auto;
}

.back,
.round {
	width: 44px;
	height: 44px;
	display: grid;
	place-items: center;
	flex: none;
	border: 0;
	border-radius: 50%;
	background: transparent;
	color: var(--player-ink);
}

.back {
	margin-left: -8px;
}

.round.on {
	background: color-mix(in srgb, var(--player-accent) 22%, transparent);
}

.round:disabled {
	opacity: 0.5;
}

.heading {
	min-width: 0;
	display: flex;
	flex-direction: column;
	line-height: 1.25;
}

.name {
	font-size: 15px;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.sub {
	font-size: 12px;
	color: var(--player-ink-muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.grow {
	flex: 1;
}

.center {
	pointer-events: none;
	position: absolute;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
	display: flex;
	align-items: center;
	gap: 56px;
}

.seek,
.toggle {
	display: grid;
	place-items: center;
	border: 0;
	border-radius: 50%;
	color: var(--player-ink);
	opacity: 0;
	transition:
		opacity var(--dur-slow),
		background 150ms,
		transform 150ms var(--ease);
}

.seek.shown,
.toggle.shown {
	opacity: 1;
}

.seek {
	width: 52px;
	height: 52px;
	background: rgba(0, 0, 0, 0.3);
}

/* A skip shows on its own button, which stays up while the rest of the controls are hidden. */
.seek.hit {
	background: rgba(0, 0, 0, 0.6);
	transform: scale(1.12);
}

.seek span {
	grid-area: 1 / 1;
	display: grid;
}

.seek span {
	font: 700 8.5px / 1 var(--font-mono);
	font-variant-numeric: tabular-nums;
}

.toggle {
	width: 70px;
	height: 70px;
	background: rgba(0, 0, 0, 0.35);
	box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.25);
}

.bottom {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	padding: 0 60px calc(16px + env(safe-area-inset-bottom));
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.times {
	display: flex;
	align-items: center;
	gap: 12px;
}

.cur,
.remaining {
	flex: none;
	font: 500 12px var(--font-mono);
}

.cur {
	width: 56px;
}

.remaining {
	width: 60px;
	text-align: right;
	color: var(--player-ink-muted);
}

.scrub {
	position: relative;
	flex: 1;
	height: 30px;
	display: flex;
	align-items: center;
	touch-action: none;
}

.track {
	position: relative;
	flex: 1;
	height: 4px;
	display: flex;
	gap: 2px;
}

.seg {
	position: relative;
	height: 100%;
	border-radius: 2px;
	background: var(--player-buffer);
	overflow: hidden;
}

.fill {
	position: absolute;
	left: 0;
	top: 0;
	bottom: 0;
	background: var(--player-accent);
}

.thumb {
	position: absolute;
	top: 50%;
	width: 16px;
	height: 16px;
	margin: -8px 0 0 -8px;
	border-radius: 50%;
	background: var(--player-ink);
}

.meta {
	display: flex;
	align-items: center;
	gap: 6px;
	font: 500 11.5px var(--font-mono);
	color: var(--player-ink-muted);
}

.quality {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 0;
	border: 0;
	background: transparent;
	color: inherit;
	font: inherit;
	white-space: nowrap;
}

.dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
}

.faint {
	color: var(--fg-faint);
}

.chapter {
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.next {
	flex: none;
	height: 36px;
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 0 10px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--player-ink);
	font: 600 12.5px var(--font-sans);
	white-space: nowrap;
}

.catch {
	position: absolute;
	inset: 0;
	padding: 0;
	border: 0;
	background: rgba(0, 0, 0, 0.35);
}

.zoomed {
	position: absolute;
	inset: 0;
	zoom: 0.85;
	pointer-events: none;
}

.zoomed > :global(*) {
	pointer-events: auto;
}

.cards :global(.slot),
.cards :global(.card) {
	right: 60px;
}

.stats :global(.sl-stats) {
	left: 60px;
	right: auto;
	top: 64px;
	transform-origin: 0 0;
}

.overlay :global(div.body),
.overlay :global(.zoom) {
	padding: 0 70px;
}

.overlay :global(.finished) {
	gap: 22px;
}

.overlay :global(.still) {
	width: 300px;
}

.overlay :global(.poster) {
	width: 84px;
}
</style>
