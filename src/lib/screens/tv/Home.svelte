<script module lang="ts">
import type { Kind, Title } from "#lib/core/types.ts";
import { continueWatching, playUrl } from "#lib/core/browse.ts";
import { badges, left, meta, stillPos } from "#lib/core/format.ts";
import { artwork, home, library, title as fetchTitle, watchState } from "#platform";
import { orPoster } from "#lib/ui/img.ts";

type Item = {
	key: string;
	kind: Kind;
	t: Title;
	eyebrow: string;
	img?: string;
	pos?: string;
	code?: string;
	pct?: number;
	left?: string;
	href: string;
};
type Row = { title: string; wide: boolean; h: number; ch: number; items: Item[] };

// Coming back to Home shows the last rows at once; a fresh load replaces them.
let cached: Row[] | null = null;
</script>

<script lang="ts">
import { lib, loadLibrary } from "#lib/core/library.svelte.ts";
import { watchInfo } from "#lib/core/watch-info.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { goto, staticUrl } from "#lib/ui/nav.ts";
import PosterCard from "#lib/ui/PosterCard.svelte";
import LoadFailed from "#lib/tv/LoadFailed.svelte";
import TvScreen from "#lib/tv/TvScreen.svelte";
import { focusDefault } from "#lib/tv/focus.ts";
import { onMount, tick } from "svelte";

const SCREEN_H = 1080;
const GENRE_ROW_LIMIT = 12;
let loaded = $state(!!cached);
let failed = $state<string | null>(null);
let rows = $state.raw<Row[]>(cached ?? []);
let fid = $state<string | null>(null);
let row = $state(0);
let slots = $state.raw<(Item | null)[]>([null, null]);
let front = $state(0);

const focused = $derived(
	rows.flatMap((r) => r.items).find((it) => it.key === fid) ?? rows[0]?.items[0] ?? null,
);
const rowY = $derived.by(() => {
	const cur = rows[row];
	if (!cur) return 0;
	let y = SCREEN_H - 600 - 64 - 70 - cur.ch;
	for (let i = 0; i < row; i++) y -= rows[i]?.h ?? 0;
	return y;
});

// Two background slots crossfade, so swapping art never jumps.
$effect(() => {
	const it = focused;
	if (!it) return;
	const shown = slots[front];
	if (shown?.t === it.t) return;
	if (!shown) {
		slots = front === 0 ? [it, slots[1] ?? null] : [slots[0] ?? null, it];
		return;
	}
	slots = front === 0 ? [shown, it] : [it, shown];
	front = 1 - front;
});

const poster = (kind: Kind, t: Title, label: string): Item => ({
	key: `${label}:${kind}:${t.id}`,
	kind,
	t,
	eyebrow: label,
	href: `/detail/${kind}/${t.id}`,
});

onMount(() => {
	const first = !cached;
	load().then(
		() => {
			onLoaded();
			// The screen's own default focus gives up after ~2 s and lands on the tabs.
			if (first)
				tick().then(
					() =>
						!document.activeElement?.closest(".rows") &&
						focusDefault(document.querySelector<HTMLElement>("[data-tv-screen]") ?? document.body),
				);
		},
		(e) => {
			if (!cached) failed = String(e);
		},
	);
});

function onLoaded() {
	cached = rows;
	loaded = true;
	failed = null;
}

