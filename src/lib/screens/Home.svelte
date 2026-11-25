<script lang="ts">
import { onMount } from "svelte";
import {
	arrivalDay,
	continueWatching,
	isNew,
	metaLine,
	nextEpisode,
	playUrl,
	recentCount,
	recentlyAdded,
	topGenre,
	years,
} from "#lib/core/browse.ts";
import { badges, left, runtime, stillPos } from "#lib/core/format.ts";
import { lib, loadLibrary } from "#lib/core/library.svelte.ts";
import type { Kind, Title } from "#lib/core/types.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { getLocale } from "#lib/paraglide/runtime.js";
import { isTablet } from "#lib/platform/form-factor.svelte.ts";
import LoadFailed from "#lib/screens/LoadFailed.svelte";
import { titleCard } from "#lib/screens/title-card.svelte.ts";
import Billboard, { type Slide } from "#lib/ui/Billboard.svelte";
import EmptyState from "#lib/ui/EmptyState.svelte";
import { goto } from "#lib/ui/nav.ts";
import PosterCard from "#lib/ui/PosterCard.svelte";
import ResumeCard from "#lib/ui/ResumeCard.svelte";
import Row from "#lib/ui/Row.svelte";
import { artwork, home, library, softwareRendering, title, watchState } from "#platform";

const PAD_X = $derived(isTablet() ? 44 : 56);
const HERO_TITLE = $derived(isTablet() ? 54 : 58);
const ROWS_BOTTOM = $derived(isTablet() ? 28 : 56);
const HERO_SHARE = 0.8;
const ROW_LIMIT = 12;
const OVERLAP = 112;
const HERO_MIN = 360;
const ROW_MARGIN = 16;
const BAR_CLEARANCE = 96;
const port = { library, watchState, home, title };

let innerHeight = $state(window.innerHeight);
let rows = $state<HTMLElement>();
let firstRow = $state(0);
$effect(() => {
	const row = rows?.firstElementChild;
	if (!row) return;
	const watch = new ResizeObserver(() => (firstRow = (row as HTMLElement).offsetHeight));
	watch.observe(row);
	return () => watch.disconnect();
});
// The hero gives way so the first row shows whole under it, down to a floor on short windows.
const heroHeight = $derived(
	firstRow && !isTablet()
		? Math.max(HERO_MIN, innerHeight - firstRow + OVERLAP - ROW_MARGIN)
		: Math.round(innerHeight * HERO_SHARE),
);
const now = new Date();

const resume = $derived(continueWatching(lib.movies, lib.shows, lib.watch));
const byKey = (kind: Kind, id: number) =>
	(kind === "movies" ? lib.movies : lib.shows).find((t) => t.id === id);
const arrivedEpisodes = (id: number) =>
	lib.feed?.arrivals.flatMap((d) => d.items).find((a) => a.kind === "series" && a.id === id)
		?.episodes?.length ?? 0;

const fmt = {
	runtime,
	seasons: (n: number) =>
		n === 1 ? i18n.common_seasons_one({ count: n }) : i18n.common_seasons_other({ count: n }),
	rating: (n: number) => n.toLocaleString(getLocale()),
};
const resLabel = (t: Title) => badges(t.file_summary)[0];

const playResume = (r: (typeof resume)[number]) =>
	goto(playUrl(r.kind, r.id, r.episodeId, !r.next));
const open = (kind: Kind, id: number, season?: number) =>
	goto(`/detail/${kind}/${id}${season ? `?s=${season}` : ""}`);

function eyebrow(f: NonNullable<typeof lib.feed>["featured"][number], t: Title) {
	if (f.reason === "continue") return i18n.home_continue_watching();
	if (f.reason === "next") return i18n.home_up_next();
	if (f.reason === "new_episodes" && f.season !== undefined && f.episodes?.length) {
		const first = f.episodes[0];
		const last = f.episodes.at(-1);
		return first === last
			? i18n.home_eyebrow_episode({ season: f.season, episode: first as number })
			: i18n.home_eyebrow_episodes({ season: f.season, from: first as number, to: last as number });
	}
	const day = arrivalDay(t.added_at.slice(0, 10), now);
	return day === "today"
		? i18n.home_added_today()
		: day === "yesterday"
			? i18n.home_added_yesterday()
			: i18n.home_recently_added();
}

