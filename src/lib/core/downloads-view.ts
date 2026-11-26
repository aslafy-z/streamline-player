import { audioBytes, converts, estimate, sizeText, subBytes } from "#lib/core/download-size.ts";
import type { Choice } from "#lib/core/playback/choice.ts";
import type { AudioTrack, SubTrack, Tracks } from "#lib/core/playback/port.ts";
import { language } from "#lib/core/playback/rules.ts";
import type {
	DownloadEntry,
	DownloadError,
	DownloadQuality,
	Kind,
	Watch,
} from "#lib/core/types.ts";

/** Every sentence and name the Downloads views show, worded by the caller: `core` stays free of the message catalogue. */
export type Words = {
	language(code: string): string;
	quality(q: DownloadQuality): string;
	runtime(minutes: number): string;
	clock(seconds: number): string;
	audioName(t: AudioTrack): string;
	subName(t: SubTrack): string;
	subKind(t: SubTrack): string;
	videoName(video: NonNullable<Tracks["video"]>): string;
	summary(ready: number, inProgress: number): string;
	movies: string;
	episodes(n: number): string;
	season(n: number, episodes: string, size: string): string;
	starting: string;
	preparing(pct: number): string;
	queued(n: number): string;
	waiting: string;
	waitingWifi: string;
	queuedShort: string;
	/** "1.2 of 4.0 GB". */
	of(got: string, total: string): string;
	/** " · Wi-Fi" while downloads wait for it, else empty. */
	wifi: string;
	cause(code: DownloadError): string;
	kept(size: string): string;
	perSecond(speed: string, eta: string): string;
	seconds(n: number): string;
	minutes(n: number): string;
	hoursMinutes(h: number, m: number): string;
	watched: string;
	tracks(audio: string, subs: string): string;
	none: string;
	finishedOffline: string;
	watchedTo(time: string): string;
	meterUsed(size: string): string;
	meterOther(size: string): string;
	meterFree(size: string): string;
	download(label: string): string;
	downloadShort: string;
	removeDownload(label: string): string;
	onDevice: string;
	cancelDownload(label: string): string;
	seasonOnDevice: string;
	seriesOnDevice: string;
	downloadSeason: string;
	downloadSeries: string;
	downloadMore(n: number): string;
	downloadingName(name: string, pct: number): string;
	removeFromDevice(name: string): string;
	downloadNameEpisodes(name: string, n: number): string;
	pickTitle(label: string): string;
	noteOriginal(video: string): string;
	noteConverted(quality: string, many: boolean): string;
	originalSuffix: string;
	cantShow: string;
};

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;
const pctOf = (progress: number) => Math.round(progress * 100);

export function keyOf(kind: Kind, id: number, season?: number, episode?: number) {
	return season === undefined ? `${kind}:${id}` : `${kind}:${id}:${season}:${episode}`;
}

export function rateText(rate: number, left: number, w: Words) {
	if (rate <= 0) return w.starting;
	const secs = Math.max(1, Math.round(left / rate));
	const eta =
		secs >= 3600
			? w.hoursMinutes(Math.floor(secs / 3600), Math.round((secs % 3600) / 60))
			: secs >= 60
				? w.minutes(Math.round(secs / 60))
				: w.seconds(secs);
	const mb = rate / 1e6;
	return w.perSecond(mb >= 10 ? String(Math.round(mb)) : mb.toFixed(1), eta);
}

const isEpisode = (e: DownloadEntry) => e.meta.kind === "series";
const fullTitle = (e: DownloadEntry) =>
	isEpisode(e) ? `${e.meta.title} · S${e.meta.season} E${e.meta.episode}` : e.meta.title;

export type ActiveRow = {
	key: string;
	title: string;
	pct: number;
	sub: string;
	note: string;
	noteTone: "rate" | "muted" | "failed";
	state: "downloading" | "starting" | "preparing" | "queued" | "waiting" | "failed";
	still: string;
	canRetry: boolean;
};
export type Card = {
	key: string;
	head: string;
	line: string;
	meta: string;
	tracks: string;
	fullTitle: string;
	still: string;
	watched: boolean;
	offText: string | null;
};
export type Group = {
	kind: "movies" | "show";
	title: string;
	sub: string;
	poster: string;
	titleKind: Kind;
	titleId: number;
	firstSeason: number | null;
	keys: string[];
	seasons: { label: string | null; cards: Card[] }[];
};

function got(e: DownloadEntry, w: Words) {
	return w.of(e.size >= 1e9 ? (e.bytes / 1e9).toFixed(2) : sizeText(e.bytes), sizeText(e.size));
}

