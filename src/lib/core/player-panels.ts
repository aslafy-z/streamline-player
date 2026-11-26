import type { Halt, HaltIcon } from "#lib/core/playback/halt.ts";
import type { Preview } from "#lib/core/playback/playback.svelte.ts";
import type {
	AudioTrack,
	Reason,
	Session,
	Stats,
	SubKind,
	SubTrack,
	Tracks,
} from "#lib/core/playback/port.ts";
import type { Decision } from "#lib/core/types.ts";

export type Tone = "ok" | "conv" | "warn";
export type Row = {
	id: string;
	label: string;
	sub?: string;
	badge?: string;
	tone?: Tone;
	pill?: string;
	busy?: boolean;
	on: boolean;
	disabled?: boolean;
};

/** Every label the panels show, worded by the caller: `core` stays free of the message catalogue. */
export type Words = {
	off: string;
	preparing: string;
	original: string;
	auto: string;
	asIs: string;
	converted: string;
	convertsVideo: string;
	normal: string;
	measuring: string;
	statLabels: Record<
		| "mode"
		| "player"
		| "video"
		| "audio"
		| "container"
		| "why"
		| "encode"
		| "subtitles"
		| "offsets"
		| "bitrate"
		| "throughput"
		| "buffer"
		| "frames"
		| "speed"
		| "server",
		string
	>;
	language(code: string): string;
	originalLanguage(code: string): string;
	times(x: number): string;
	mbit(value: number | string): string;
	rate(bitsPerSecond: number): string;
	digits(n: number, d: number): string;
	number(n: number): string;
	modeName(mode: Session["mode"]): string;
	audioName(t: AudioTrack): string;
	audioOut(s: { audio: Session["audio"] }): string;
	videoName(codec: string, width: number, height: number): string;
	videoIn(video: NonNullable<Tracks["video"]>): string;
	videoOut(s: Session, profile?: string): string;
	originalName(video: Tracks["video"]): string;
	fileRate(bitRate: number): string;
	subName(t: SubTrack): string;
	subInfo(t: SubTrack): { kind: SubKind; label: string; fmt: string; burnOnly?: boolean };
	subSdh(label: string): string;
	subBurnIn(label: string): string;
	subRenderer(kind: SubKind): string;
	sameAsOriginal(size: string): string;
	originalUnavailable(reason: string): string;
	autoNow(quality: string, why: string): string;
	autoNowOnly(quality: string): string;
	autoBasedOnConnection: string;
	autoCappedOnCellular?: string;
	awayFromHome?: string;
	autoConnectionAllows: string;
	originalFile: string;
	nothingConverted: string;
	statAsIs: string;
	passThrough?: string;
	fileItself: string;
	audioOnly: string;
	burnedIn: string;
	notPlayable(container: string): string;
	realtime(speed: string): string;
	bufferAhead(seconds: string): string;
	frames(dropped: string, rendered: string): string;
	bitrateVideo(rate: string): string;
	bitrateAudio(rate: string): string;
	offsets(subtitles: string, audio: string): string;
	offsetSeconds(v: number): string;
	offsetMs(v: number): string;
	backTo(title: string): string;
	openServerSettings?: string;
	/** What an admin can do about a halt, and the notes that say so instead of "ask your admin". */
	scanLibrary?: string;
	adminNotes?: { missing: string; nocodec: string };
	/** Said after the offline halt's body, and the button that goes to the downloads, where the device has any. */
	downloadsStillPlay?: string;
	watchDownload?: string;
};

const toneOf = (d?: Decision): Tone => (d && !d.error && !d.needs_slot ? "ok" : "conv");
const badgeOf = (d: Decision | undefined, w: Words) =>
	d && !d.error ? w.modeName(d.mode).toLocaleLowerCase() : undefined;

