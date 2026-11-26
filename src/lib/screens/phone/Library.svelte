<script lang="ts">
import { onMount, untrack } from "svelte";
import { isNew, years } from "#lib/core/browse.ts";
import { addedText, badges } from "#lib/core/format.ts";
import { lib, loadLibrary, loadSeasons } from "#lib/core/library.svelte.ts";
import {
	browseRails,
	type Flag,
	genres,
	MENU_SORTS,
	type Rail,
	type Sort,
	toggleFlag,
	type View,
	viewFromQuery,
	viewToQuery,
	visible,
} from "#lib/core/library-view.ts";
import { prefs } from "#lib/core/prefs.svelte.ts";
import type { Kind, Title } from "#lib/core/types.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import LoadFailed from "#lib/screens/LoadFailed.svelte";
import { titleCard } from "#lib/screens/title-card.svelte.ts";
import BackdropCard from "#lib/ui/BackdropCard.svelte";
import Button from "#lib/ui/Button.svelte";
import EmptyState from "#lib/ui/EmptyState.svelte";
import Icon from "#lib/ui/Icon.svelte";
import TitleMenu from "#lib/shells/phone/TitleMenu.svelte";
import { goto } from "#lib/ui/nav.ts";
import PosterCard from "#lib/ui/PosterCard.svelte";
import { progressive } from "#lib/ui/progressive.svelte.ts";
import { artwork, home, library, title, watchState } from "#platform";
import { page } from "$app/state";

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
const rows = progressive(
	() => (isAll ? items : []),
	() => kind,
);
const shown = $derived(items.slice(0, rows.drawn));
const track = rows.track;

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
const chips = $derived<Flag[]>(["unwatched", "progress", "uhd", "hdr", extraFlag]);
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

function go(next: Kind, v: View) {
	const q = viewToQuery(v);
	goto(`/library/${next}${q ? `?${q}` : ""}`, { replace: true, reset: false });
}
const set = (patch: Partial<View>) => go(kind, { ...view, ...patch });
const cycleSort = () =>
	set({
		sort: MENU_SORTS[(MENU_SORTS.indexOf(view.sort) + 1) % MENU_SORTS.length],
		sortRev: false,
	});

function seeAll(r: Rail) {
	set(r.seeAll);
	document.querySelector(".content")?.scrollTo({ top: 0 });
}

const runtime = (m: number) =>
	i18n.common_runtime_hm({ h: Math.floor(m / 60), m: String(m % 60).padStart(2, "0") });
const railSub = (t: Title) => {
	if (kind === "series") {
		const count = t.total_seasons ?? t.seasons?.length ?? 0;
		return `${years(t)} · ${count === 1 ? i18n.common_seasons_one({ count }) : i18n.common_seasons_other({ count })}`;
	}
	return [t.year, t.runtime ? runtime(t.runtime) : ""].filter(Boolean).join(" · ");
};
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

const open = (t: Title) => goto(`/detail/${kind}/${t.id}`);
const empty = $derived(lib.loaded && base.length === 0);

$effect(() => {
	if (kind === "series" && lib.loaded && lib.shows.some((s) => !s.seasons))
		untrack(() => loadSeasons(port));
});

onMount(() => {
	loadLibrary(port, lib.loaded);
});
</script>

