import type { Kind, Title, Watch } from "#lib/core/types.ts";

/** Where the viewer stands in a title: what a card's bookmark, count and bar draw. */
export type WatchInfo = {
	watched: boolean;
	/** Percent of the unfinished play, 0 when there is none. */
	pct: number;
	inProgress: boolean;
	/** Nothing watched or started: the bookmark. */
	unread: boolean;
	/** A series' episodes not watched yet, the one under way included; 0 for a movie. */
	left: number;
};

const pctOf = (w: Watch | undefined) =>
	w && w.duration_seconds > 0 ? Math.round((w.position_seconds / w.duration_seconds) * 100) : 0;

const underWay = (w: Watch) => !w.watched && w.position_seconds > 0;

// A screen asks about every title on each redraw, a series once per episode: scanning the rows
// each time is episodes x rows. The store replaces the array on any change, so one index per
// array stays right.
const indexes = new WeakMap<Watch[], Map<string, Watch>>();
function byMedia(watch: Watch[]) {
	let index = indexes.get(watch);
	if (!index) {
		index = new Map(watch.map((w) => [w.media_id, w]));
		indexes.set(watch, index);
	}
	return index;
}

export function watchInfo(t: Title, kind: Kind, watch: Watch[]): WatchInfo {
	if (kind === "movies") {
		const watched = watch.some((w) => w.movie_id === t.id && w.watched);
		const pct = watched ? 0 : pctOf(watch.find((w) => w.movie_id === t.id && underWay(w)));
		return { watched, pct, inProgress: pct > 0, unread: !watched && pct === 0, left: 0 };
	}
	const going = watch.find((w) => w.series_id === t.id && underWay(w));
	const files = (t.seasons ?? []).flatMap((s) => s.episodes).filter((e) => e.has_file);
	let total: number;
	let seen: number;
	let started: number;
	if (t.seasons) {
		const index = byMedia(watch);
		const rows = files.map((e) => index.get(e.media_file_id));
		total = files.length;
		seen = rows.filter((w) => w?.watched).length;
		started = rows.filter((w) => w && (w.watched || w.position_seconds > 0)).length;
	} else {
		({ total, watched: seen, started } = t.episodes ?? { total: 0, watched: 0, started: 0 });
	}
	const watched = total > 0 && seen === total;
	const pct = watched ? 0 : pctOf(going);
	return {
		watched,
		pct,
		inProgress: pct > 0,
		unread: started === 0 && !going,
		left: Math.max(0, total - seen),
	};
}