export function audioRows(
	tracks: Tracks | null,
	pick: AudioTrack | null,
	preview: Preview | null,
	session: Session | null,
	w: Words,
	passthrough: string[] = [],
): Row[] {
	return (tracks?.audio ?? []).map((t, i) => {
		const d = preview?.audio[t.index];
		const out = d && !d.error ? d : t.index === pick?.index ? session : null;
		const asIs = out?.audio.action === "copy";
		return {
			id: String(t.index),
			label: i === 0 ? w.originalLanguage(t.language) : w.language(t.language),
			sub:
				out && !asIs
					? `${w.audioName(t)} → ${w.audioOut(out)}`
					: asIs && w.passThrough && passthrough.includes(out.audio.codec)
						? `${w.audioName(t)} · ${w.passThrough}`
						: w.audioName(t),
			badge: out ? (asIs ? w.asIs : w.converted) : undefined,
			tone: asIs ? "ok" : "conv",
			on: t.index === pick?.index,
		};
	});
}

export function subtitleRows(tracks: Tracks | null, pick: number | null, w: Words): Row[] {
	const rows: Row[] = [{ id: "off", label: w.off, on: pick === null }];
	for (const t of tracks?.subtitles ?? []) {
		const info = w.subInfo(t);
		const id = String(t.index);
		if (tracks?.preparing && !info.burnOnly)
			rows.push({
				id,
				label: w.subName(t),
				sub: w.preparing,
				busy: true,
				on: false,
				disabled: true,
			});
		else if (info.burnOnly)
			rows.push({
				id,
				label: w.subName(t),
				sub: w.subBurnIn(info.label),
				badge: w.convertsVideo,
				tone: "warn",
				on: pick === t.index,
			});
		else
			rows.push({
				id,
				label: w.subName(t),
				sub: t.sdh ? w.subSdh(info.label) : info.label,
				on: pick === t.index,
			});
	}
	return rows;
}

export type QualityInput = {
	qSel: "auto" | "original" | number;
	autoPick: number | null | undefined;
	measuredOnce: boolean;
	originalPlays: boolean;
	preview: Preview | null;
	tracks: Tracks | null;
	mobileLimit?: number | null;
};

export const PRESET_RATES = [20, 8, 4, 2, 1];

