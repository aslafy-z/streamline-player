<script lang="ts">
import LoadFailed from "#lib/screens/LoadFailed.svelte";
import "#lib/ui/card.css";
import { onMount } from "svelte";
import { stars, years } from "#lib/core/browse.ts";
import { runtime } from "#lib/core/format.ts";
import { lib, loadLibrary } from "#lib/core/library.svelte.ts";
import {
	genreTiles,
	type Hit,
	loadRecent,
	rememberSearch,
	saveRecent,
	searchTitles,
	tagged,
} from "#lib/core/search-view.ts";
import { watchInfo } from "#lib/core/watch-info.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { getLocale } from "#lib/paraglide/runtime.js";
import Art from "#lib/ui/Art.svelte";
import EmptyState from "#lib/ui/EmptyState.svelte";
import Icon from "#lib/ui/Icon.svelte";
import { goto } from "#lib/ui/nav.ts";
import { artwork, home, library, title, watchState } from "#platform";
import { afterNavigate } from "$app/navigation";
import { page } from "$app/state";

const GENRE_TILES = 8;
const TYPE_DELAY_MS = 150;
const port = { library, watchState, home, title };

const urlQ = $derived(page.url.searchParams.get("q") ?? "");
const initialQ = page.url.searchParams.get("q") ?? "";
let text = $state(initialQ);
let input = $state<HTMLInputElement>();
let recent = $state(loadRecent());
let pushed = initialQ;
let timer: ReturnType<typeof setTimeout> | undefined;
let fromApp = false;

afterNavigate(({ from, to }) => {
	if (from && from.url.pathname === to?.url.pathname) return;
	fromApp = from !== null;
});

$effect(() => {
	const external = urlQ;
	if (external !== pushed) {
		pushed = external;
		text = external;
	}
});

function push(replace = true) {
	clearTimeout(timer);
	pushed = text;
	goto(`/search${text ? `?q=${encodeURIComponent(text)}` : ""}`, { replace, reset: false });
}

const ask = (q: string, replace = true) => {
	text = q;
	push(replace);
	input?.focus();
};

function onkeydown(e: KeyboardEvent) {
	if (e.key !== "Escape") return;
	e.preventDefault();
	if (text) return ask("");
	if (fromApp) history.back();
	else goto("/");
}

const all = $derived(tagged(lib.movies, lib.shows));
const q = $derived(urlQ.trim());
const hits = $derived(searchTitles(all, q));
const tiles = $derived(genreTiles(all).slice(0, GENRE_TILES));
const empty = $derived(lib.loaded && all.length === 0);

const seasons = (t: Hit) => {
	const n = t.total_seasons ?? t.seasons?.length ?? 0;
	return n === 1 ? i18n.common_seasons_one({ count: n }) : i18n.common_seasons_other({ count: n });
};
const sub = (t: Hit) =>
	t.kind === "series"
		? [years(t), seasons(t)].join(" · ")
		: [t.year, t.runtime ? runtime(t.runtime) : ""].filter(Boolean).join(" · ");
const top = $derived(hits[0]);
const topMeta = (t: Hit) =>
	[sub(t), stars(t.rating, t.rating.toLocaleString(getLocale()))].filter(Boolean).join(" · ");
const kindLabel = (t: Hit) =>
	t.kind === "series" ? i18n.search_kind_show() : i18n.search_kind_movie();

function open(t: Hit) {
	recent = rememberSearch(recent, q);
	saveRecent(recent);
	goto(`/detail/${t.kind}/${t.id}`);
}

onMount(() => {
	loadLibrary(port, lib.loaded);
	return () => clearTimeout(timer);
});
</script>

