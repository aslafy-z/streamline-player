<script lang="ts">
import { onMount, untrack } from "svelte";
import { loadActivity, unread } from "#lib/core/activity.svelte.ts";
import { bellLabel } from "#lib/core/activity-view.ts";
import {
	arrivalDay,
	continueWatching,
	isNew,
	nextEpisode,
	playUrl,
	recentCount,
	recentlyAdded,
	topGenre,
	years,
} from "#lib/core/browse.ts";
import { badges, left, runtime, stillPos } from "#lib/core/format.ts";
import { lib, loadLibrary } from "#lib/core/library.svelte.ts";
import { account } from "#lib/core/me.svelte.ts";
import { picture, syncPicture } from "#lib/core/picture.svelte.ts";
import type { Kind, Title } from "#lib/core/types.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import LoadFailed from "#lib/screens/LoadFailed.svelte";
import { titleCard } from "#lib/screens/title-card.svelte.ts";
import Art from "#lib/ui/Art.svelte";
import Avatar from "#lib/ui/Avatar.svelte";
import { activityWords } from "#lib/ui/activity-words.ts";
import Button from "#lib/ui/Button.svelte";
import EmptyState from "#lib/ui/EmptyState.svelte";
import Icon from "#lib/ui/Icon.svelte";
import Mark from "#lib/ui/Mark.svelte";
import { goto } from "#lib/ui/nav.ts";
import PosterCard from "#lib/ui/PosterCard.svelte";
import ResumeCard from "#lib/ui/ResumeCard.svelte";
import { HERO_MS, heroRotation, ZOOM_MS } from "#lib/ui/hero-rotation.svelte.ts";
import { useScroll } from "#lib/ui/scroll.ts";
import {
	activity,
	artwork,
	home,
	library,
	markActivityRead,
	myPicture,
	title,
	watchState,
} from "#platform";

type Slide = {
	key: string;
	img: string;
	eyebrow: string;
	title: string;
	meta: string;
	primary: string;
	progress?: { pct: number; left: string };
	onprimary: () => void;
	oninfo: () => void;
};

const ROW_LIMIT = 12;
const SWIPE_MIN = 40;
const SWIPE_SLANT = 1.5;
const port = { library, watchState, home, title };
const activityPort = { activity, markActivityRead };
const AVATAR_COLOR = "var(--kind-album)";
const now = new Date();
const scroller = useScroll();

const resume = $derived(continueWatching(lib.movies, lib.shows, lib.watch));
const byKey = (kind: Kind, id: number) =>
	(kind === "movies" ? lib.movies : lib.shows).find((t) => t.id === id);
const arrivedEpisodes = (id: number) =>
	lib.feed?.arrivals.flatMap((d) => d.items).find((a) => a.kind === "series" && a.id === id)
		?.episodes?.length ?? 0;

const seasons = (n: number) =>
	n === 1 ? i18n.common_seasons_one({ count: n }) : i18n.common_seasons_other({ count: n });
const resLabel = (t: Title) => badges(t.file_summary)[0];
const movieSub = (t: Title) => [t.year, resLabel(t)].filter(Boolean).join(" · ");
const showSub = (t: Title) =>
	[seasons(t.total_seasons ?? t.seasons?.length ?? 0), years(t)].join(" · ");
const quality = (t: Title) =>
	[t.file_summary?.resolution, t.file_summary?.hdr].filter(Boolean).join(" ");

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
			oninfo: () => open(f.kind, f.id, going?.season ?? f.season),
		};
		if (going) {
			const episode = going.kind === "series";
			out.push({
				...base,
				meta: episode
					? i18n.home_phone_episode_meta({
							season: going.season as number,
							episode: going.episode as number,
							left: left(going.left),
						})
					: [t.year, t.runtime ? runtime(t.runtime) : "", quality(t)].filter(Boolean).join(" · "),
				primary: episode
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
			meta:
				f.kind === "series"
					? [years(t), seasons(t.total_seasons ?? t.seasons?.length ?? 0), quality(t)]
							.filter(Boolean)
							.join(" · ")
					: [t.year, t.runtime ? runtime(t.runtime) : "", quality(t)].filter(Boolean).join(" · "),
			primary: i18n.common_play(),
			onprimary: () => goto(playUrl(f.kind, f.id, ep?.id)),
		});
	}
	return out;
});

const hero = heroRotation(() => slides.length);
let down: { x: number; y: number } | null = null;

const slide = $derived(slides[hero.at]);