{#snippet skeleton(name: string)}
	<div class="skeleton">
		<span class="slp-art slp-mk--phone"></span>
		<span class="skeleton-title">{name}</span>
	</div>
{/snippet}

<div class="library">
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
		<div class="page">
			<div class="heading">
				<TitleMenu
					here={kind}
					title={kind === "series" ? i18n.nav_shows() : i18n.nav_movies()}
					label={i18n.nav_library()}
					width={260}
					items={[
						{
							key: "movies",
							icon: "film",
							label: i18n.nav_movies(),
							sub: i18n.library_total_movies({ count: lib.movies.length }),
						},
						{
							key: "series",
							icon: "tv-minimal",
							label: i18n.nav_shows(),
							sub: i18n.library_total_shows({ count: lib.shows.length }),
						},
					]}
					onpick={(k) => goto(`/library/${k}`)}
				/>
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
				<div class="rails">
					{#each rails as r (`${r.id}:${r.genre ?? ""}`)}
						<section aria-label={railTitle(r)}>
							<div class="rail-head">
								<h2>{railTitle(r)}</h2>
								<button type="button" class="see-all" onclick={() => seeAll(r)}>
									{i18n.rail_see_all()}
								</button>
							</div>
							<div class="scroller" class:wide={r.wide}>
								{#each r.titles as t (t.id)}
									{@const card = titleCard(kind, t, now)}
									{#if r.wide}
										<div class="cell" style:width="270px">
											<BackdropCard
												size="phone"
												title={t.title}
												sub={railSub(t)}
												eyebrow={eyebrow(t)}
												backdrop={artwork(kind, t.id, "backdrop")}
												poster={artwork(kind, t.id, "poster")}
												info={card.info}
												leftLabel={card.leftLabel}
												onclick={() => open(t)}
											/>
										</div>
									{:else}
										<div class="cell" style:width="112px">
											<PosterCard
												size="phone"
												title={t.title}
												sub={railSub(t)}
												src={artwork(kind, t.id, "poster")}
												{...card}
												badge={undefined}
												onclick={() => open(t)}
											/>
										</div>
									{/if}
								{/each}
							</div>
						</section>
					{/each}
				</div>
			{:else}
				<div class="genres" role="tablist" aria-label={i18n.library_genre()}>
					{#each [
						{ name: null, label: i18n.library_all(), none: false },
						...genreList.map((g) => ({ name: g.name, label: g.name, none: g.count === 0 })),
					] as g (g.name ?? "")}
						<button
							type="button"
							role="tab"
							class="genre"
							class:none={g.none}
							class:on={view.genre === g.name}
							aria-selected={view.genre === g.name}
							onclick={() => set({ genre: g.name })}
						>
							{g.label}<span class="line"></span>
						</button>
					{/each}
				</div>
				<div class="tools">
					{#each chips as f (f)}
						{@const on = view.flags.includes(f)}
						<button
							type="button"
							class="chip"
							class:on
							aria-pressed={on}
							onclick={() => set({ flags: toggleFlag(view.flags, f) })}
						>
							{#if on}
								<Icon name="check" size={13} stroke={2.5} />
							{/if}
							{flagLabel[f]}
						</button>
					{/each}
					<span class="spacer"></span>
					<button
						type="button"
						class="sort"
						aria-label={i18n.library_phone_sort({ sort: sortLabel(view.sort) })}
						onclick={cycleSort}
					>
						<Icon name="arrow-up-down" size={14} stroke={1.75} />{sortLabel(view.sort)}
					</button>
				</div>
				{#if items.length}
					<div class="grid" style:padding-bottom="{rows.after}px" use:track>
						{#each shown as t (t.id)}
							{#if rows.real(t.id)}
								<PosterCard
									size="phone"
									title={t.title}
									sub={sub(t)}
									src={artwork(kind, t.id, "poster")}
									{...titleCard(kind, t, now)}
									onclick={() => open(t)}
								/>
							{:else}
								{@render skeleton(t.title)}
							{/if}
						{/each}
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
	padding-top: env(safe-area-inset-top);
	box-sizing: border-box;
}

.page {
	display: flex;
	flex-direction: column;
	gap: 14px;
	padding-top: calc(env(safe-area-inset-top) + 4px);
}

.heading {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	padding: 8px 20px 0;
}

.count {
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
}

.tabs {
	display: flex;
	gap: 22px;
	padding: 0 20px;
	border-bottom: 1px solid var(--border);
}

.tab {
	position: relative;
	height: 42px;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--fg-muted);
	font-size: 14px;
	font-weight: 500;
	cursor: pointer;
}

.tab[aria-current="page"] {
	color: var(--fg);
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
}

[aria-current="page"] > .line,
.genre.on > .line {
	opacity: 1;
}

.rails {
	display: flex;
	flex-direction: column;
	gap: 24px;
	padding-top: 2px;
}

.rails section {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.rail-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	padding: 0 20px;
}

h2 {
	margin: 0;
	font-size: 17px;
	font-weight: 600;
	letter-spacing: -0.01em;
}

.see-all {
	height: 32px;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--accent-text);
	font-size: 13px;
	font-weight: 500;
	cursor: pointer;
}

.scroller {
	display: flex;
	gap: 10px;
	overflow-x: auto;
	padding: 0 20px 4px;
	scroll-snap-type: x mandatory;
	scroll-padding: 0 20px;
	scrollbar-width: none;
}

.scroller.wide {
	gap: 12px;
}

.cell {
	flex: none;
	scroll-snap-align: start;
}

.genres {
	display: flex;
	gap: 22px;
	overflow-x: auto;
	padding: 0 20px;
	margin-top: -2px;
	border-bottom: 1px solid var(--border);
	scrollbar-width: none;
}

.genre {
	position: relative;
	flex: none;
	height: 44px;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--fg-muted);
	font-size: 14px;
	font-weight: 500;
	white-space: nowrap;
	cursor: pointer;
}

.genre.none {
	color: var(--fg-faint);
}

.genre.on {
	color: var(--fg);
	font-weight: 600;
}

.tools {
	display: flex;
	gap: 8px;
	overflow-x: auto;
	padding: 0 20px;
	scrollbar-width: none;
}

.chip,
.sort {
	flex: none;
	display: flex;
	align-items: center;
	height: 34px;
	border-radius: var(--radius-full);
	background: transparent;
	font-size: 13px;
	white-space: nowrap;
	cursor: pointer;
}

.chip {
	gap: 6px;
	padding: 0 13px;
	border: 1px solid var(--border-strong);
	color: var(--fg-muted);
	font-weight: 500;
}

.chip.on {
	border-color: color-mix(in srgb, var(--accent) 45%, transparent);
	background: color-mix(in srgb, var(--accent) 16%, transparent);
	color: var(--fg);
}

.chip.on :global(.sl-ico) {
	margin-left: -2px;
}

.spacer {
	flex: 1;
}

.sort {
	gap: 6px;
	padding: 0 12px;
	border: 1px solid var(--border-strong);
	color: var(--fg-muted);
}

.grid {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 16px 10px;
	padding: 4px 20px 0;
}

.skeleton {
	display: flex;
	flex-direction: column;
	gap: 6px;
	min-width: 0;
}

.skeleton-title {
	font-size: 12px;
	line-height: 1.3;
	color: transparent;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	background: linear-gradient(var(--surface-2), var(--surface-2)) left center / 70% 9px no-repeat;
}
</style>
