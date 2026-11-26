<script lang="ts" module>
// How tall the rails were when last fully drawn, for the space to hold while they draw again.
const railsHeight = new Map<string, number>();
</script>

<script lang="ts">
import { onMount, untrack } from "svelte";
import { isNew, years } from "#lib/core/browse.ts";
import { addedText, badges, railSub, sizeText } from "#lib/core/format.ts";
import { lib, loadLibrary, loadSeasons } from "#lib/core/library.svelte.ts";
import {
	browseRails,
	FLAGS,
	type Flag,
	genres,
	type Layout,
	MENU_SORTS,
	pickSort,
	type Rail,
	type Sort,
	setWatch,
	sortDirection,
	toggleFlag,
	type View,
	viewFromQuery,
	viewToQuery,
	visible,
	WATCH_FLAGS,
	watchFlag,
} from "#lib/core/library-view.ts";
import { prefs } from "#lib/core/prefs.svelte.ts";
import type { Kind, Title } from "#lib/core/types.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { isTablet } from "#lib/platform/form-factor.svelte.ts";
import LoadFailed from "#lib/screens/LoadFailed.svelte";
import { titleCard } from "#lib/screens/title-card.svelte.ts";
import BackdropCard from "#lib/ui/BackdropCard.svelte";
import Button from "#lib/ui/Button.svelte";
import Chip from "#lib/ui/Chip.svelte";
import { dismiss } from "#lib/ui/dismiss.ts";
import EmptyState from "#lib/ui/EmptyState.svelte";
import FilterMenu from "#lib/ui/FilterMenu.svelte";
import Icon, { type IconName } from "#lib/ui/Icon.svelte";
import { goto } from "#lib/ui/nav.ts";
import PosterCard, { skeleton as posterSkeleton } from "#lib/ui/PosterCard.svelte";
import { presence } from "#lib/ui/presence.svelte.ts";
import { progressive } from "#lib/ui/progressive.svelte.ts";
import Row from "#lib/ui/Row.svelte";
import SegmentedControl from "#lib/ui/SegmentedControl.svelte";
import SortMenu from "#lib/ui/SortMenu.svelte";
import TitleRow, { skeleton as rowSkeleton } from "#lib/ui/TitleRow.svelte";
import { artwork, home, library, title, watchState } from "#platform";
import { page } from "$app/state";

const PAD_X = $derived(isTablet() ? 44 : 56);
const TOP = 92;
const MIN_COL = $derived(isTablet() ? 180 : 196);
const ALL = "__all";
const LIST_COLS = "32px minmax(0,2.2fr) 74px 58px 104px minmax(0,1.4fr) 76px 84px 170px";
const port = { library, watchState, home, title };

let { kind }: { kind: Kind } = $props();

const now = new Date();
const view = $derived(viewFromQuery(new URLSearchParams(page.url.search)));
const isAll = $derived(view.tab === "all");
const base = $derived(kind === "movies" ? lib.movies : lib.shows);
const items = $derived(visible(base, kind, lib.watch, view));
const rails = $derived(
	isAll ? [] : browseRails(base, kind, lib.watch, (t: Title) => isNew(t, now)),
);
const genreList = $derived(genres(base, kind, lib.watch, view.flags));
const flaggedTotal = $derived(visible(base, kind, lib.watch, { ...view, genre: null }).length);
const rows = progressive(
	() => (isAll ? items : []),
	() => `${kind}:${view.layout}`,
);
const shown = $derived(items.slice(0, rows.drawn));

// The rails of the first screen at once, then one a frame: all of them in one go was a frame of
// a quarter of a second on arrival.
const FIRST_RAILS = 3;
let railsDrawn = $state(FIRST_RAILS);
let railsBox = $state<HTMLElement>();
const railsDone = $derived(railsDrawn >= rails.length);
$effect.pre(() => {
	kind;
	untrack(() => {
		railsDrawn = FIRST_RAILS;
	});
});
$effect(() => {
	if (isAll || railsDrawn >= rails.length) return;
	const frame = requestAnimationFrame(() => railsDrawn++);
	return () => cancelAnimationFrame(frame);
});
$effect(() => {
	if (!isAll && railsDone && railsBox) railsHeight.set(kind, railsBox.offsetHeight);
});
const track = rows.track;

let genreMenu = $state(false);
const genrePanel = presence(() => genreMenu, 170);