<div class="search">
	<div class="sticky">
		<h1>{i18n.search_placeholder()}</h1>
		<div class="field">
			<Icon name="search" size={18} />
			<input
				bind:this={input}
				bind:value={text}
				data-search-field
				placeholder={i18n.search_phone_placeholder()}
				spellcheck="false"
				autocomplete="off"
				oninput={() => {
					clearTimeout(timer);
					timer = setTimeout(push, TYPE_DELAY_MS);
				}}
				{onkeydown}
			>
			{#if text}
				<button
					type="button"
					class="clear"
					aria-label={i18n.search_clear()}
					onclick={() => ask("")}
				>
					<Icon name="x" size={13} />
				</button>
			{/if}
		</div>
	</div>

	{#if lib.error !== null}
		<LoadFailed error={lib.error} retry={() => loadLibrary(port, true)} />
	{:else if empty}
		<EmptyState icon="film" title={i18n.home_empty_title()} text={i18n.home_empty_text()} />
	{:else if lib.loaded && !q}
		<div class="idle">
			{#if recent.length}
				<div class="recent">
					<h2>{i18n.search_phone_recent()}</h2>
					{#each recent as r (r)}
						<button type="button" class="recent-row" onclick={() => ask(r, false)}>
							<Icon name="history" size={16} stroke={1.75} />{r}
						</button>
					{/each}
				</div>
			{/if}
			<div class="genres">
				<h2>{i18n.search_phone_genres()}</h2>
				<div class="tiles">
					{#each tiles as g (g.name)}
						<button type="button" class="tile" onclick={() => ask(g.name, false)}>
							{g.name}<span class="n">{g.count}</span>
						</button>
					{/each}
				</div>
			</div>
		</div>
	{:else if lib.loaded && hits.length}
		<div class="results">
			<div class="found">
				{(hits.length === 1 ? i18n.search_in_library_one : i18n.search_in_library_other)({
					count: hits.length,
				})}
			</div>
			{#if top}
				<button type="button" class="top" onclick={() => open(top)}>
					<span class="poster"
						><Art src={artwork(top.kind, top.id, "poster")} kind="poster" /></span
					>
					<span class="top-copy">
						<span class="eyebrow">{i18n.search_top_result({ kind: kindLabel(top) })}</span>
						<span class="title">{top.title}</span>
						<span class="facts">{topMeta(top)}</span>
						<span class="overview">{top.overview}</span>
					</span>
				</button>
			{/if}
			{#each hits.slice(1) as t (`${t.kind}:${t.id}`)}
				{@const info = watchInfo(t, t.kind, lib.watch)}
				<button type="button" class="row" onclick={() => open(t)}>
					<span class="slp-art slp-mk--thumb thumb">
						<Art src={artwork(t.kind, t.id, "poster")} kind="poster" />
						{#if info.unread}
							<span class="slp-unread" aria-hidden="true"></span>
						{/if}
						{#if info.inProgress}
							<span class="slp-prog"
								><i><b style:width="{info.pct}%"></b></i></span
							>
						{/if}
					</span>
					<span class="copy">
						<span class="name">{t.title}</span>
						<span class="meta"
							>{kindLabel(t)}
							·
							{sub(t)}
							{#if info.left > 0}
								{" "}<span
									class="slp-count slp-count--inline"
									role="img"
									aria-label={i18n.card_left_label({ count: info.left })}
									>{info.left}</span
								>
							{/if}</span
						>
					</span>
					<Icon name="chevron-right" size={18} stroke={2} />
				</button>
			{/each}
		</div>
	{:else if lib.loaded}
		<EmptyState
			icon="search"
			title={i18n.search_phone_no_matches({ query: q })}
			text={i18n.search_phone_requests()}
		/>
	{/if}
</div>

<style>
.search {
	min-height: 100%;
	background: var(--bg-deep);
	color: var(--fg);
}

.sticky {
	position: sticky;
	top: 0;
	z-index: 2;
	padding: calc(env(safe-area-inset-top) + 8px) 20px 12px;
	background: color-mix(in srgb, var(--bg-deep) 92%, transparent);
	backdrop-filter: blur(16px);
	-webkit-backdrop-filter: blur(16px);
}

h1 {
	margin: 0 0 12px;
	font-size: 30px;
	font-weight: 700;
	letter-spacing: -0.025em;
}

.field {
	display: flex;
	align-items: center;
	gap: 10px;
	height: 46px;
	padding: 0 14px;
	border: 1px solid var(--border);
	border-radius: 12px;
	background: var(--bg-card);
	font-size: 16px;
	color: var(--fg);
}

.field:focus-within {
	border-color: var(--accent);
	box-shadow: 0 0 0 3px var(--accent-glow);
}

.field > :global(.sl-ico) {
	flex: none;
	color: var(--fg-subtle);
}

input {
	flex: 1;
	min-width: 0;
	height: 100%;
	padding: 0;
	border: 0;
	background: none;
	color: var(--fg);
	font: inherit;
	outline: none;
}

input::placeholder {
	color: var(--fg-faint);
}

.clear {
	display: grid;
	place-items: center;
	flex: none;
	width: 30px;
	height: 30px;
	margin-right: -6px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: var(--surface-2);
	color: var(--fg-muted);
	cursor: pointer;
}

.idle {
	display: flex;
	flex-direction: column;
	gap: 22px;
	padding: 8px 20px 0;
}

.recent,
.genres {
	display: flex;
	flex-direction: column;
}

.genres {
	gap: 10px;
}

h2 {
	margin: 0 0 4px;
	font: 500 10.5px var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--fg-faint);
}

.genres h2 {
	margin: 0;
}

.recent-row {
	display: flex;
	align-items: center;
	gap: 12px;
	height: 46px;
	padding: 0;
	border: 0;
	border-bottom: 1px solid var(--border);
	background: transparent;
	color: var(--fg);
	font-size: 15px;
	text-align: left;
	cursor: pointer;
}

.recent-row :global(.sl-ico) {
	color: var(--fg-faint);
}

.tiles {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
}

.tile {
	height: 52px;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 14px;
	border: 1px solid var(--border);
	border-radius: 12px;
	background: var(--bg-elevated);
	color: var(--fg);
	font-size: 14.5px;
	font-weight: 500;
	text-align: left;
	cursor: pointer;
}

.n {
	font: 400 11px var(--font-mono);
	color: var(--fg-subtle);
}

.results {
	display: flex;
	flex-direction: column;
	padding: 4px 20px 0;
}

.found {
	padding: 4px 0 8px;
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
}

.top {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr);
	gap: 14px;
	align-items: center;
	margin: 4px 0 10px;
	padding: 12px;
	border: 1px solid var(--border);
	border-radius: var(--radius-lg);
	background: var(--bg-elevated);
	color: var(--fg);
	text-align: left;
	cursor: pointer;
}

.top .poster {
	position: relative;
	width: 84px;
	aspect-ratio: 2 / 3;
	border-radius: var(--radius-md);
	overflow: hidden;
}

.top-copy {
	display: flex;
	flex-direction: column;
	gap: 6px;
	min-width: 0;
}

.top .eyebrow {
	font: 500 10px var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--accent-text);
}

.top .title {
	display: -webkit-box;
	overflow: hidden;
	font-size: 19px;
	font-weight: 700;
	line-height: 1.2;
	letter-spacing: -0.02em;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
}

.top .facts {
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
}

.top .overview {
	display: -webkit-box;
	overflow: hidden;
	font-size: 13px;
	line-height: 1.45;
	color: var(--fg-muted);
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
}

.row {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 8px 0;
	border: 0;
	background: transparent;
	color: var(--fg);
	text-align: left;
	cursor: pointer;
}

.row > :global(.sl-ico) {
	flex: none;
	color: var(--fg-faint);
}

.thumb {
	flex: none;
	width: 52px;
}

.copy {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 3px;
}

.name {
	font-size: 15px;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.meta {
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
}
</style>