async function load() {
	await loadLibrary({ library, watchState, home, title: fetchTitle }, true);
	if (lib.error !== null) throw new Error(lib.error);
	const { movies, shows, watch } = lib;
	const cont: Item[] = continueWatching(movies, shows, watch).flatMap((r): Item[] => {
		const t = (r.kind === "movies" ? movies : shows).find((x) => x.id === r.id);
		if (!t) return [];
		const common = {
			kind: r.kind,
			t,
			img: artwork(r.kind, t.id, "backdrop"),
			pct: r.pct,
			left: left(r.left),
			href: playUrl(r.kind, r.id, r.episodeId, !r.next),
		};
		if (r.kind === "movies")
			return [
				{
					...common,
					key: `movie:${t.id}`,
					eyebrow: i18n.home_continue_watching(),
					pos: "50% 35%",
					code: r.code,
				},
			];
		const ep = { season: r.season as number, episode: r.episode as number, title: r.sub };
		return [
			{
				...common,
				key: `ep:${r.episodeId}`,
				eyebrow: r.next ? i18n.home_up_next_episode(ep) : i18n.home_continue_episode(ep),
				pos: stillPos(ep.episode, ep.season),
				code: i18n.common_episode_code({ season: ep.season, episode: ep.episode }),
			},
		];
	});
	const recent = (list: Title[]) => [...list].sort((a, b) => b.added_at.localeCompare(a.added_at));
	const counts = new Map<string, number>();
	for (const m of [...movies, ...shows])
		if (m.genres[0]) counts.set(m.genres[0], (counts.get(m.genres[0]) ?? 0) + 1);
	const genre = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
	rows = [
		...(cont.length
			? [{ title: i18n.home_continue_watching(), wide: true, h: 407, ch: 270, items: cont }]
			: []),
		{
			title: i18n.home_recent_movies(),
			wide: false,
			h: 454,
			ch: 348,
			items: recent(movies)
				.slice(0, 12)
				.map((t) => poster("movies", t, i18n.home_recently_added())),
		},
		{
			title: i18n.home_recent_shows(),
			wide: false,
			h: 454,
			ch: 348,
			items: recent(shows)
				.slice(0, 12)
				.map((t) => poster("series", t, i18n.home_new_episodes())),
		},
		{
			title: genre,
			wide: false,
			h: 454,
			ch: 348,
			items: [
				...movies.filter((t) => t.genres.includes(genre)).map((t) => poster("movies", t, genre)),
				...shows.filter((t) => t.genres.includes(genre)).map((t) => poster("series", t, genre)),
			].slice(0, GENRE_ROW_LIMIT),
		},
	].filter((r) => r.items.length);
}

const onFocus = (it: Item, ri: number) => {
	fid = it.key;
	row = ri;
};
</script>