export function qualityRows(q: QualityInput, w: Words): Row[] {
	const { preview } = q;
	const fileRate = preview ? w.fileRate(preview.bitRate) : "";
	const original = preview?.original;
	const autoDecision = q.autoPick ? preview?.presets[q.autoPick] : original;
	const why =
		original && !original.error && !q.originalPlays
			? (original.video_reasons[0]?.text ?? "")
			: q.autoPick && q.autoPick === q.mobileLimit && w.autoCappedOnCellular
				? w.autoCappedOnCellular
				: w.autoBasedOnConnection;
	let autoSub: string;
	if (q.autoPick) autoSub = w.autoNow(w.mbit(q.autoPick), why);
	else if (!original || original.error || q.originalPlays)
		autoSub = q.measuredOnce
			? w.autoNow(w.original, w.autoConnectionAllows)
			: w.autoNowOnly(w.original);
	else
		autoSub = w.autoNow(
			w.videoName(original.video.codec, original.video.width, original.video.height),
			why,
		);

	const rows: Row[] = [
		{
			id: "auto",
			label: w.auto,
			sub: autoSub,
			badge: badgeOf(autoDecision, w),
			tone: toneOf(autoDecision),
			on: q.qSel === "auto",
		},
	];
	if (q.originalPlays)
		rows.push({
			id: "original",
			label: w.original,
			sub: `${w.originalName(q.tracks?.video ?? null)}${fileRate ? ` · ${fileRate}` : ""}`,
			badge: badgeOf(original, w),
			tone: toneOf(original),
			on: q.qSel === "original",
		});
	else
		rows.push({
			id: "original",
			label: w.original,
			sub: w.originalUnavailable(
				original && !original.error ? (original.video_reasons[0]?.text ?? "") : "",
			),
			on: false,
			disabled: true,
		});
	for (const n of PRESET_RATES) {
		const d = preview?.presets[n];
		const converted = !!d && !d.error && d.video.action !== "copy";
		rows.push({
			id: String(n),
			label: w.mbit(n),
			sub:
				!d || d.error
					? (d?.error.message ?? "")
					: d.video.action === "copy"
						? w.sameAsOriginal(fileRate)
						: w.videoName(d.video.codec, d.video.width, d.video.height),
			badge: badgeOf(d, w),
			tone: toneOf(d),
			pill: converted && d && !d.error && d.video.hdr !== "sdr" ? "HDR" : undefined,
			on: q.qSel === n,
		});
	}
	return rows;
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const speedRows = (speed: number, w: Words): Row[] =>
	SPEEDS.map((x) => ({
		id: String(x),
		label: x === 1 ? w.normal : w.times(x),
		on: speed === x,
	}));

export type StatRow = { label: string; value: string; why?: boolean; color?: string };

export type StatsInput = {
	session: Session | null;
	live: Stats | null;
	encodeSpeed: number | null;
	tracks: Tracks | null;
	selectedAudio: AudioTrack | null;
	subPick: number | null;
	burn: boolean;
	subOffset: number;
	audioDelay: number;
	measured: number | null;
	/** What this network last measured, when nothing was measured in this playback. */
	throughput: number | null;
	away?: boolean;
	/** The audio goes to the TV or receiver undecoded. */
	passAudio?: boolean;
	host: string;
	playerName: string;
	full: boolean;
	speed: number;
};

const SLOW_THROUGHPUT = 4_000_000;

/** The design's order. `Display` belongs to the TV's rows and is never here. */
export function statsRows(s: StatsInput, w: Words): StatRow[] {
	const { session, tracks, live, selectedAudio, encodeSpeed } = s;
	if (!session) return [];
	const L = w.statLabels;
	const copy = session.video.action === "copy";
	const direct = session.mode === "direct";
	const box = tracks?.container.toUpperCase() ?? "";
	const inName = tracks?.video ? w.videoIn(tracks.video) : "";
	const outName = w.videoOut(session, copy ? tracks?.video?.profile : undefined);
	const audioIn = selectedAudio ? w.audioName(selectedAudio) : "";
	const audioCopy = session.audio.action === "copy";
	const why = (list: Reason[]): StatRow[] =>
		list.length ? [{ label: L.why, value: list.map((r) => r.text).join(" · "), why: true }] : [];
	const selectedSub: SubTrack | null = tracks?.subtitles.find((t) => t.index === s.subPick) ?? null;
	const known = [
		live && live.videoBitrate > 0 && w.bitrateVideo(w.rate(live.videoBitrate)),
		live && live.audioBitrate > 0 && w.bitrateAudio(w.rate(live.audioBitrate)),
	].filter(Boolean);

	const rows: StatRow[] = [
		{
			label: L.mode,
			value: `${w.modeName(session.mode)}${direct ? ` · ${w.originalFile}` : session.mode === "remux" ? ` · ${w.nothingConverted}` : ""}`,
			color: s.full ? "var(--status-available)" : "var(--status-downloading)",
		},
		{ label: L.player, value: live?.player ?? s.playerName },
		{
			label: L.video,
			value: copy ? `${outName} · ${w.statAsIs}` : `${inName} → ${outName}`,
			color: "var(--player-ink)",
		},
		...(copy ? [] : why(session.video_reasons)),
		{
			label: L.audio,
			value: audioCopy
				? `${audioIn} · ${s.passAudio && w.passThrough ? w.passThrough : w.statAsIs}`
				: `${audioIn} → ${w.audioOut(session)}`,
			color: "var(--player-ink)",
		},
		...(audioCopy ? [] : why(session.audio_reasons)),
		{
			label: L.container,
			value: direct ? `${box} · ${w.fileItself}` : `${box} → fMP4 · HLS`,
		},
		...(session.mode === "remux" ? [{ label: L.why, value: w.notPlayable(box), why: true }] : []),
		...(encodeSpeed === null
			? []
			: [
					{
						label: L.encode,
						value: `${w.realtime(w.digits(encodeSpeed, 1))} · ${copy ? w.audioOnly : session.hw.toUpperCase()}`,
						color:
							encodeSpeed >= 1.2
								? "var(--status-available)"
								: encodeSpeed >= 1
									? "var(--status-warning)"
									: "var(--status-failed)",
					},
				]),
		{
			label: L.subtitles,
			value: tracks?.preparing
				? w.preparing
				: selectedSub
					? `${w.subName(selectedSub)} · ${w.subInfo(selectedSub).fmt} · ${s.burn ? w.burnedIn : w.subRenderer(w.subInfo(selectedSub).kind)}`
					: w.off,
		},
		...(s.subOffset || s.audioDelay
			? [
					{
						label: L.offsets,
						value: w.offsets(w.offsetSeconds(s.subOffset), w.offsetMs(s.audioDelay)),
					},
				]
			: []),
		...(known.length ? [{ label: L.bitrate, value: known.join(" · ") }] : []),
	];
	if (live) {
		const speed = s.measured ?? s.throughput;
		rows.push(
			{
				label: L.throughput,
				value:
					speed === null
						? w.measuring
						: s.away && w.awayFromHome
							? `${w.rate(speed)} · ${w.awayFromHome}`
							: w.rate(speed),
				color: speed !== null && speed < SLOW_THROUGHPUT ? "var(--status-warning)" : undefined,
			},
			{ label: L.buffer, value: w.bufferAhead(w.digits(live.buffer, 1)) },
			{ label: L.frames, value: w.frames(w.number(live.dropped), w.number(live.rendered)) },
		);
	}
	rows.push(
		{ label: L.speed, value: w.times(s.speed) },
		{ label: L.server, value: `${s.host} · ${direct ? "/file" : "/hls"}` },
	);
	return rows;
}

export type HaltContext = {
	title: string;
	host: string;
	position: number;
	isAdmin: boolean;
	routes: { serverSettings: boolean };
	canDownload?: boolean;
};

export type HaltAction = { id: string; label: string; primary?: boolean };
export type HaltViewModel = {
	kind: Halt["kind"];
	failed: boolean;
	icon: HaltIcon;
	eyebrow: string;
	title: string;
	body?: string;
	mono?: string;
	note?: string;
	wait?: string;
	countdown?: { text: string; fraction: number };
	message?: { by: string; text: string };
	actions: HaltAction[];
	alternatives?: { id: string; icon: HaltIcon; label: string; sub: string }[];
};

export function haltView(h: Halt, ctx: HaltContext, w: Words): HaltViewModel {
	const actions: HaltAction[] = [];
	if (h.retryLabel) actions.push({ id: "retry", label: h.retryLabel, primary: true });
	if (h.kind === "nocodec" && ctx.isAdmin && ctx.routes.serverSettings && w.openServerSettings)
		actions.push({ id: "server-settings", label: w.openServerSettings, primary: true });
	if (h.kind === "missing" && ctx.isAdmin && ctx.routes.serverSettings && w.scanLibrary)
		actions.push({ id: "scan", label: w.scanLibrary, primary: true });
	const adminNote =
		ctx.isAdmin && (h.kind === "missing" || h.kind === "nocodec")
			? w.adminNotes?.[h.kind]
			: undefined;
	const offline = h.kind === "offline" && ctx.canDownload;
	if (ctx.canDownload && (h.kind === "offline" || h.kind === "unreachable") && w.watchDownload)
		actions.push({ id: "downloads", label: w.watchDownload });
	actions.push({ id: "back", label: w.backTo(ctx.title) });
	return {
		kind: h.kind,
		failed: h.failed,
		icon: h.icon,
		eyebrow: h.eyebrow,
		title: h.title,
		body:
			offline && w.downloadsStillPlay ? `${h.body ?? ""} ${w.downloadsStillPlay}`.trim() : h.body,
		mono: h.mono,
		note: adminNote ?? h.note,
		wait: h.wait,
		message: h.message,
		countdown:
			h.count && h.left && h.total
				? { text: h.count(h.left), fraction: h.left / h.total }
				: undefined,
		actions,
		alternatives: h.alts?.map((a, i) => ({
			id: String(i),
			icon: a.icon,
			label: a.label,
			sub: a.sub,
		})),
	};
}