function activeRows(items: DownloadEntry[], rate: number, w: Words): ActiveRow[] {
	let queued = 0;
	let started = false;
	return items
		.filter((e) => e.state !== "done")
		.map((e): ActiveRow => {
			const base = {
				key: e.key,
				title: fullTitle(e),
				pct: pctOf(e.progress),
				sub: `${w.quality(e.quality)} · ${got(e, w)}${w.wifi}`,
				still: e.meta.still,
				canRetry: false,
			};
			if (e.state === "failed")
				return {
					...base,
					note: w.cause(e.error ?? "prepare_failed"),
					noteTone: "failed",
					state: "failed",
					canRetry: true,
				};
			if (e.state === "preparing")
				return {
					...base,
					note: w.preparing(pctOf(e.progress)),
					noteTone: "muted",
					state: "preparing",
				};
			if (e.state === "waiting")
				return {
					...base,
					note: e.error === "wifi" ? w.waitingWifi : w.waiting,
					noteTone: "muted",
					state: "waiting",
				};
			if (e.state === "downloading" && !started) {
				started = true;
				return rate > 0
					? {
							...base,
							note: rateText(rate, e.size - e.bytes, w),
							noteTone: "rate",
							state: "downloading",
						}
					: { ...base, note: w.starting, noteTone: "muted", state: "starting" };
			}
			queued++;
			return { ...base, note: w.queued(queued), noteTone: "muted", state: "queued" };
		});
}

function offText(e: DownloadEntry, w: Words) {
	if (!e.offline) return null;
	return e.offline.done ? w.finishedOffline : w.watchedTo(w.clock(e.offline.position));
}

/** `watch` is the library's, when loaded: the download's own flag is from when it was asked for. */
function card(e: DownloadEntry, w: Words, watch: Watch[]): Card {
	const row = watch.find((x) => x.media_id === e.media_id);
	const watched = (row ? row.watched : e.watched) || !!e.offline?.done;
	const audioLangs = [...new Set(e.audio.map((a) => w.language(a.language)))].join(", ");
	const subLangs = [...new Set(e.subtitles.map((s) => w.language(s.language)))].join(", ");
	return {
		key: e.key,
		head: isEpisode(e)
			? `E${e.meta.episode}${e.meta.episode_title ? ` · ${e.meta.episode_title}` : ""}`
			: e.meta.title,
		line: isEpisode(e)
			? w.runtime(e.meta.runtime)
			: `${e.meta.year ?? ""}${e.meta.year ? " · " : ""}${w.runtime(e.meta.runtime)}`,
		meta: `${w.quality(e.quality)} · ${sizeText(e.size)}${watched ? ` · ${w.watched}` : ""}`,
		tracks: w.tracks(audioLangs, subLangs || w.none),
		fullTitle: fullTitle(e),
		still: e.meta.still,
		watched,
		offText: offText(e, w),
	};
}

const byEpisode = (a: DownloadEntry, b: DownloadEntry) =>
	(a.meta.season ?? 0) - (b.meta.season ?? 0) || (a.meta.episode ?? 0) - (b.meta.episode ?? 0);
const total = (list: DownloadEntry[]) => list.reduce((n, e) => n + e.size, 0);

function groupsOf(done: DownloadEntry[], w: Words, watch: Watch[]): Group[] {
	const out: Group[] = [];
	const movies = done
		.filter((e) => !isEpisode(e))
		.sort((a, b) => a.meta.title.localeCompare(b.meta.title));
	if (movies.length)
		out.push({
			kind: "movies",
			title: w.movies,
			sub: `${movies.length} · ${gb(total(movies))}`,
			poster: "",
			titleKind: "movies",
			titleId: 0,
			firstSeason: null,
			keys: movies.map((e) => e.key),
			seasons: [{ label: null, cards: movies.map((e) => card(e, w, watch)) }],
		});
	const shows = new Map<number, [DownloadEntry, ...DownloadEntry[]]>();
	for (const e of done.filter(isEpisode)) {
		const list = shows.get(e.meta.title_id);
		if (list) list.push(e);
		else shows.set(e.meta.title_id, [e]);
	}
	const lists = [...shows.values()].sort((a, b) => a[0].meta.title.localeCompare(b[0].meta.title));
	for (const list of lists) {
		list.sort(byEpisode);
		const seasons = [...new Set(list.map((e) => e.meta.season ?? 0))];
		out.push({
			kind: "show",
			title: list[0].meta.title,
			sub: `${w.episodes(list.length)} · ${gb(total(list))}`,
			poster: list[0].meta.poster,
			titleKind: "series",
			titleId: list[0].meta.title_id,
			firstSeason: list[0].meta.season,
			keys: list.map((e) => e.key),
			seasons: seasons.map((n) => {
				const eps = list.filter((e) => (e.meta.season ?? 0) === n);
				return {
					label: w.season(n, w.episodes(eps.length), gb(total(eps))),
					cards: eps.map((e) => card(e, w, watch)),
				};
			}),
		});
	}
	return out;
}