const watchPick = $derived(watchFlag(view.flags));
const extraFlag: Flag = $derived(kind === "movies" ? "short" : "binge");
const flagLabel: Record<Flag, string> = {
	unwatched: i18n.library_unwatched(),
	progress: i18n.library_in_progress(),
	watched: i18n.library_watched(),
	uhd: "4K",
	hdr: "HDR",
	short: i18n.rail_short(),
	binge: i18n.library_binge(),
};
const watchIcon: Record<string, IconName> = {
	[ALL]: "layers",
	unwatched: "eye",
	progress: "circle-play",
	watched: "check-check",
};
const sortLabel = (s: Sort) =>
	({
		added: i18n.library_sort_added(),
		title: i18n.library_sort_title(),
		year: i18n.library_sort_year(),
		rating: i18n.library_sort_rating(),
		size: i18n.library_sort_size(),
		resolution: i18n.library_sort_resolution(),
		hdr: "HDR",
		audio: i18n.library_col_audio(),
	})[s];
const sortIcon: Record<string, IconName> = {
	added: "clock",
	title: "type",
	year: "calendar",
	rating: "star",
	size: "hard-drive",
};

function set(patch: Partial<View>) {
	const q = viewToQuery({ ...view, ...patch });
	goto(`/library/${kind}${q ? `?${q}` : ""}`, { replace: true, reset: false });
}

function seeAll(r: Rail) {
	set(r.seeAll);
	document.querySelector(".content")?.scrollTo({ top: 0 });
}

const sub = (t: Title) => {
	if (kind === "series")
		return [
			years(t),
			i18n.library_seasons_short({ count: t.total_seasons ?? t.seasons?.length ?? 0 }),
		].join(" · ");
	const q = t.file_summary;
	const tech = prefs.techDetails
		? [q?.resolution, q?.hdr].filter(Boolean).join(" ")
		: badges(q).slice(0, 2).join(" ");
	return [t.year, tech].filter(Boolean).join(" · ");
};
const newest = $derived(
	base.reduce<Title | null>(
		(a, t) => (!a || Date.parse(t.added_at) > Date.parse(a.added_at) ? t : a),
		null,
	),
);
const eyebrow = (t: Title) =>
	t === newest ? i18n.rail_added_today() : i18n.rail_added({ date: addedText(t.added_at, now) });
const railTitle = (r: Rail) =>
	({
		recent: i18n.home_recently_added(),
		top: i18n.rail_top(),
		unstarted: i18n.rail_unstarted(),
		genre: r.genre ?? "",
		uhd: i18n.rail_uhd(),
		short: i18n.rail_short(),
		binge: i18n.rail_binge(),
	})[r.id];
const railNote = (r: Rail) =>
	({
		recent: i18n.home_new_count({ count: r.count }),
		top: i18n.rail_top_note(),
		unstarted: i18n.rail_titles({ count: r.count }),
		genre: i18n.rail_titles({ count: r.count }),
		uhd: i18n.rail_uhd_note({ count: r.count }),
		short: i18n.rail_short_note(),
		binge: i18n.rail_binge_note(),
	})[r.id];
const episodes = (t: Title) =>
	t.seasons
		? t.seasons.flatMap((s) => s.episodes).filter((e) => e.has_file).length
		: (t.episodes?.total ?? 0);

const open = (t: Title) => goto(`/detail/${kind}/${t.id}`);
const empty = $derived(lib.loaded && base.length === 0);

$effect(() => {
	if (kind === "series" && lib.loaded && lib.shows.some((s) => !s.seasons))
		untrack(() => loadSeasons(port));
});

onMount(() => {
	loadLibrary(port, lib.loaded);
});

const heads: { label: () => string; sort: Sort; end?: boolean }[] = [
	{ label: () => i18n.library_sort_title(), sort: "title" },
	{ label: () => i18n.library_sort_year(), sort: "year" },
	{ label: () => i18n.library_col_res(), sort: "resolution" },
	{ label: () => "HDR", sort: "hdr" },
	{ label: () => i18n.library_col_audio(), sort: "audio" },
	{ label: () => i18n.library_sort_size(), sort: "size", end: true },
	{ label: () => i18n.library_col_added(), sort: "added", end: true },
];
</script>