function swipe(el: HTMLElement) {
	const press = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
	const cancel = () => (down = null);
	el.addEventListener("pointerdown", press);
	el.addEventListener("pointerup", release);
	el.addEventListener("pointercancel", cancel);
	return {
		destroy() {
			el.removeEventListener("pointerdown", press);
			el.removeEventListener("pointerup", release);
			el.removeEventListener("pointercancel", cancel);
		},
	};
}

function release(e: PointerEvent) {
	if (!down) return;
	const dx = e.clientX - down.x;
	const dy = e.clientY - down.y;
	down = null;
	if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * SWIPE_SLANT)
		hero.go((hero.at + (dx < 0 ? 1 : slides.length - 1)) % slides.length);
}

const text = $derived(
	hero.phase === "out"
		? "opacity:0;transform:translateY(-10px);transition:opacity 240ms var(--ease-in), transform 240ms var(--ease-in)"
		: hero.phase === "pre"
			? "opacity:0;transform:translateY(18px);transition:none"
			: "opacity:1;transform:translateY(0);transition:opacity 600ms var(--ease) 80ms, transform 700ms var(--ease) 80ms",
);
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
			].slice(0, ROW_LIMIT)
		: [],
);
const badge = (t: Title, kind: Kind) => {
	const episodes = kind === "series" ? arrivedEpisodes(t.id) : 0;
	if (episodes) return i18n.home_new_count({ count: episodes });
	return isNew(t, now) ? i18n.home_new() : undefined;
};
const empty = $derived(lib.loaded && lib.movies.length + lib.shows.length === 0);

const bell = $derived(bellLabel(unread(), activityWords()));
const me = $derived(account.me);
$effect(() => {
	void syncPicture(myPicture, me?.picture, account.version);
});

onMount(() => {
	loadLibrary(port, lib.loaded);
	untrack(() => loadActivity(activityPort));
});

// The header stays at the top of the page and takes a background once the hero starts to leave.
const PIN_AFTER_PX = 24;
let scrolled = $state(false);
$effect(() => {
	const el = scroller?.();
	if (!el) return;
	const on = () => (scrolled = el.scrollTop > PIN_AFTER_PX);
	on();
	el.addEventListener("scroll", on, { passive: true });
	return () => el.removeEventListener("scroll", on);
});
</script>

