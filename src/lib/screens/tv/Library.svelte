<script lang="ts">
import { isNew } from "#lib/core/browse.ts";
import { addedText, railSub } from "#lib/core/format.ts";
import { lib, loadLibrary } from "#lib/core/library.svelte.ts";
import {
	browseRails,
	DEFAULT_VIEW,
	type Flag,
	type Rail,
	type Tab,
	visible,
} from "#lib/core/library-view.ts";
import type { Kind, Title } from "#lib/core/types.ts";
import { watchInfo } from "#lib/core/watch-info.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import LoadFailed from "#lib/tv/LoadFailed.svelte";
import TvScreen from "#lib/tv/TvScreen.svelte";
import BackdropCard from "#lib/ui/BackdropCard.svelte";
import { goto } from "#lib/ui/nav.ts";
import PosterCard from "#lib/ui/PosterCard.svelte";
import { progressive } from "#lib/ui/progressive.svelte.ts";
import { artwork, home, library, title, watchState } from "#platform";

const port = { library, watchState, home, title };

let { kind }: { kind: Kind } = $props();
let tab = $state<Tab>("browse");
let flags = $state<Flag[]>([]);

$effect(() => {
	kind;
	tab = "browse";
	flags = [];
});

$effect(() => {
	loadLibrary(port, lib.loaded);
});

const now = new Date();
const filters = $derived<[Flag, string][]>([
	["unwatched", i18n.library_unwatched()],
	["progress", i18n.library_in_progress()],
	["uhd", "4K"],
	["hdr", "HDR"],
	kind === "movies" ? ["short", i18n.rail_short()] : ["binge", i18n.library_binge()],
]);
const base = $derived(kind === "movies" ? lib.movies : lib.shows);
const items = $derived(visible(base, kind, lib.watch, { ...DEFAULT_VIEW, flags }));
const rails = $derived(
	tab === "browse" ? browseRails(base, kind, lib.watch, (t: Title) => isNew(t, now)) : [],
);
const rows = progressive(
	() => (tab === "all" ? items : []),
	() => kind,
);
const shown = $derived(items.slice(0, rows.drawn));
const track = rows.track;

function toggle(f: Flag) {
	const other: Partial<Record<Flag, Flag>> = { unwatched: "progress", progress: "unwatched" };
	flags = flags.includes(f)
		? flags.filter((x) => x !== f)
		: [...flags.filter((x) => x !== other[f]), f];
}

const open = (t: Title) => goto(`/detail/${kind}/${t.id}`);
const info = (t: Title) => watchInfo(t, kind, lib.watch);
const newest = $derived(
	base.reduce<Title | null>(
		(a, t) => (!a || Date.parse(t.added_at) > Date.parse(a.added_at) ? t : a),
		null,
	),
);
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
</script>

