import { dateLocale } from "#lib/core/date-locale.ts";
import type { ActivityEvent, ActivityKind, FileSummary, Kind, Title } from "#lib/core/types.ts";

export type Filter = "all" | "library" | "downloads" | "system";
export const FILTERS: Filter[] = ["all", "library", "downloads", "system"];

const LIBRARY: ActivityKind[] = ["episodes", "upgrade", "movie", "season"];
const SYSTEM: ActivityKind[] = ["device", "server", "scan"];

export function matches(kind: ActivityKind, f: Filter) {
	if (f === "all") return true;
	if (f === "library") return LIBRARY.includes(kind);
	if (f === "downloads") return kind === "download";
	return SYSTEM.includes(kind);
}

export type Group = "today" | "yesterday" | "week" | "earlier";

const dayIndex = (d: Date) =>
	Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);

export function groupOf(at: Date, now: Date): Group {
	const days = dayIndex(now) - dayIndex(at);
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	return days < 7 ? "week" : "earlier";
}

export function timeLabel(at: Date, now: Date, locale: string) {
	const group = groupOf(at, now);
	if (group === "today" || group === "yesterday")
		return at.toLocaleTimeString(dateLocale(locale), {
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		});
	return at.toLocaleDateString(
		dateLocale(locale),
		group === "week" ? { weekday: "short" } : { day: "numeric", month: "short" },
	);
}

/** Every sentence the feed shows, worded by the caller: `core` stays free of the message catalogue. */
export type Words = {
	groups: Record<Group, string>;
	newEpisodes(count: number): string;
	episodesReady(season: number, list: string, count: number): string;
	seasonAdded(season: number): string;
	episodeCount(count: number): string;
	movieAdded: string;
	upgraded(is4k: boolean): string;
	replaced(previous: string, quality: string): string;
	downloadFinished: string;
	downloadedEpisode(season: number, episode: number): string;
	downloadedMovie: string;
	deviceSignedIn: string;
	serverUpdated: string;
	serverText(version: string, restartSeconds?: number): string;
	scanFinished: string;
	scanText(added: number, upgraded: number, errors: number): string;
	unread(count: number): string;
	caughtUp: string;
	bell(count: number): string;
	bellPlain: string;
};

type Open =
	| { to: "detail"; kind: Kind; id: number; season?: number }
	| { to: "downloads"; kind: Kind; id: number };

export type RowView = {
	id: string;
	head: string;
	name: string;
	text: string;
	at: string;
	poster: Title | null;
	titleKind: Kind | null;
	badge: "plus" | "sparkles" | "arrow-down-to-line" | null;
	badgeTone: "accent" | "warning" | "available" | null;
	icon: string;
	unread: boolean;
	open: Open | null;
};

type Find = (kind: Kind, id: number) => Title | undefined;

const quality = (f?: FileSummary) =>
	[
		f?.resolution,
		f?.hdr,
		f?.audio && f.channels ? `${f.audio} ${f.channels}` : f?.audio ? f.audio : f?.channels,
	]
		.filter(Boolean)
		.join(" · ");

function episodeList(numbers: number[]) {
	const sorted = [...numbers].sort((a, b) => a - b);
	const run = sorted.length > 1 && sorted.slice(1).every((n, i) => n - 1 === sorted[i]);
	return run ? `E${sorted[0]}–E${sorted.at(-1)}` : sorted.map((n) => `E${n}`).join(", ");
}

const DEVICE_ICON: Record<string, string> = {
	ios: "smartphone",
	android: "smartphone",
	tvos: "tv",
	androidtv: "tv",
	tizen: "tv",
	webos: "tv",
	web: "globe",
	browser: "globe",
};

const words_of = (e: ActivityEvent, w: Words) => {
	switch (e.kind) {
		case "episodes": {
			const eps = e.episodes ?? [];
			return {
				head: w.newEpisodes(eps.length),
				text: w.episodesReady(e.season ?? 1, episodeList(eps), eps.length),
			};
		}
		case "season":
			return { head: w.seasonAdded(e.season ?? 1), text: w.episodeCount(e.episode_count ?? 0) };
		case "movie":
			return { head: w.movieAdded, text: quality(e.file) };
		case "upgrade":
			return {
				head: w.upgraded(e.file?.resolution === "2160p"),
				text: w.replaced(e.previous?.resolution ?? "", quality(e.file)),
			};
		case "download": {
			const ep = e.episodes?.[0];
			return {
				head: w.downloadFinished,
				text: ep === undefined ? w.downloadedMovie : w.downloadedEpisode(e.season ?? 1, ep),
			};
		}
		case "device":
			return {
				head: w.deviceSignedIn,
				text: [e.device?.name, e.device?.location].filter(Boolean).join(" · "),
			};
		case "server":
			return {
				head: w.serverUpdated,
				text: w.serverText(e.server?.version ?? "", e.server?.restart_seconds),
			};
		case "scan":
			return {
				head: w.scanFinished,
				text: w.scanText(e.scan?.added ?? 0, e.scan?.upgraded ?? 0, e.scan?.errors ?? 0),
			};
	}
};

export function rowOf(e: ActivityEvent, find: Find, now: Date, locale: string, w: Words): RowView {
	const { head, text } = words_of(e, w);
	const found = e.title ? find(e.title.kind, e.title.id) : undefined;
	const base = {
		id: e.id,
		head,
		text,
		at: timeLabel(new Date(e.at), now, locale),
		unread: !e.read,
	};
	if (e.title && !found)
		return {
			...base,
			name: "",
			poster: null,
			titleKind: null,
			badge: null,
			badgeTone: null,
			icon: "bell",
			open: null,
		};
	const badge =
		e.kind === "upgrade"
			? ({ badge: "sparkles", badgeTone: "warning" } as const)
			: e.kind === "download"
				? ({ badge: "arrow-down-to-line", badgeTone: "available" } as const)
				: found
					? ({ badge: "plus", badgeTone: "accent" } as const)
					: ({ badge: null, badgeTone: null } as const);
	const icon = found
		? "bell"
		: e.kind === "device"
			? (DEVICE_ICON[e.device?.platform ?? ""] ?? "monitor")
			: e.kind === "server"
				? "server"
				: e.kind === "scan"
					? "refresh-cw"
					: "bell";
	let open: Open | null = null;
	if (e.title && found) {
		open =
			e.kind === "download"
				? { to: "downloads", kind: e.title.kind, id: e.title.id }
				: {
						to: "detail",
						kind: e.title.kind,
						id: e.title.id,
						...(e.kind === "episodes" && e.season !== undefined ? { season: e.season } : {}),
					};
	}
	return {
		...base,
		name: found?.title ?? "",
		poster: found ?? null,
		titleKind: e.title?.kind ?? null,
		...badge,
		icon,
		open,
	};
}

export const bellLabel = (unread: number, w: Words) => (unread ? w.bell(unread) : w.bellPlain);

export function feedView(
	events: ActivityEvent[],
	filter: Filter,
	find: Find,
	now: Date,
	locale: string,
	w: Words,
) {
	const unread = events.filter((e) => !e.read).length;
	const order: Group[] = ["today", "yesterday", "week", "earlier"];
	const shown = events.filter((e) => matches(e.kind, filter));
	const groups = order
		.map((group) => ({
			group,
			label: w.groups[group],
			rows: shown
				.filter((e) => groupOf(new Date(e.at), now) === group)
				.map((e) => rowOf(e, find, now, locale, w)),
		}))
		.filter((g) => g.rows.length);
	return {
		groups,
		unread,
		summary: unread ? w.unread(unread) : w.caughtUp,
		empty: shown.length === 0,
	};
}