/** Reads only the entries: a download draws from what was saved with it, never from the library. */
export function pageView(items: DownloadEntry[], rate: number, w: Words, watch: Watch[] = []) {
	const done = items.filter((e) => e.state === "done");
	const active = activeRows(items, rate, w);
	return {
		summary: w.summary(done.length, active.length),
		active,
		groups: groupsOf(done, w, watch),
		empty: items.length === 0,
	};
}

/** `whole` rounds to the gigabyte, for a phone's narrow legend. */
export function storageView(
	s: { used: number; other: number; free: number },
	w: Words,
	whole = false,
) {
	const sum = s.used + s.other + s.free || 1;
	const size = (bytes: number) => (whole ? `${Math.round(bytes / 1e9)} GB` : gb(bytes));
	return {
		usedPct: Math.max(1, (s.used / sum) * 100),
		otherPct: (s.other / sum) * 100,
		labels: [w.meterUsed(size(s.used)), w.meterOther(size(s.other)), w.meterFree(size(s.free))] as [
			string,
			string,
			string,
		],
	};
}

type Icon = "arrow-down-to-line" | "circle-arrow-down" | null;
type Tone = "muted" | "accent" | "progress";

export function buttonState(e: DownloadEntry | undefined, label: string, w: Words) {
	if (!e)
		return {
			icon: "arrow-down-to-line" as Icon,
			tone: "muted" as Tone,
			pct: 0,
			label: w.download(label),
			short: w.downloadShort,
		};
	if (e.state === "done")
		return {
			icon: "circle-arrow-down" as Icon,
			tone: "accent" as Tone,
			pct: 100,
			label: w.removeDownload(label),
			short: w.onDevice,
		};
	const pct = pctOf(e.progress);
	return {
		icon: null as Icon,
		tone: "progress" as Tone,
		pct,
		label: w.cancelDownload(label),
		short: `${pct}%`,
	};
}

export function bulkState(
	keys: string[],
	byKey: (k: string) => DownloadEntry | undefined,
	name: string,
	word: "season" | "series",
	w: Words,
) {
	const entries = keys.map(byKey);
	const done = entries.filter((e) => e?.state === "done").length;
	const active = entries.filter((e): e is DownloadEntry => !!e && e.state !== "done");
	const missing = keys.filter((_, i) => !entries[i]);
	const none = {
		icon: "arrow-down-to-line" as Icon,
		tone: "muted" as Tone,
		pct: 0,
		text: "",
		label: "",
		missing,
		act: "none" as "start" | "popover" | "none",
	};
	if (!keys.length) return none;
	if (active.length) {
		const pct = Math.round(
			(done * 100 + active.reduce((n, e) => n + e.progress * 100, 0)) / keys.length,
		);
		return {
			...none,
			icon: null as Icon,
			tone: "progress" as Tone,
			pct,
			text: `${done + active.length}/${keys.length} · ${pct}%`,
			label: w.downloadingName(name, pct),
			act: "popover" as const,
		};
	}
	if (!missing.length)
		return {
			...none,
			icon: "circle-arrow-down" as Icon,
			tone: "accent" as Tone,
			pct: 100,
			text: word === "series" ? w.seriesOnDevice : w.seasonOnDevice,
			label: w.removeFromDevice(name),
			act: "popover" as const,
		};
	return {
		...none,
		text: done
			? w.downloadMore(missing.length)
			: word === "series"
				? w.downloadSeries
				: w.downloadSeason,
		label: w.downloadNameEpisodes(name, missing.length),
		act: "start" as const,
	};
}