const slides = $derived.by(() => {
	const out: Slide[] = [];
	for (const f of lib.feed?.featured ?? []) {
		const t = byKey(f.kind, f.id);
		if (!t) continue;
		const going = resume.find((r) => r.kind === f.kind && r.id === f.id);
		const base = {
			key: `${f.kind}:${f.id}`,
			img: artwork(f.kind, f.id, "backdrop"),
			eyebrow: eyebrow(f, t),
			title: t.title,
			meta: metaLine(t, f.kind, fmt).join(" · "),
			chips: badges(t.file_summary),
			overview: t.overview,
			oninfo: () => open(f.kind, f.id, going?.season ?? f.season),
		};
		if (going) {
			out.push({
				...base,
				primary:
					going.kind === "series"
						? (going.next ? i18n.detail_play_episode : i18n.detail_resume_episode)({
								season: going.season as number,
								episode: going.episode as number,
							})
						: i18n.common_resume(),
				...(going.next
					? {}
					: {
							progress: {
								pct: going.pct,
								left: going.sub ? `${going.sub} · ${left(going.left)}` : left(going.left),
							},
						}),
				onprimary: () => playResume(going),
			});
			continue;
		}
		const ep = f.kind === "series" ? nextEpisode(t, lib.watch) : undefined;
		out.push({
			...base,
			primary: i18n.common_play(),
			onprimary: () => goto(playUrl(f.kind, f.id, ep?.id)),
		});
	}
	return out;
});

const movieSub = (t: Title) => [t.year, resLabel(t)].filter(Boolean).join(" · ");
const showSub = (t: Title) =>
	[fmt.seasons(t.total_seasons ?? t.seasons?.length ?? 0), years(t)].join(" · ");
const badge = (t: Title, kind: Kind) => {
	const episodes = kind === "series" ? arrivedEpisodes(t.id) : 0;
	if (episodes) return i18n.home_new_count({ count: episodes });
	return isNew(t, now) ? i18n.home_new() : undefined;
};

const recentMovies = $derived(recentlyAdded(lib.movies, ROW_LIMIT));
const recentShows = $derived(recentlyAdded(lib.shows, ROW_LIMIT));
const genre = $derived(topGenre([...lib.movies, ...lib.shows]));
const genreTitles = $derived(
	genre
		? [
				...lib.movies
					.filter((t) => t.genres.includes(genre))
					.map((t) => ({ kind: "movies" as Kind, t })),
				...lib.shows
					.filter((t) => t.genres.includes(genre))
					.map((t) => ({ kind: "series" as Kind, t })),
				// The whole genre is hundreds of cards on a real library, mounted at once on every visit
				// to Home, which froze it for a second or two. The Library's genre filter lists them all.
			].slice(0, ROW_LIMIT)
		: [],
);
const empty = $derived(lib.loaded && lib.movies.length + lib.shows.length === 0);

onMount(() => {
	loadLibrary(port, lib.loaded);
});
</script>

<svelte:window bind:innerHeight />