<div class="home">
	{#if lib.error !== null}
		<LoadFailed error={lib.error} retry={() => loadLibrary(port, true)} />
	{:else if empty}
		<div class="state">
			<EmptyState icon="film" title={i18n.home_empty_title()} text={i18n.home_empty_text()} />
		</div>
	{:else if lib.loaded}
		<div class="pin">
			<div class="top" class:scrolled>
				<div class="brand">
					<Mark size={28} ring={false} />
					<span>streamline</span>
				</div>
				<div class="actions">
					<span class="bell">
						<Button
							variant="icon"
							icon="bell"
							label={bell}
							title={bell}
							dot={unread() > 0}
							onclick={() => goto("/activity")}
						/>
					</span>
					<button
						type="button"
						class="account"
						aria-label={i18n.nav_settings()}
						onclick={() => goto("/settings")}
					>
						<Avatar
							name={me?.name}
							email={me?.email}
							initials={me?.initials}
							color={AVATAR_COLOR}
							picture={picture.url}
							size={32}
						/>
					</button>
				</div>
			</div>
		</div>
		{#if slide}
			<section
				class="hero"
				class:reduced={hero.reduced}
				style:--hero-ms="{HERO_MS}ms"
				style:--zoom-ms="{ZOOM_MS}ms"
				use:swipe
				use:hero.watch
			>
				{#each slides as s, i (s.key)}
					<div
						class="frame"
						class:on={i === hero.at}
						class:zoom={hero.zooms(i)}
						class:zooming={hero.zooming(i)}
						onanimationend={hero.zoomEnded}
					>
						<Art src={s.img} position="50% 50%" />
					</div>
				{/each}
				<div class="scrim"></div>
				<div class="body" style={text}>
					<div class="eyebrow">{slide.eyebrow}</div>
					<h1>{slide.title}</h1>
					<div class="meta">{slide.meta}</div>
					<div class="buttons">
						<button type="button" class="cta" onclick={slide.onprimary}>
							<Icon name="play" filled size={18} />{slide.primary}
						</button>
						<button
							type="button"
							class="glass"
							aria-label={i18n.common_more_info()}
							onclick={slide.oninfo}
						>
							<Icon name="info" size={20} />
						</button>
					</div>
					{#if slide.progress}
						<div class="resume">
							<i><b style:width="{slide.progress.pct}%"></b></i>
							<span>{slide.progress.left}</span>
						</div>
					{/if}
				</div>
				{#if slides.length > 1}
					<div class="dots">
						{#each slides as s, i (s.key)}
							<button
								type="button"
								class="dot"
								style:width="{i === hero.at ? 26 : 10}px"
								aria-label={i18n.home_show_title({ title: s.title })}
								onclick={() => hero.go(i)}
							>
								<span class="track"
									><span
										class="fill"
										class:run={hero.fills(i)}
										class:ticking={hero.rotating}
									></span></span
								>
							</button>
						{/each}
					</div>
				{/if}
			</section>
		{/if}
		<div class="rows" class:bare={!slide}>
			{#if resume.length}
				<section>
					<div class="head">
						<h2>{i18n.home_continue_watching()}</h2>
						<span class="note">{i18n.home_count_in_progress({ count: resume.length })}</span>
					</div>
					<div class="scroller">
						{#each resume as r (r.mediaId)}
							{@const t = byKey(r.kind, r.id)}
							{@const c = t ? titleCard(r.kind, t, now) : undefined}
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
								width={248}
								reset={c?.reset}
								mark={c?.mark}
								oninfo={() => open(r.kind, r.id, r.season)}
								onclick={() => playResume(r)}
							/>
						{/each}
					</div>
				</section>
			{/if}
			{#if recentMovies.length}
				<section>
					<div class="head">
						<h2>{i18n.home_recent_movies()}</h2>
						<span class="note"
							>{i18n.home_count_month({ count: recentCount(recentMovies, now) })}</span
						>
					</div>
					<div class="scroller">
						{#each recentMovies as t (t.id)}
							<PosterCard
								size="phone"
								width={116}
								title={t.title}
								sub={movieSub(t)}
								src={artwork("movies", t.id, "poster")}
								{...titleCard("movies", t, now)}
								badge={badge(t, "movies")}
								onclick={() => open("movies", t.id)}
							/>
						{/each}
					</div>
				</section>
			{/if}
			{#if recentShows.length}
				<section>
					<div class="head">
						<h2>{i18n.home_recent_shows()}</h2>
						<span class="note"
							>{i18n.home_count_month({ count: recentCount(recentShows, now) })}</span
						>
					</div>
					<div class="scroller">
						{#each recentShows as t (t.id)}
							<PosterCard
								size="phone"
								width={116}
								title={t.title}
								sub={showSub(t)}
								src={artwork("series", t.id, "poster")}
								{...titleCard("series", t, now)}
								badge={badge(t, "series")}
								onclick={() => open("series", t.id)}
							/>
						{/each}
					</div>
				</section>
			{/if}
			{#if genre && genreTitles.length}
				<section>
					<div class="head">
						<h2>{genre}</h2>
					</div>
					<div class="scroller">
						{#each genreTitles as { kind, t } (`${kind}:${t.id}`)}
							<PosterCard
								size="phone"
								width={116}
								title={t.title}
								sub={kind === "movies" ? movieSub(t) : showSub(t)}
								src={artwork(kind, t.id, "poster")}
								{...titleCard(kind, t, now)}
								badge={undefined}
								onclick={() => open(kind, t.id)}
							/>
						{/each}
					</div>
				</section>
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
	padding-top: env(safe-area-inset-top);
	box-sizing: border-box;
}

.hero {
	position: relative;
	height: 560px;
	overflow: hidden;
	touch-action: pan-y;
	color: var(--player-ink);
}

.frame {
	position: absolute;
	inset: 0;
	opacity: 0;
	transform-origin: 50% 35%;
	transition: opacity 1100ms var(--ease);
}

.frame.on {
	opacity: 1;
}

/* A paused animation keeps its frame: the backdrop stands still at the scale it had reached. */
.frame.zoom {
	animation: zoom var(--zoom-ms) linear forwards paused;
}

/* A layer of its own while it zooms, so the scrim and the text above it are not drawn again on every frame. */
.frame.zooming {
	will-change: transform;
	animation-play-state: running;
}

.reduced .frame {
	transition: none;
}

@keyframes zoom {
	to {
		transform: scale(1.08);
	}
}

.scrim {
	position: absolute;
	inset: 0;
	background: linear-gradient(
		0deg,
		var(--bg-deep) 0%,
		color-mix(in srgb, var(--bg-deep) 75%, transparent) 30%,
		color-mix(in srgb, var(--bg-deep) 10%, transparent) 62%,
		color-mix(in srgb, var(--bg-deep) 55%, transparent) 100%
	);
}

.pin {
	position: sticky;
	top: 0;
	z-index: 20;
	height: 0;
}

.top {
	position: absolute;
	left: 0;
	right: 0;
	top: 0;
	height: calc(env(safe-area-inset-top) + 52px);
	box-sizing: border-box;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: env(safe-area-inset-top) 20px 0;
	transition:
		background var(--dur-base),
		box-shadow var(--dur-base);
}

.top.scrolled {
	background: color-mix(in srgb, var(--bg-deep) 78%, transparent);
	backdrop-filter: blur(16px) saturate(150%);
	-webkit-backdrop-filter: blur(16px) saturate(150%);
	box-shadow: inset 0 -1px 0 var(--border);
}

.brand {
	display: flex;
	align-items: center;
	gap: 9px;
	font-size: 17px;
	font-weight: 600;
	letter-spacing: -0.02em;
}

.actions {
	display: flex;
	align-items: center;
	gap: 2px;
	margin-right: -6px;
}

.bell :global(.sl-btn) {
	width: 44px;
	height: 44px;
}

.account {
	display: grid;
	place-items: center;
	width: 44px;
	height: 44px;
	padding: 0;
	border: 0;
	background: transparent;
	cursor: pointer;
}

.body {
	position: absolute;
	left: 20px;
	right: 20px;
	bottom: 61px;
	display: flex;
	flex-direction: column;
	gap: 11px;
}

.eyebrow {
	display: flex;
	align-items: center;
	gap: 8px;
	font: 500 10.5px / 1 var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--player-accent-text);
	white-space: nowrap;
}

.eyebrow::before {
	content: "";
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--player-accent);
}

h1 {
	margin: 0;
	font-size: 34px;
	line-height: 1.04;
	font-weight: 700;
	letter-spacing: -0.03em;
	text-wrap: balance;
	display: -webkit-box;
	-webkit-line-clamp: 3;
	line-clamp: 3;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.meta {
	font: 400 12px var(--font-mono);
	color: var(--fg-muted);
}

.buttons {
	display: flex;
	gap: 10px;
	margin-top: 6px;
}

.cta {
	flex: 1;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 10px;
	height: 48px;
	padding: 0 18px;
	border: 0;
	border-radius: var(--radius-md);
	background: var(--player-accent);
	color: var(--fg-on-accent);
	font-size: 16px;
	font-weight: 600;
	cursor: pointer;
	transition: transform 150ms;
}

.cta:active {
	transform: scale(0.97);
}

.glass {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: none;
	width: 48px;
	height: 48px;
	padding: 0;
	border: 1px solid rgba(255, 255, 255, 0.16);
	border-radius: var(--radius-md);
	background: var(--player-chip);
	backdrop-filter: blur(12px);
	-webkit-backdrop-filter: blur(12px);
	color: var(--player-ink);
	cursor: pointer;
}

.glass :global(.sl-ico) {
	stroke-width: 1.75;
}

.resume {
	display: flex;
	align-items: center;
	gap: 10px;
}

.resume > i {
	flex: 1;
	height: 3px;
	border-radius: 2px;
	background: var(--player-track);
	overflow: hidden;
}

.resume > i > b {
	display: block;
	height: 100%;
	background: var(--player-ink);
}

.resume > span {
	font: 400 11.5px var(--font-mono);
	color: var(--fg-muted);
}

.dots {
	position: absolute;
	left: 20px;
	right: 20px;
	bottom: 26px;
	height: 20px;
	display: flex;
	justify-content: center;
	gap: 4px;
}

.dot {
	height: 20px;
	padding: 0;
	border: 0;
	background: transparent;
	display: flex;
	align-items: center;
	cursor: pointer;
	transition: width 400ms var(--ease);
}

.track {
	position: relative;
	display: block;
	width: 100%;
	height: 4px;
	border-radius: 2px;
	background: color-mix(in srgb, var(--fg) 30%, transparent);
	overflow: hidden;
}

.fill {
	position: absolute;
	inset: 0;
	/* A width here lays the page out on every frame; a transform stays on the compositor. */
	transform: scaleX(0);
	transform-origin: left;
	background: var(--player-ink);
}

.fill.run {
	animation: fill var(--hero-ms) linear forwards paused;
}

.fill.run.ticking {
	animation-play-state: running;
}

@keyframes fill {
	to {
		transform: scaleX(1);
	}
}

.rows {
	display: flex;
	flex-direction: column;
	gap: 26px;
	padding-top: 6px;
}

.rows.bare {
	padding-top: calc(env(safe-area-inset-top) + 60px);
}

.rows section {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	padding: 0 20px;
}

h2 {
	margin: 0;
	font-size: 17px;
	font-weight: 600;
}

.note {
	font: 400 11px var(--font-mono);
	color: var(--fg-subtle);
}

.scroller {
	display: flex;
	gap: 12px;
	overflow-x: auto;
	padding: 0 20px;
	scrollbar-width: none;
}
</style>