export function popoverView(
	keys: string[],
	byKey: (k: string) => DownloadEntry | undefined,
	rate: number,
	label: string,
	w: Words,
) {
	const list = keys.map(byKey).filter((e): e is DownloadEntry => !!e);
	const sizeSum = total(list);
	const gotSum = list.reduce((n, e) => n + (e.state === "done" ? e.size : e.bytes), 0);
	const doneN = list.filter((e) => e.state === "done").length;
	const current = list.find((e) => e.state === "downloading" || e.state === "preparing");
	const failed = list.find((e) => e.state === "failed");
	const state: "downloading" | "waiting" | "failed" | "done" =
		list.length && doneN === list.length
			? "done"
			: current
				? "downloading"
				: failed
					? "failed"
					: "waiting";
	const unit = sizeSum >= 1e9;
	const progress = sizeSum
		? Math.round(
				(list.reduce((n, e) => n + (e.state === "done" ? e.size : e.progress * e.size), 0) /
					sizeSum) *
					100,
			)
		: 0;
	let line: string;
	if (state === "downloading" && current)
		line =
			current.state === "preparing"
				? w.preparing(pctOf(current.progress))
				: rateText(rate, sizeSum - gotSum, w);
	else if (state === "failed") line = w.cause(failed?.error ?? "prepare_failed");
	else if (list.some((e) => e.error === "wifi")) line = w.waitingWifi;
	else line = list.some((e) => e.state === "waiting") ? w.waiting : w.queuedShort;
	const keptBytes = list.filter((e) => e.state === "failed").reduce((n, e) => n + e.bytes, 0);
	return {
		state,
		title: label,
		progress,
		got: unit
			? w.of((gotSum / 1e9).toFixed(1), gb(sizeSum))
			: w.of(sizeText(gotSum), sizeText(sizeSum)),
		rate: line,
		size: sizeText(sizeSum),
		quality: list[0] ? w.quality(list[0].quality) : "",
		count: keys.length > 1 ? { done: doneN, total: list.length } : null,
		cause: state === "failed" ? w.cause(failed?.error ?? "prepare_failed") : null,
		kept: state === "failed" && keptBytes > 0 ? w.kept(sizeText(keptBytes)) : null,
	};
}

/** What would play with nothing chosen (Assumed 8): the original audio, the rule's audio, the subtitle the rule picks. */
export function pickDefaults(
	tracks: Tracks,
	choice: Choice,
	canShow: (t: SubTrack) => boolean = () => true,
) {
	const original = tracks.audio.find((t) => t.default) ?? tracks.audio[0];
	const audio = new Set<number>(original ? [original.index] : []);
	const ruled = tracks.audio.find((t) => language(t.language) === choice.audio);
	if (ruled) audio.add(ruled.index);
	const langs = new Set(
		tracks.audio.filter((t) => audio.has(t.index)).map((t) => language(t.language)),
	);
	const usable = tracks.subtitles.filter(canShow);
	let sub: SubTrack | undefined;
	if (choice.subs === "forced")
		sub = usable.find((t) => t.forced && langs.has(language(t.language)));
	else if (choice.subs !== "off")
		sub =
			usable.find((t) => !t.forced && language(t.language) === choice.subs) ??
			usable.find((t) => language(t.language) === choice.subs);
	return {
		audio: [...audio].sort((a, b) => a - b),
		subs: sub ? [sub.index] : [],
	};
}

export type PickRow = {
	index: number;
	label: string;
	sub: string;
	size: string;
	on: boolean;
	disabled: boolean;
};

export function pickView(
	p: {
		label: string;
		count: number;
		quality: DownloadQuality;
		audio: number[];
		subs: number[];
		remember: boolean;
	},
	tracks: Tracks,
	fileBitRate: number,
	minutes: number,
	canShow: (t: SubTrack) => boolean,
	w: Words,
) {
	const pickedSubs = tracks.subtitles
		.filter((t) => p.subs.includes(t.index) && canShow(t))
		.map((t) => t.index);
	const est = estimate({
		quality: p.quality,
		fileBitRate,
		minutes,
		audio: tracks.audio,
		picked: p.audio,
		subs: tracks.subtitles,
		pickedSubs,
	});
	const extraSubs = tracks.subtitles.reduce(
		(n, t) => n + (pickedSubs.includes(t.index) ? subBytes(t) : 0),
		0,
	);
	const sum = est.total + extraSubs * (p.count - 1);
	return {
		title: w.pickTitle(p.label),
		qNote:
			p.quality === "original"
				? w.noteOriginal(tracks.video ? w.videoName(tracks.video) : "")
				: w.noteConverted(w.quality(p.quality), p.count > 1),
		audio: tracks.audio.map((t, i): PickRow => {
			const name = w.audioName(t);
			return {
				index: t.index,
				label: w.language(t.language) + (i === 0 ? w.originalSuffix : ""),
				sub: converts(t.codec, p.quality) ? `${name} → EAC3 5.1` : name,
				size: sizeText(audioBytes(t, p.quality, minutes)),
				on: p.audio.includes(t.index),
				disabled: false,
			};
		}),
		subs: tracks.subtitles.map((t): PickRow => {
			const ok = canShow(t);
			const size = subBytes(t) * p.count;
			return {
				index: t.index,
				label: w.subName(t),
				sub: `${w.subKind(t)} · ${ok ? sizeText(size) : w.cantShow}`,
				size: sizeText(size),
				on: ok && p.subs.includes(t.index),
				disabled: !ok,
			};
		}),
		total: sizeText(sum) + (p.count > 1 ? ` · ${w.episodes(p.count)}` : ""),
		canDownload: p.audio.length > 0,
	};
}