<div class="home">
	{#if lib.error !== null}
		<LoadFailed error={lib.error} retry={() => loadLibrary(port, true)} />
	{:else if empty}
		<div class="state">
			<EmptyState icon="film" title={i18n.home_empty_title()} text={i18n.home_empty_text()} />
		</div>
	{:else if lib.loaded}
		{#if slides.length}
			<Billboard
				{slides}
				height={heroHeight}
				padX={PAD_X}
				titleSize={HERO_TITLE}
				infoLabel={i18n.common_more_info()}
				dotLabel={(name) => i18n.home_show_title({ title: name })}
				drawnOnCpu={softwareRendering}
			/>
		{/if}
		<div
			class="rows"
			bind:this={rows}
			style:margin-top="{slides.length ? -OVERLAP : BAR_CLEARANCE}px"
			style:padding-bottom="{ROWS_BOTTOM}px"
		>
			{#if resume.length}
				<Row
					title={i18n.home_continue_watching()}
					note={i18n.home_count_in_progress({ count: resume.length })}
					padX={PAD_X}
					arrows={!isTablet()}
					prevLabel={i18n.row_scroll_left({ title: i18n.home_continue_watching() })}
					nextLabel={i18n.row_scroll_right({ title: i18n.home_continue_watching() })}
				>
					{#each resume as r (r.mediaId)}
						{@const t = byKey(r.kind, r.id)}
						<ResumeCard
							title={r.title}
							code={r.code}
							sub={r.kind === "series"
								? r.sub
								: t
									? `${runtime(t.runtime ?? 0)} · ${badges(t.file_summary).slice(0, 2).join(" ")}`
									: ""}
							still={artwork(r.kind, r.id, "backdrop")}
							position={r.kind === "series"
								? stillPos(r.episode as number, r.season as number)
								: "50% 35%"}
							progress={r.pct}
							left={left(r.left)}
							onclick={() => playResume(r)}
						/>
					{/each}
				</Row>
			{/if}
			{#if recentMovies.length}
				<Row
					title={i18n.home_recent_movies()}
					note={i18n.home_count_month({ count: recentCount(recentMovies, now) })}
					padX={PAD_X}
					arrows={!isTablet()}
					prevLabel={i18n.row_scroll_left({ title: i18n.home_recent_movies() })}
					nextLabel={i18n.row_scroll_right({ title: i18n.home_recent_movies() })}
				>
					{#each recentMovies as t (t.id)}
						<PosterCard
							width={164}
							title={t.title}
							sub={movieSub(t)}
							src={artwork("movies", t.id, "poster")}
							small={artwork("movies", t.id, "poster-w342")}
							{...titleCard("movies", t, now)}
							badge={badge(t, "movies")}
							onclick={() => open("movies", t.id)}
						/>
					{/each}
				</Row>
			{/if}
			{#if recentShows.length}
				<Row
					title={i18n.home_recent_shows()}
					note={i18n.home_count_month({ count: recentCount(recentShows, now) })}
					padX={PAD_X}
					arrows={!isTablet()}
					prevLabel={i18n.row_scroll_left({ title: i18n.home_recent_shows() })}
					nextLabel={i18n.row_scroll_right({ title: i18n.home_recent_shows() })}
				>
					{#each recentShows as t (t.id)}
						<PosterCard
							width={164}
							title={t.title}
							sub={showSub(t)}
							src={artwork("series", t.id, "poster")}
							small={artwork("series", t.id, "poster-w342")}
							{...titleCard("series", t, now)}
							badge={badge(t, "series")}
							onclick={() => open("series", t.id)}
						/>
					{/each}
				</Row>
			{/if}
			{#if genre && genreTitles.length}
				<Row
					title={genre}
					padX={PAD_X}
					arrows={!isTablet()}
					prevLabel={i18n.row_scroll_left({ title: genre })}
					nextLabel={i18n.row_scroll_right({ title: genre })}
				>
					{#each genreTitles as { kind, t } (`${kind}:${t.id}`)}
						<PosterCard
							width={164}
							title={t.title}
							sub={kind === "movies" ? movieSub(t) : showSub(t)}
							src={artwork(kind, t.id, "poster")}
							small={artwork(kind, t.id, "poster-w342")}
							{...titleCard(kind, t, now)}
							badge={undefined}
							onclick={() => open(kind, t.id)}
						/>
					{/each}
				</Row>
			{/if}
		</div>
	{/if}
</div>

<style>
.home {
	position: relative;
	min-height: 100%;
	background: var(--bg-deep);
	color: var(--fg);
}

.state {
	display: grid;
	place-items: center;
	min-height: 100vh;
	padding-top: 64px;
	box-sizing: border-box;
}

.rows {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 34px;
	padding-bottom: 56px;
}
</style>
