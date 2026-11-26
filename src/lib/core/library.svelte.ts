import { equal, reconcile } from "#lib/core/reconcile.ts";
import type { HomeFeed, Kind, Title, Watch } from "#lib/core/types.ts";

export type LibraryPort = {
	library(kind: Kind): Promise<Title[]>;
	watchState(): Promise<Watch[]>;
	home(): Promise<HomeFeed>;
	/** A series' list entry has no seasons; the ones on Home need them for their episode. */
	title(kind: Kind, id: number): Promise<Title>;
};

/**
 * One store for every screen, so a title marked watched on one is watched on the others.
 *
 * The lists are raw state, replaced whole and never changed in place. As deep state every card
 * read them through proxies, each row a dependency: a card cost tens of milliseconds to draw.
 */
class Library {
	movies = $state.raw<Title[]>([]);
	shows = $state.raw<Title[]>([]);
	watch = $state.raw<Watch[]>([]);
	feed = $state.raw<HomeFeed | null>(null);
	loaded = $state(false);
	error = $state<string | null>(null);
}

export const lib = new Library();

let inflight: Promise<void> | null = null;

// ponytail: one title request per series on Home; a watch history of hundreds of shows would want the next episode from the server instead.
const RECENT_SERIES = 20;

/** The series Continue watching may name: the ones whose newest play (watch is newest first) is under way or finished, and the billboard's. */
const seriesOnHome = (watch: Watch[], feed: HomeFeed) => {
	const newest = new Map<number, Watch>();
	for (const w of watch)
		if (w.series_id !== undefined && !newest.has(w.series_id)) newest.set(w.series_id, w);
	return [
		...new Set([
			...[...newest]
				.filter(([, w]) => w.watched || w.position_seconds > 0)
				.slice(0, RECENT_SERIES)
				.map(([id]) => id),
			...feed.featured.filter((f) => f.kind === "series").map((f) => f.id),
		]),
	];
};

async function fetchAll(port: LibraryPort) {
	const [movies, shows, watch, feed] = await Promise.all([
		port.library("movies"),
		port.library("series"),
		port.watchState(),
		port.home(),
	]);
	const known = new Set(shows.map((s) => s.id));
	const details = new Map(
		(
			await Promise.all(
				seriesOnHome(watch, feed)
					.filter((id) => known.has(id))
					.map((id) =>
						port.title("series", id).then(
							(d) => [id, d] as const,
							() => null,
						),
					),
			)
		).filter((e) => e !== null),
	);
	const seen = new Map(lib.shows.filter((s) => s.seasons).map((s) => [s.id, s]));
	lib.movies = reconcile(lib.movies, movies, (t) => t.id);
	lib.shows = reconcile(
		lib.shows,
		shows.map((s) => details.get(s.id) ?? seen.get(s.id) ?? s),
		(t) => t.id,
	);
	lib.watch = reconcile(lib.watch, watch, (w) => w.media_id);
	if (!equal(lib.feed, feed)) lib.feed = feed;
	lib.loaded = true;
	lib.error = null;
}

/** Concurrent callers share one request set. A loaded library is kept as it is unless `force`: screens then show it at once and a refresh replaces only what changed. */
export function loadLibrary(port: LibraryPort, force = false): Promise<void> {
	if (inflight) return inflight;
	if (lib.loaded && !force) return Promise.resolve();
	// An earlier failure may be from before the sign-in: it says nothing about this attempt.
	lib.error = null;
	inflight = fetchAll(port)
		.catch((e) => {
			if (!lib.loaded) lib.error = String(e);
		})
		.finally(() => {
			inflight = null;
		});
	return inflight;
}

export function applyWatch(
	mediaId: string,
	watched: boolean,
	ref?: Pick<Watch, "movie_id" | "series_id" | "season" | "episode_id">,
) {
	if (lib.watch.some((w) => w.media_id === mediaId))
		lib.watch = lib.watch.map((w) =>
			w.media_id === mediaId
				? { ...w, watched, position_seconds: watched ? w.position_seconds : 0 }
				: w,
		);
	else if (watched)
		lib.watch = [
			{ media_id: mediaId, position_seconds: 0, duration_seconds: 0, watched, ...ref },
			...lib.watch,
		];
}

const DETAIL_BATCH = 6;

/** List entries carry no seasons, which a series needs to know whether it is watched and which episode Play starts. */
export function loadSeasons(port: Pick<LibraryPort, "title">): Promise<void> {
	seasonsInflight ??= fetchSeasons(port).finally(() => {
		seasonsInflight = null;
	});
	return seasonsInflight;
}

let seasonsInflight: Promise<void> | null = null;

async function fetchSeasons(port: Pick<LibraryPort, "title">) {
	const missing = lib.shows.filter((s) => !s.seasons).map((s) => s.id);
	for (let i = 0; i < missing.length; i += DETAIL_BATCH) {
		const got = new Map(
			(
				await Promise.all(
					missing.slice(i, i + DETAIL_BATCH).map((id) =>
						port.title("series", id).then(
							(d) => [id, d] as const,
							() => null,
						),
					),
				)
			).filter((e) => e !== null),
		);
		if (got.size) lib.shows = lib.shows.map((s) => got.get(s.id) ?? s);
	}
}