<TvScreen tab={loaded && failed === null ? "home" : undefined}>
	{#if failed !== null}
		<LoadFailed error={failed} retry={load} onloaded={onLoaded} />
	{:else if !loaded}
		<div class="boot">
			<img src={staticUrl("streamline-mark.png")} alt="" width="56" height="56">
		</div>
	{/if}
	{#each slots as slot, i}
		{#if slot}
			<div class="bg" style:opacity={i === front ? 1 : 0}>
				<!-- A fresh element per title: the poster fallback's position must not carry over to the next backdrop. -->
				{#key slot.t}
					<img
						src={artwork(slot.kind, slot.t.id, "backdrop")}
						alt=""
						onerror={orPoster(artwork(slot.kind, slot.t.id, "poster"), "50% 22%")}
					>
				{/key}
			</div>
		{/if}
	{/each}
	<div class="shade side"></div>
	<div class="shade low"></div>
	{#if focused}
		<div class="hero">
			<span class="eyebrow">{focused.eyebrow}</span>
			<h1>{focused.t.title}</h1>
			<div class="meta">
				<span>{meta(focused.kind, focused.t)}</span>
				{#each badges(focused.t.file_summary) as c}
					<span class="chip">{c}</span>
				{/each}
			</div>
			<p>{focused.t.overview}</p>
			{#if focused.pct}
				<span class="progress"
					><span class="bar"><span style:width="{focused.pct}%"></span></span>{focused.left}</span
				>
			{/if}
		</div>
	{/if}
	<div class="rows" data-tv-noscroll="1">
		<div class="rows-in" style:transform="translateY({rowY}px)">
			{#each rows as r, ri}
				<section
					style:height="{r.h}px"
					style:opacity={ri === row ? 1 : 0}
					style:pointer-events={ri === row ? "auto" : "none"}
				>
					<h2 style:color={ri === row ? "var(--fg)" : "var(--fg-subtle)"}>{r.title}</h2>
					<div class="row" data-tv-row="1">
						{#each r.items as it, ii (it.key)}
							{#if r.wide}
								<button
									type="button"
									data-tv="1"
									data-tv-default={ri === 0 && ii === 0 ? "1" : undefined}
									data-fid={it.key}
									class="wide"
									onfocus={() => onFocus(it, ri)}
									onclick={() => goto(it.href)}
								>
									<img
										src={it.img}
										alt=""
										loading="lazy"
										style:object-position={it.pos}
										onerror={orPoster(artwork(it.kind, it.t.id, "poster"))}
									>
									<span class="wide-shade"></span>
									<span class="cap"
										><span class="cap-title">{it.t.title}</span
										><span class="cap-code">{it.code}</span></span
									>
									<span class="wide-bar"><span style:width="{it.pct}%"></span></span>
								</button>
							{:else}
								<PosterCard
									size="tv"
									bare
									width={232}
									title={it.t.title}
									src={artwork(it.kind, it.t.id, "poster")}
									info={watchInfo(it.t, it.kind, lib.watch)}
									leftLabel={i18n.card_left_label({
										count: watchInfo(it.t, it.kind, lib.watch).left,
									})}
									tv={{
										fid: it.key,
										isDefault: ri === 0 && ii === 0,
										onfocus: () => onFocus(it, ri),
									}}
									onclick={() => goto(it.href)}
								/>
							{/if}
						{/each}
					</div>
				</section>
			{/each}
		</div>
	</div>
</TvScreen>

<style>
.boot {
	position: absolute;
	inset: 0;
	display: grid;
	place-items: center;
}

.boot img {
	border-radius: 14px;
}

.bg {
	position: absolute;
	inset: 0;
	overflow: hidden;
	transition: opacity 450ms ease;
}

.bg img {
	position: absolute;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
	object-position: 65% 25%;
}

.shade {
	position: absolute;
	inset: 0;
}

.side {
	background: linear-gradient(
		90deg,
		color-mix(in srgb, var(--bg-deep) 96%, transparent) 0%,
		color-mix(in srgb, var(--bg-deep) 86%, transparent) 40%,
		color-mix(in srgb, var(--bg-deep) 50%, transparent) 60%,
		transparent 82%
	);
}

.low {
	background: linear-gradient(
		0deg,
		var(--bg-deep) 0%,
		var(--hero-scrim) 22%,
		color-mix(in srgb, var(--bg-deep) 50%, transparent) 38%,
		transparent 58%
	);
}

.hero {
	position: absolute;
	left: 96px;
	top: 226px;
	width: 1120px;
	display: flex;
	flex-direction: column;
	gap: 20px;
	text-shadow: 0 2px 16px rgba(0, 0, 0, 0.45);
}

.eyebrow {
	font: 500 24px / 1 var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--accent-text);
}

h1 {
	margin: 0;
	font-size: 100px;
	line-height: 1.02;
	font-weight: 700;
	letter-spacing: -0.03em;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.meta {
	display: flex;
	align-items: center;
	gap: 16px;
	font: 400 26px var(--font-mono);
	color: var(--fg-muted);
}

.chip {
	padding: 4px 12px;
	border-radius: 9px;
	border: 1.5px solid rgba(255, 255, 255, 0.28);
	font-size: 21px;
	color: var(--fg);
}

p {
	margin: 0;
	max-width: 900px;
	font-size: 29px;
	line-height: 1.5;
	color: var(--fg-muted);
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.progress {
	display: flex;
	align-items: center;
	gap: 18px;
	font: 400 22px var(--font-mono);
	color: var(--fg-muted);
}

.bar {
	width: 280px;
	height: 6px;
	border-radius: 3px;
	background: rgba(255, 255, 255, 0.2);
	overflow: hidden;
}

.bar > span,
.wide-bar > span {
	display: block;
	height: 100%;
	background: var(--accent);
}

.rows {
	position: absolute;
	left: 0;
	right: 0;
	top: 600px;
	bottom: 0;
	overflow: hidden;
}

.rows-in {
	transition: transform 340ms var(--ease);
}

section {
	display: flex;
	flex-direction: column;
	gap: 2px;
	transition: opacity var(--dur-slow);
}

h2 {
	margin: 0;
	padding-left: 96px;
	font-size: 28px;
	font-weight: 600;
}

.row {
	display: flex;
	gap: 26px;
	overflow: hidden;
	padding: 26px 96px 24px;
}

.wide {
	flex: none;
	position: relative;
	display: block;
	padding: 0;
	border: 0;
	overflow: hidden;
	background: var(--bg-card);
	cursor: pointer;
	outline: none;
	transition:
		transform 220ms var(--ease),
		box-shadow 220ms;
}

.wide {
	width: 480px;
	aspect-ratio: 16 / 9;
	border-radius: 14px;
}

.wide:focus {
	transform: translateY(-10px);
	box-shadow: var(--shadow-tv-focus);
}

.wide img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
}

.wide-shade {
	position: absolute;
	inset: 0;
	background: linear-gradient(0deg, rgba(0, 0, 0, 0.75) 0%, rgba(0, 0, 0, 0) 55%);
}

.cap {
	position: absolute;
	left: 18px;
	right: 18px;
	bottom: 16px;
	display: flex;
	justify-content: space-between;
	align-items: flex-end;
	gap: 12px;
	text-align: left;
}

.cap-title {
	font-size: 23px;
	font-weight: 600;
	color: var(--fg);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.cap-code {
	flex: none;
	font: 500 18px var(--font-mono);
	color: var(--fg-muted);
}

.wide-bar {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	height: 5px;
	background: rgba(255, 255, 255, 0.2);
}
</style>