<div class="library" style:--cols={LIST_COLS}>
	{#if lib.error !== null}
		<LoadFailed error={lib.error} retry={() => loadLibrary(port, true)} />
	{:else if empty}
		<div class="state">
			<EmptyState
				icon="film"
				title={kind === "movies"
					? i18n.library_empty_movies_title()
					: i18n.library_empty_shows_title()}
				text={i18n.home_empty_text()}
			/>
		</div>
	{:else if lib.loaded}
		<div class="page" style:padding="{TOP}px {PAD_X}px 56px">
			<div class="top">
				<div class="heading">
					<h1>{kind === "movies" ? i18n.nav_movies() : i18n.nav_shows()}</h1>
					<span class="count"
						>{#if isAll}
							{kind === "movies"
								? i18n.library_count_movies({ count: items.length, total: base.length })
								: i18n.library_count_shows({ count: items.length, total: base.length })}
						{:else}
							{kind === "movies"
								? i18n.library_total_movies({ count: base.length })
								: i18n.library_total_shows({ count: base.length })}
						{/if}</span
					>
				</div>
				{#if isAll}
					<div class="tools">
						<div class="genre" use:dismiss={() => (genreMenu = false)}>
							<button
								type="button"
								class="genre-btn"
								class:on={view.genre !== null}
								aria-haspopup="listbox"
								aria-expanded={genreMenu}
								onclick={() => (genreMenu = !genreMenu)}
							>
								{view.genre ?? i18n.library_genre_all()}
								<span class="chev" class:open={genreMenu}
									><Icon name="chevron-down" size={13} stroke={2} /></span
								>
							</button>
							{#if genrePanel.mounted}
								<div class="genre-panel" class:shown={genrePanel.shown && genreMenu}>
									<FilterMenu
										options={[
											{ value: ALL, label: i18n.library_all(), count: flaggedTotal },
											...genreList.map((g) => ({ value: g.name, label: g.name, count: g.count })),
										]}
										value={view.genre ?? ALL}
										label={i18n.library_genre()}
										placeholder={i18n.library_genre_search()}
										emptyLabel={i18n.library_genre_none()}
										onchange={(v) => {
											set({ genre: v === ALL ? null : v });
											genreMenu = false;
										}}
									/>
								</div>
							{/if}
						</div>
						<SortMenu
							label={i18n.library_watch_state()}
							icon="eye"
							align="left"
							title={watchPick ? undefined : i18n.library_watch_state()}
							value={watchPick ?? ALL}
							options={[
								{ value: ALL, label: i18n.library_all(), icon: watchIcon[ALL] },
								...WATCH_FLAGS.map((f) => ({ value: f, label: flagLabel[f], icon: watchIcon[f] })),
							]}
							onchange={(v) => set({ flags: setWatch(view.flags, v === ALL ? null : (v as Flag)) })}
						/>
						<fieldset class="flags" aria-label={i18n.library_show_only()}>
							{#each FLAGS.filter(
								(f) =>
									!WATCH_FLAGS.includes(f) && (f === extraFlag || (f !== "short" && f !== "binge")),
							) as f (f)}
								<Chip
									pressed={view.flags.includes(f)}
									onclick={() => set({ flags: toggleFlag(view.flags, f) })}
								>
									{flagLabel[f]}
								</Chip>
							{/each}
						</fieldset>
						<span class="rule"></span>
						<SegmentedControl
							label={i18n.library_layout()}
							value={view.layout}
							options={[
								{ value: "grid", label: i18n.library_layout_grid(), icon: "layout-grid" },
								{ value: "list", label: i18n.library_layout_list(), icon: "list" },
							]}
							onchange={(layout: Layout) => set({ layout })}
						/>
						<SortMenu
							label={i18n.library_sort_by()}
							value={view.sort}
							current={sortLabel(view.sort)}
							ascending={sortDirection(view.sort, view.sortRev) === "ascending"}
							options={MENU_SORTS.map((s) => ({
								value: s,
								label: sortLabel(s),
								icon: sortIcon[s],
							}))}
							onchange={(sort: Sort) => set(pickSort(view, sort))}
						/>
					</div>
				{/if}
			</div>
			<nav class="tabs" aria-label={i18n.library_view_label()}>
				{#each [
					["browse", i18n.library_tab_browse()],
					["all", kind === "movies" ? i18n.library_tab_all_movies() : i18n.library_tab_all_shows()],
				] as [tab, label] (tab)}
					<button
						type="button"
						class="tab"
						aria-current={view.tab === tab ? "page" : undefined}
						onclick={() => set({ tab: tab as View["tab"] })}
					>
						{label}<span class="line"></span>
					</button>
				{/each}
			</nav>

			{#if !isAll}
				<div
					class="rails"
					bind:this={railsBox}
					style:margin="4px -{PAD_X}px 0"
					style:min-height={railsDone ? undefined : `${railsHeight.get(kind) ?? 0}px`}
				>
					{#each rails.slice(0, railsDrawn) as r (`${r.id}:${r.genre ?? ""}`)}
						<Row
							title={railTitle(r)}
							note={railNote(r)}
							padX={PAD_X}
							gap={r.wide ? 16 : 18}
							prevLabel={i18n.row_scroll_left({ title: railTitle(r) })}
							nextLabel={i18n.row_scroll_right({ title: railTitle(r) })}
							seeAll={{ label: i18n.rail_see_all(), onclick: () => seeAll(r) }}
						>
							{#each r.titles as t (t.id)}
								{@const card = titleCard(kind, t, now)}
								{#if r.wide}
									<div class="cell" style:width="320px">
										<BackdropCard
											title={t.title}
											sub={railSub(kind, t)}
											eyebrow={eyebrow(t)}
											backdrop={artwork(kind, t.id, "backdrop")}
											poster={artwork(kind, t.id, "poster")}
											posterSmall={artwork(kind, t.id, "poster-w342")}
											info={card.info}
											leftLabel={card.leftLabel}
											onclick={() => open(t)}
										/>
									</div>
								{:else}
									<div class="cell" style:width="168px">
										<PosterCard
											title={t.title}
											sub={railSub(kind, t)}
											src={artwork(kind, t.id, "poster")}
											small={artwork(kind, t.id, "poster-w342")}
											{...card}
											badge={undefined}
											onclick={() => open(t)}
										/>
									</div>
								{/if}
							{/each}
						</Row>
					{/each}
				</div>
			{:else if items.length && view.layout === "grid"}
				<div class="grid" style:--min="{MIN_COL}px" style:padding-bottom="{rows.after}px" use:track>
					{#each shown as t (t.id)}
						{#if rows.real(t.id)}
							<PosterCard
								title={t.title}
								sub={sub(t)}
								src={artwork(kind, t.id, "poster")}
								small={artwork(kind, t.id, "poster-w342")}
								{...titleCard(kind, t, now)}
								onclick={() => open(t)}
							/>
						{:else}
							{@render posterSkeleton(t.title)}
						{/if}
					{/each}
				</div>
			{:else if items.length}
				<div class="table">
					<div class="head">
						<span></span>
						{#each heads as h, i (i)}
							{@const on = h.sort === view.sort}
							<button
								type="button"
								class="th"
								class:end={h.end}
								class:sorted={on}
								class:up={on && sortDirection(h.sort, view.sortRev) === "ascending"}
								onclick={() => set(pickSort(view, h.sort))}
							>
								{h.label()}<Icon name="chevron-down" size={11} stroke={2.5} />
							</button>
						{/each}
						<span></span>
					</div>
					<div class="rows" style:padding-bottom="{rows.after}px" use:track>
						{#each shown as t (t.id)}
							{#if rows.real(t.id)}
								{@const q = t.file_summary}
								{@const card = titleCard(kind, t, now)}
								<TitleRow
									title={t.title}
									poster={artwork(kind, t.id, "poster")}
									small={artwork(kind, t.id, "poster-w342")}
									info={card.info}
									leftLabel={card.leftLabel}
									year={kind === "series" ? years(t) : String(t.year)}
									res={q?.resolution ?? ""}
									hdr={q?.hdr || "SDR"}
									hdrOn={!!q?.hdr}
									audio={[q?.audio, q?.channels].filter(Boolean).join(" ")}
									size={kind === "series"
										? i18n.library_eps({ count: episodes(t) })
										: sizeText(q?.size)}
									added={addedText(t.added_at, now)}
									playLabel={card.playLabel}
									reset={card.reset}
									mark={card.mark}
									lang={card.lang}
									download={card.download}
									onplay={card.onplay}
									onclick={() => open(t)}
								/>
							{:else}
								{@render rowSkeleton(t.title)}
							{/if}
						{/each}
					</div>
				</div>
			{:else}
				<EmptyState icon="list-filter" title={i18n.library_nothing_matches()}>
					{#snippet action()}
						<Button variant="secondary" onclick={() => set({ flags: [], genre: null })}>
							{i18n.library_clear_filters()}
						</Button>
					{/snippet}
				</EmptyState>
			{/if}
		</div>
	{/if}
</div>

<style>
.library {
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

.page {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 20px;
	box-sizing: border-box;
}

.top {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 14px 20px;
}

.heading {
	display: flex;
	align-items: baseline;
	gap: 14px;
}

h1 {
	margin: 0;
	font-size: 30px;
	font-weight: 700;
	letter-spacing: -0.025em;
}

.count {
	font: 400 12.5px var(--font-mono);
	color: var(--fg-subtle);
}

.tools {
	display: flex;
	align-items: center;
	gap: 8px;
}

.genre {
	position: relative;
}

.genre-btn {
	height: 36px;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 0 10px 0 12px;
	border: 0;
	border-radius: 10px;
	box-shadow: inset 0 0 0 1px var(--border);
	background: color-mix(in srgb, var(--fg) 4%, transparent);
	color: var(--fg-muted);
	font-size: 13px;
	font-weight: 500;
	white-space: nowrap;
	cursor: pointer;
	transition:
		background var(--dur-fast),
		color var(--dur-fast);
}

.genre-btn:hover {
	color: var(--fg);
}

.genre-btn.on {
	box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
	background: var(--accent-soft);
	color: var(--fg);
}

.chev {
	display: grid;
	transition: transform var(--dur-base) var(--ease);
}

.chev.open {
	transform: rotate(180deg);
}

.genre-panel {
	position: absolute;
	left: 0;
	top: 40px;
	z-index: 6;
	transform-origin: top left;
	opacity: 0;
	transform: translateY(-6px) scale(0.97);
	pointer-events: none;
	transition:
		opacity 130ms var(--ease-in),
		transform 150ms var(--ease-in);
}

.genre-panel.shown {
	opacity: 1;
	transform: translateY(0) scale(1);
	pointer-events: auto;
	transition:
		opacity 160ms var(--ease),
		transform 220ms var(--ease);
}

.flags {
	margin: 0;
	padding: 0;
	border: 0;
	min-width: 0;
	display: flex;
	align-items: center;
	gap: 6px;
}

.rule {
	width: 1px;
	height: 22px;
	background: var(--border-strong);
	margin: 0 6px;
}

.tabs {
	display: flex;
	gap: 22px;
	margin-top: -4px;
	border-bottom: 1px solid var(--border);
}

.tab {
	position: relative;
	padding: 0 0 12px;
	border: 0;
	background: transparent;
	color: var(--fg-muted);
	font-size: 14px;
	font-weight: 500;
	cursor: pointer;
}

.tab:hover,
.tab[aria-current="page"] {
	color: var(--fg);
}

.tab[aria-current="page"] {
	font-weight: 600;
}

.line {
	position: absolute;
	left: 0;
	right: 0;
	bottom: -1px;
	height: 2px;
	border-radius: 2px;
	background: var(--accent);
	opacity: 0;
	transition: opacity var(--dur-fast);
}

[aria-current="page"] > .line {
	opacity: 1;
}

.rails {
	display: flex;
	flex-direction: column;
	gap: 30px;
}

.cell {
	flex: none;
	scroll-snap-align: start;
}

.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(var(--min), 1fr));
	gap: 32px 24px;
}

.table {
	display: flex;
	flex-direction: column;
}

.head {
	display: grid;
	grid-template-columns: var(--cols);
	gap: 16px;
	align-items: center;
	height: 36px;
	padding: 0 12px;
	border-bottom: 1px solid var(--border);
}

.th {
	display: flex;
	align-items: center;
	gap: 4px;
	height: 36px;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--fg-faint);
	font: 500 10.5px var(--font-mono);
	letter-spacing: 0.1em;
	text-transform: uppercase;
	white-space: nowrap;
	cursor: pointer;
}

.th.end {
	justify-content: flex-end;
}

.th:hover {
	color: var(--fg-muted);
}

.th.sorted {
	color: var(--fg);
}

.th :global(.sl-ico) {
	opacity: 0;
	transition: transform var(--dur-fast) var(--ease);
}

.th.up :global(.sl-ico) {
	transform: rotate(180deg);
}

.th.sorted :global(.sl-ico) {
	opacity: 1;
}
</style>