<TvScreen tab={lib.error === null ? kind : undefined} scroll>
	{#if lib.error !== null}
		<LoadFailed
			error={lib.error}
			retry={() => loadLibrary(port, true)}
			onloaded={() => {}}
			onback={() => history.back()}
		/>
	{:else}
		{#key kind}
			<div class="page">
				<div class="head">
					<h1>{kind === "series" ? i18n.nav_shows() : i18n.nav_movies()}</h1>
					{#if lib.loaded}
						<span class="count"
							>{#if tab === "all"}
								{(kind === "series" ? i18n.library_count_shows : i18n.library_count_movies)({
									count: items.length,
									total: base.length,
								})}
							{:else}
								{(kind === "series" ? i18n.library_total_shows : i18n.library_total_movies)({
									count: base.length,
								})}
							{/if}</span
						>
					{/if}
				</div>
				<div class="filters" role="tablist" aria-label={i18n.library_view_label()}>
					{#each [
						["browse", i18n.library_tab_browse()],
						[
							"all",
							kind === "movies" ? i18n.library_tab_all_movies() : i18n.library_tab_all_shows(),
						],
					] as [t, label] (t)}
						<button
							type="button"
							data-tv="1"
							data-tv-default={t === "browse" ? "1" : undefined}
							role="tab"
							class="filter tab"
							class:on={tab === t}
							aria-selected={tab === t}
							onclick={() => (tab = t as Tab)}
						>
							{label}
						</button>
					{/each}
				</div>
				{#if tab === "browse"}
					<div class="rails">
						{#each rails as r (`${r.id}:${r.genre ?? ""}`)}
							<section aria-label={railTitle(r)}>
								<div class="rail-head">
									<h2>{railTitle(r)}</h2>
									<span class="note">{railNote(r)}</span>
								</div>
								<div class="rail">
									{#each r.titles as t (t.id)}
										{#if r.wide}
											<div class="cell" style:width="480px">
												<BackdropCard
													size="tv"
													title={t.title}
													sub={railSub(kind, t)}
													eyebrow={t === newest
														? i18n.rail_added_today()
														: i18n.rail_added({ date: addedText(t.added_at, now) })}
													backdrop={artwork(kind, t.id, "backdrop")}
													poster={artwork(kind, t.id, "poster")}
													info={info(t)}
													leftLabel={i18n.card_left_label({ count: info(t).left })}
													tv={{ fid: `${r.id}:${t.id}` }}
													onclick={() => open(t)}
												/>
											</div>
										{:else}
											<PosterCard
												size="tv"
												bare
												width={232}
												title={t.title}
												src={artwork(kind, t.id, "poster")}
												info={info(t)}
												leftLabel={i18n.card_left_label({ count: info(t).left })}
												tv={{ fid: `${r.id}:${r.genre ?? ""}:${t.id}` }}
												onclick={() => open(t)}
											/>
										{/if}
									{/each}
								</div>
							</section>
						{/each}
					</div>
				{:else}
					<div class="filters">
						{#each filters as [f, label] (f)}
							<button
								type="button"
								data-tv="1"
								class="filter"
								class:on={flags.includes(f)}
								onclick={() => toggle(f)}
							>
								{label}
							</button>
						{/each}
					</div>
					<div class="grid" use:track style:padding-bottom="{rows.after}px">
						{#each shown as t (t.id)}
							<!-- Every card is focusable before its poster is drawn: the remote can reach any title at once. -->
							<PosterCard
								size="tv"
								title={t.title}
								src={rows.real(t.id) ? artwork(kind, t.id, "poster") : undefined}
								info={rows.real(t.id) ? info(t) : undefined}
								badge={isNew(t, now) ? i18n.home_new() : undefined}
								leftLabel={i18n.card_left_label({ count: info(t).left })}
								tv={{ fid: String(t.id) }}
								onclick={() => open(t)}
							/>
						{/each}
					</div>
				{/if}
			</div>
		{/key}
	{/if}
</TvScreen>

<style>
.page {
	padding: 156px 96px 96px;
	display: flex;
	flex-direction: column;
	gap: 30px;
}

.head {
	display: flex;
	align-items: baseline;
	gap: 22px;
}

h1 {
	margin: 0;
	font-size: 58px;
	font-weight: 700;
	letter-spacing: -0.03em;
}

.count {
	font: 400 24px var(--font-mono);
	color: var(--fg-subtle);
}

.filters {
	display: flex;
	gap: 14px;
}

.filter {
	height: 56px;
	padding: 0 26px;
	border-radius: 28px;
	border: 0;
	background: var(--surface-2);
	color: var(--fg-muted);
	font-size: 23px;
	font-weight: 500;
	cursor: pointer;
	outline: none;
	transition: transform var(--dur-fast);
}

.filter.tab {
	padding: 0 28px;
}

.filter.tab.on {
	font-weight: 600;
}

.filter.on {
	background: rgba(255, 255, 255, 0.16);
	color: var(--fg);
}

.filter:focus {
	background: var(--player-ink);
	color: var(--fg-on-accent);
	transform: scale(1.06);
}

.rails {
	display: flex;
	flex-direction: column;
	gap: 44px;
	margin: 0 -96px;
}

section {
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.rail-head {
	display: flex;
	align-items: baseline;
	gap: 18px;
	padding: 0 96px;
}

h2 {
	margin: 0;
	font-size: 30px;
	font-weight: 600;
	letter-spacing: -0.01em;
}

.note {
	font: 400 20px var(--font-mono);
	color: var(--fg-subtle);
}

.rail {
	display: flex;
	gap: 30px;
	overflow-x: auto;
	padding: 14px 96px 18px;
	scroll-padding: 0 96px;
	scrollbar-width: none;
}

.cell {
	flex: none;
}

.grid {
	display: grid;
	grid-template-columns: repeat(5, minmax(0, 1fr));
	gap: 52px 40px;
	padding-top: 10px;
}
</style>
