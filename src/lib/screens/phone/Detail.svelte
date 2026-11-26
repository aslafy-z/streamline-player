<script lang="ts" module>
let hops = 0;
</script>

<script lang="ts">
import { playUrl, watchedTitle } from "#lib/core/browse.ts";
import {
	defaultSeason,
	episodeState,
	moreLikeThis,
	newEpisodes,
	primaryAction,
	techRows,
	type TechMode,
} from "#lib/core/detail.ts";
import { clickGroup, clickOne } from "#lib/core/download-ask.svelte.ts";
import {
	episodeItem,
	episodeKey,
	episodeLabel,
	movieItem,
	movieKey,
} from "#lib/core/download-items.ts";
import { bulkState, buttonState } from "#lib/core/downloads-view.ts";
import { entry } from "#lib/core/downloads.svelte.ts";
import {
	addedText,
	episodesOf,
	left,
	meta,
	monogram,
	runtime,
	sizeText,
	stillPos,
} from "#lib/core/format.ts";
import { applyWatch, lib, loadLibrary } from "#lib/core/library.svelte.ts";
import { autoCap, PRESETS, presetOf, rememberedThroughput } from "#lib/core/playback/auto.ts";
import { audioOutName, codecName, fileMbit, modeName, subInfo } from "#lib/core/playback/names.ts";
import type { Tracks } from "#lib/core/playback/port.ts";
import { prefs } from "#lib/core/prefs.svelte.ts";
import { toast } from "#lib/core/toast.svelte.ts";
import { canScan as isAdmin, scanTitle } from "#lib/screens/scan.ts";
import type { Decision, Kind, Title } from "#lib/core/types.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { askPort } from "#lib/screens/downloads-port.ts";
import Art from "#lib/ui/Art.svelte";
import Button from "#lib/ui/Button.svelte";
import { downloadWords } from "#lib/ui/download-words.ts";
import EmptyState from "#lib/ui/EmptyState.svelte";
import Icon from "#lib/ui/Icon.svelte";
import { goto } from "#lib/ui/nav.ts";
import NotFound from "#lib/ui/NotFound.svelte";
import WatchGlyph from "#lib/ui/WatchGlyph.svelte";
import WatchMarks from "#lib/ui/WatchMarks.svelte";
import { watchInfo } from "#lib/core/watch-info.ts";
import {
	artwork,
	canDownload,
	decisions,
	deviceInfo,
	headshot,
	home,
	library,
	network as whereAmI,
	playbackPort,
	setWatched,
	title as fetchTitle,
	watchState,
} from "#platform";
import { afterNavigate } from "$app/navigation";
import { page } from "$app/state";
import { onMount, untrack } from "svelte";

const MAX_SIMILAR = 8;
const MAX_CAST = 14;
const port = { library, watchState, home, title: fetchTitle };

let { kind, id }: { kind: Kind; id: number } = $props();

const now = new Date();
let t = $state.raw<Title | null>(null);
let missing = $state(false);
let failed = $state<string | null>(null);
let fromApp = false;
let loadId = 0;
let locked = $state<number | null>(null);
let techOpen = $state<boolean | null>(null);
let playback = $state.raw<Decision | null>(null);
let bitRate = $state(0);
let device = $state("");
let tracks = $state.raw<Tracks | null>(null);
let brokenPhoto = $state<Record<string, boolean>>({});

afterNavigate((nav) => {
	const { from, to } = nav;
	if (from && from.url.pathname === to?.url.pathname) return;
	fromApp = from !== null;
	const fromTitle = !!from?.url.pathname.includes("/detail/");
	if (!from) hops = 0;
	else if (nav.type === "popstate") {
		if (fromTitle) hops += nav.delta;
	} else hops = fromTitle ? hops + 1 : 1;
});

const ready = $derived(lib.loaded || lib.error !== null);
const series = $derived(kind === "series");
const primary = $derived(t ? primaryAction(t, kind, lib.watch) : null);
const asked = $derived(Number(page.url.searchParams.get("s")) || null);
const season = $derived(
	asked && t?.seasons?.some((s) => s.number === asked) ? asked : (locked ?? 1),
);

async function load(k: Kind, i: number) {
	const call = ++loadId;
	t = null;
	missing = false;
	failed = null;
	locked = null;
	techOpen = null;
	tracks = null;
	playback = null;
	try {
		const found = await fetchTitle(k, i);
		if (call === loadId) t = found;
	} catch (e) {
		if (call !== loadId) return;
		if (String(e).includes('"not_found"')) missing = true;
		else failed = String(e);
	}
}

$effect(() => {
	const [k, i] = [kind, id];
	untrack(() => load(k, i));
});

onMount(() => {
	loadLibrary(port, lib.loaded);
	deviceInfo().then(
		(d) => (device = d.name),
		() => {},
	);
});

$effect(() => {
	if (t && ready && locked === null) {
		const found = t;
		untrack(() => (locked = defaultSeason(found, lib.watch, null)));
	}
});

let passthrough = $state<string[]>([]);
playbackPort
	.capabilities()
	.then((c) => {
		passthrough = (c as { audio?: { passthrough?: string[] } } | null)?.audio?.passthrough ?? [];
	})
	.catch(() => {});

$effect(() => {
	const media = primary?.mediaId;
	tracks = null;
	if (!media) return;
	let stale = false;
	playbackPort.mediaTracks(media).then(
		(r) => {
			if (!stale) tracks = r;
		},
		() => {},
	);
	return () => (stale = true);
});

const PLAIN = $derived({
	direct: i18n.detail_plays_as_is(),
	remux: i18n.detail_plays_original(),
	audio_transcode: i18n.detail_audio_converted(),
	transcode: i18n.detail_converted(),
});

$effect(() => {
	const media = primary?.mediaId;
	playback = null;
	if (!media) return;
	let stale = false;
	Promise.all([
		decisions(media, [{}, ...PRESETS.map((n) => ({ max_bitrate: n * 1_000_000 }))]),
		whereAmI(),
	]).then(
		([r, net]) => {
			if (stale) return;
			const original = r.decisions[0];
			const q = presetOf(net === "home" ? prefs.qHome : prefs.qAway);
			const cap =
				q === "original"
					? null
					: q === "auto"
						? autoCap(
								rememberedThroughput(net),
								r.bit_rate / 1_000_000,
								!!original && !original.error && original.video.action === "copy",
							)
						: q;
			bitRate = r.bit_rate;
			playback = r.decisions[cap ? PRESETS.indexOf(cap) + 1 : 0] ?? null;
		},
		() => {
			if (!stale) playback = null;
		},
	);
	return () => (stale = true);
});

const decided = $derived(playback && !playback.error ? playback : null);
const full = $derived(decided && (decided.mode === "direct" || decided.mode === "remux"));

const watched = $derived(t ? watchedTitle(t, kind, lib.watch) : false);
const eps = $derived(t ? episodesOf(t) : []);
const available = $derived(eps.filter((e) => e.has_file));
const resuming = $derived(primary?.label === "resume");
const primaryText = $derived.by(() => {
	if (!primary) return i18n.common_play();
	if (series)
		return (resuming ? i18n.detail_resume_episode : i18n.detail_play_episode)({
			season: primary.season ?? 1,
			episode: primary.episode ?? 1,
		});
	const w = lib.watch.find((x) => x.media_id === primary.mediaId);
	return resuming && w
		? i18n.detail_resume_left({ left: left(w.duration_seconds - w.position_seconds) })
		: i18n.common_play();
});

const eyebrow = $derived(
	t ? (series ? [t.network, ...t.genres] : t.genres).filter(Boolean).join(" · ") : "",
);

function back() {
	if (fromApp && hops > 0) history.go(-hops);
	else goto("/");
}

function play() {
	if (!primary) return;
	goto(playUrl(kind, id, primary.episodeId, resuming));
}

type Target = {
	media: string;
	ref: { movie_id?: number; series_id?: number; season?: number; episode_id?: number };
};
const movieTargets = (): Target[] =>
	t?.media_files?.[0] ? [{ media: t.media_files[0].id, ref: { movie_id: id } }] : [];
const episodeTarget = (e: (typeof eps)[number]): Target => ({
	media: e.media_file_id,
	ref: { series_id: id, season: e.season, episode_id: e.id },
});

async function mark(targets: Target[], to: boolean, message: string) {
	try {
		await Promise.all(targets.map((x) => setWatched(x.media, to)));
		for (const x of targets) applyWatch(x.media, to, x.ref);
		toast(message);
	} catch {}
}

async function resetProgress() {
	if (!primary || !t) return;
	const done = series
		? i18n.detail_reset_episode_text({
				season: primary.season ?? 1,
				episode: primary.episode ?? 1,
			})
		: i18n.card_reset_text({ title: t.title });
	try {
		await setWatched(primary.mediaId, false);
		applyWatch(primary.mediaId, false);
		toast(i18n.card_reset_done(), { text: done });
	} catch {}
}

const toggleWatched = () =>
	mark(
		series ? available.map(episodeTarget) : movieTargets(),
		!watched,
		series
			? watched
				? i18n.detail_marked_series_unwatched()
				: i18n.detail_marked_series_watched()
			: watched
				? i18n.detail_marked_unwatched()
				: i18n.detail_marked_watched(),
	);

const seasonEps = $derived(t?.seasons?.find((s) => s.number === season)?.episodes ?? []);
const arrived = $derived(newEpisodes(lib.feed, id, now));
const two = (n: number) => String(n).padStart(2, "0");

const dlWords = $derived(downloadWords());

function dlFor(e: (typeof seasonEps)[number]) {
	const title = t;
	if (!canDownload || !title || !e.has_file) return undefined;
	const ep = { ...e, season };
	const key = episodeKey(title, ep);
	const label = episodeLabel(title, season, e.number);
	const look = buttonState(entry(key), label, dlWords);
	return {
		look,
		onclick: (ev: MouseEvent) =>
			clickOne(askPort, ev, key, label, () => episodeItem(title, ep, lib.watch), title.genres),
	};
}

const episodes = $derived(
	seasonEps.map((e) => {
		const state = episodeState(e, lib.watch);
		const w = lib.watch.find((x) => x.media_id === e.media_file_id);
		return {
			id: e.id,
			state,
			num: i18n.detail_episode_number({ n: two(e.number) }),
			title: e.title,
			runtime: state === "wanted" ? i18n.detail_wanted() : runtime(e.runtime),
			pos: stillPos(e.number, season),
			isNew: e.has_file && arrived.has(`${season}:${e.number}`),
			pct:
				state === "progress" && w && w.duration_seconds > 0
					? Math.round((w.position_seconds / w.duration_seconds) * 100)
					: 0,
			playLabel: i18n.library_play_episode({ title: t?.title ?? "", season, episode: e.number }),
			dl: dlFor(e),
		};
	}),
);

function playEpisode(episode: number) {
	const e = seasonEps.find((x) => x.id === episode);
	if (e?.has_file) goto(playUrl("series", id, e.id, episodeState(e, lib.watch) === "progress"));
}

const movieDl = $derived(
	canDownload && t && !series && t.media_files?.[0]
		? { key: movieKey(t), look: buttonState(entry(movieKey(t)), t.title, dlWords) }
		: null,
);
const seriesDl = $derived.by(() => {
	if (!canDownload || !series || !t || !available.length) return null;
	const keys = available.map((e) => episodeKey(t as Title, e));
	return { keys, state: bulkState(keys, entry, t.title, "series", dlWords) };
});

function clickSeriesDl(ev: MouseEvent) {
	const title = t;
	const b = seriesDl;
	if (!title || !b) return;
	clickGroup(
		askPort,
		ev,
		b.state.act,
		b.keys,
		title.title,
		() =>
			available
				.filter((e) => b.state.missing.includes(episodeKey(title, e)))
				.map((e) => episodeItem(title, e, lib.watch)),
		title.genres,
	);
}

const dlColor = (tone: "muted" | "accent" | "progress") =>
	tone === "accent"
		? "var(--accent)"
		: tone === "progress"
			? "var(--accent-text)"
			: "var(--fg-muted)";

const castShown = $derived(
	(t?.cast ?? []).filter((c) => !series || !c.seasons || c.seasons.includes(season)),
);
const members = $derived(
	castShown.slice(0, MAX_CAST).map((c) => ({ ...c, ...monogram(c.name), photo: headshot(c.id) })),
);

const similar = $derived(
	t
		? moreLikeThis(
				t,
				kind,
				[
					...lib.movies.map((x) => ({ ...x, kind: "movies" as Kind })),
					...lib.shows.map((x) => ({ ...x, kind: "series" as Kind })),
				],
				MAX_SIMILAR,
			)
		: [],
);

const modeShort = (m: TechMode) =>
	m.kind === "pass"
		? i18n.player_pass_through()
		: m.kind === "asis"
			? i18n.detail_phone_mode_as_is()
			: m.kind === "converted"
				? i18n.detail_phone_mode_converted()
				: m.kind === "burn"
					? i18n.detail_phone_mode_burn()
					: i18n.detail_phone_mode_shown();
const modeTone = (m: TechMode) =>
	m.kind === "converted"
		? "var(--status-downloading)"
		: m.kind === "burn"
			? "var(--status-warning)"
			: "var(--status-available)";

const facts = $derived.by(() => {
	if (!t) return [];
	const d = decided;
	const label = {
		video: i18n.player_stat_video(),
		audio: i18n.player_audio(),
		subs: i18n.detail_row_subs(),
		file: i18n.detail_row_file(),
		bitrate: i18n.player_stat_bitrate(),
		added: i18n.detail_row_added(),
	};
	return techRows(t, kind, tracks, {
		video: d ? { copy: d.video.action === "copy", out: codecName(d.video.codec) } : undefined,
		audio: d
			? {
					copy: d.audio.action === "copy",
					out: audioOutName({ audio: d.audio }),
					pass: passthrough.includes(d.audio.codec),
				}
			: undefined,
		subs: (tracks?.subtitles ?? []).map((s) => {
			const info = subInfo(s);
			return { format: info.fmt, burn: !!info.burnOnly };
		}),
		bitrate: bitRate ? i18n.detail_bitrate_avg({ rate: fileMbit(bitRate) }) : undefined,
		size: sizeText(t.file_summary?.size),
		added: addedText(t.added_at, now),
	}).map((r) => ({
		key: r.key,
		label: label[r.key],
		value:
			r.key === "subs"
				? i18n.detail_tracks_formats({ count: r.count ?? 0, formats: r.value })
				: r.value,
		mode: r.mode && modeShort(r.mode),
		color: r.mode ? modeTone(r.mode) : undefined,
	}));
});

const canScan = $derived(isAdmin());
const tiles = $derived(
	(!series && resuming ? 1 : 0) + (resuming ? 1 : 0) + 1 + (movieDl ? 1 : 0) + (canScan ? 1 : 0),
);
const showTech = $derived(techOpen ?? prefs.techDetails);

function setSeason(n: number) {
	goto(`/detail/${kind}/${id}?s=${n}`, { replace: true, reset: false });
}
</script>

<div class="detail">
	{#if missing}
		<NotFound
			title={i18n.detail_not_found()}
			label={i18n.detail_back_home()}
			onback={() => goto("/")}
		/>
	{:else if failed !== null}
		<div class="state">
			<EmptyState icon="film" title={i18n.home_error_title()} text={failed}>
				{#snippet action()}
					<Button variant="secondary" onclick={() => load(kind, id)}
						>{i18n.halt_try_again()}</Button
					>
				{/snippet}
			</EmptyState>
		</div>
	{:else if t && ready}
		<div class="hero">
			<Art
				src={artwork(kind, t.id, "backdrop")}
				fallback={artwork(kind, t.id, "poster")}
				position="50% 30%"
			/>
			<div class="scrim"></div>
		</div>
		<button type="button" class="back" aria-label={i18n.common_back()} onclick={back}>
			<Icon name="chevron-left" size={20} stroke={2} />
		</button>
		<div class="body">
			<div class="eyebrow">{eyebrow}</div>
			<h1>{t.title}</h1>
			<div class="meta">{meta(kind, t)}</div>
			<button type="button" class="cta" disabled={!primary} onclick={play}>
				<Icon name="play" filled size={18} />{primaryText}
			</button>
			<div class="acts" style:--n={tiles}>
				{#if !series && resuming}
					<button type="button" class="tile" onclick={() => goto(playUrl("movies", id))}>
						<Icon name="skip-back" size={19} stroke={1.75} />{i18n.detail_phone_from_start()}
					</button>
				{/if}
				{#if resuming}
					<button type="button" class="tile" onclick={resetProgress}>
						<Icon name="rotate-ccw" size={19} stroke={1.75} />{i18n.detail_phone_reset()}
					</button>
				{/if}
				<button
					type="button"
					class="tile"
					style:color={watched ? "var(--status-available)" : "var(--fg)"}
					onclick={toggleWatched}
				>
					<WatchGlyph on={watched} size={19} stroke={2} />
					{watched ? i18n.detail_watched() : i18n.detail_mark_watched()}
				</button>
				{#if movieDl && t}
					{@const title = t}
					<button
						type="button"
						class="tile"
						aria-label={movieDl.look.label}
						style:color={dlColor(movieDl.look.tone)}
						onclick={(ev) =>
							clickOne(
								askPort,
								ev,
								movieDl.key,
								title.title,
								() => movieItem(title, lib.watch),
								title.genres,
							)}
					>
						{@render dlGlyph(movieDl.look, 19, 13)}{movieDl.look.short}
					</button>
				{/if}
				{#if canScan}
					<button
						type="button"
						class="tile"
						onclick={() =>
							scanTitle(kind, id, i18n.detail_toast_scanning_title({ title: t?.title ?? "" }), eps)}
					>
						<Icon name="refresh-cw" size={19} stroke={1.75} />{i18n.detail_scan_short()}
					</button>
				{/if}
				{#if seriesDl}
					<button
						type="button"
						class="glass"
						aria-label={seriesDl.state.label}
						style:color={dlColor(seriesDl.state.tone)}
						onclick={clickSeriesDl}
					>
						{@render dlGlyph(seriesDl.state, 19, 16, 22)}
					</button>
				{/if}
			</div>
			<p class="overview">{t.overview}</p>
			{#if decided || facts.length}
				<div class="card">
					<button
						type="button"
						class="card-head"
						class:open={showTech}
						aria-expanded={showTech}
						onclick={() => (techOpen = !showTech)}
					>
						<span class="dot" class:copy={full}></span>
						<span class="what"
							>{decided
								? prefs.techDetails
									? modeName(decided.mode)
									: PLAIN[decided.mode]
								: ""}</span
						>
						<span class="where">{device ? i18n.detail_on_device({ device }) : ""}</span>
						<span class="chev" class:open={showTech}
							><Icon name="chevron-down" size={16} stroke={2} /></span
						>
					</button>
					{#if showTech}
						{#each facts as r (r.key)}
							<div class="fact">
								<span class="k">{r.label}</span>
								<span class="v">{r.value}</span>
								<span style:color={r.color}>{r.mode ?? ""}</span>
							</div>
						{/each}
					{/if}
				</div>
			{/if}
		</div>

		{#if series && t.seasons?.length}
			<section class="seasons">
				<div class="pills">
					{#each t.seasons as s (s.number)}
						<button
							type="button"
							class="pill"
							class:on={s.number === season}
							onclick={() => setSeason(s.number)}
						>
							{i18n.common_season_n({ n: s.number })}
						</button>
					{/each}
					{#if canScan}
						<button
							type="button"
							class="scan"
							aria-label={i18n.detail_scan_season({ season })}
							onclick={() =>
								scanTitle(kind, id, i18n.detail_toast_scanning_season({ season }), seasonEps)}
						>
							<Icon name="refresh-cw" size={17} stroke={1.8} />
						</button>
					{/if}
				</div>
				{#each episodes as e (e.id)}
					<div class="ep">
						<button
							type="button"
							class="ep-play"
							class:wanted={e.state === "wanted"}
							disabled={e.state === "wanted"}
							aria-label={e.playLabel}
							onclick={() => playEpisode(e.id)}
						>
							<span class="still">
								<Art src={artwork("series", id, "backdrop")} position={e.pos} />
								{#if e.state === "unwatched"}
									<span class="slp-unread slp-mk--thumb" aria-hidden="true"></span>
								{/if}
								{#if e.isNew}
									<span class="new" class:after-unread={e.state === "unwatched"}
										>{i18n.home_new()}</span
									>
								{/if}
								{#if e.state === "progress"}
									<span class="bar"><span style:width="{e.pct}%"></span></span>
								{/if}
							</span>
							<span class="ep-text">
								<span class="ep-title">{e.num} · {e.title}</span>
								<span class="ep-rt">{e.runtime}</span>
							</span>
						</button>
						{#if e.dl}
							{@const dl = e.dl}
							<button
								type="button"
								class="ep-dl"
								aria-label={dl.look.label}
								style:color={dlColor(dl.look.tone)}
								onclick={dl.onclick}
							>
								{@render dlGlyph(dl.look, 20, 15, 21)}
							</button>
						{/if}
					</div>
				{/each}
			</section>
		{/if}

		{#if members.length}
			<section class="rail">
				<h2>{series ? i18n.detail_cast_season({ n: season }) : i18n.detail_cast()}</h2>
				<div class="cast">
					{#each members as c (c.id)}
						<button type="button" class="member" onclick={() => goto(`/person/${c.id}`)}>
							<span class="photo" style:background={c.bg} style:color={c.fg}>
								{#if brokenPhoto[c.id]}
									{c.initials}
								{:else}
									<img
										src={c.photo}
										alt=""
										loading="lazy"
										onerror={() => (brokenPhoto[c.id] = true)}
									>
								{/if}
							</span>
							<span class="who">
								<span class="name">{c.name}</span>
								<span class="role">{c.character}</span>
							</span>
						</button>
					{/each}
				</div>
			</section>
		{/if}

		{#if similar.length}
			<section class="rail more">
				<h2>{i18n.detail_more_like_this()}</h2>
				<div class="similar">
					{#each similar as it (`${it.kind}:${it.id}`)}
						<button
							type="button"
							class="poster slp-mk--phone"
							aria-label={it.title}
							onclick={() => goto(`/detail/${it.kind}/${it.id}`)}
						>
							<Art src={artwork(it.kind, it.id, "poster")} kind="poster" />
							<WatchMarks info={watchInfo(it, it.kind, lib.watch)} />
						</button>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>

{#snippet dlGlyph(
	look: { icon: "arrow-down-to-line" | "circle-arrow-down" | null; pct: number },
	icon: number,
	hole: number,
	ring: number = icon,
)}
	{#if look.icon}
		<Icon name={look.icon} size={icon} stroke={1.9} />
	{:else}
		<span class="ring" style:--p="{look.pct}%" style:--d="{ring}px" style:--h="{hole}px">
			<span class="hole"></span>
		</span>
	{/if}
{/snippet}

<style>
.detail {
	position: relative;
	min-height: 100%;
	background: var(--bg-deep);
	color: var(--fg);
}

.state {
	display: grid;
	place-items: center;
	min-height: 100vh;
}

.hero {
	position: relative;
	height: 330px;
	overflow: hidden;
}

.scrim {
	position: absolute;
	inset: 0;
	background: linear-gradient(
		0deg,
		var(--bg-deep) 0%,
		color-mix(in srgb, var(--bg-deep) 55%, transparent) 30%,
		transparent 60%,
		color-mix(in srgb, var(--bg-deep) 45%, transparent) 100%
	);
}

.back {
	position: absolute;
	left: 12px;
	top: calc(env(safe-area-inset-top) + 6px);
	z-index: 2;
	display: grid;
	place-items: center;
	width: 44px;
	height: 44px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: rgba(0, 0, 0, 0.45);
	backdrop-filter: blur(10px);
	-webkit-backdrop-filter: blur(10px);
	color: var(--fg);
	cursor: pointer;
}

.body {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 12px;
	margin-top: -74px;
	padding: 0 20px;
	text-align: left;
}

.eyebrow {
	font: 500 10.5px / 1 var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--accent-text);
}

h1 {
	margin: 0;
	font-size: 32px;
	line-height: 1.05;
	font-weight: 700;
	letter-spacing: -0.03em;
	text-wrap: balance;
}

.meta {
	font: 400 12px var(--font-mono);
	color: var(--fg-muted);
}

.cta {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 10px;
	height: 50px;
	margin-top: 4px;
	border: 0;
	border-radius: 12px;
	background: var(--accent);
	color: var(--fg-on-accent);
	font-size: 16px;
	font-weight: 600;
	cursor: pointer;
}

.cta:active {
	transform: scale(0.97);
}

.cta:disabled {
	opacity: 0.5;
}

.acts {
	display: grid;
	grid-template-columns: repeat(var(--n), minmax(0, 1fr));
	gap: 8px;
}

.tile {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 4px;
	height: 56px;
	padding: 0;
	border: 1px solid var(--border-strong);
	border-radius: 12px;
	background: var(--surface);
	color: var(--fg-muted);
	font-size: 11.5px;
	font-weight: 500;
	cursor: pointer;
	transition: color 260ms var(--ease);
}

.glass {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 46px;
	padding: 0;
	border: 1px solid rgba(255, 255, 255, 0.16);
	border-radius: var(--radius-md);
	background: var(--player-chip);
	backdrop-filter: blur(12px);
	-webkit-backdrop-filter: blur(12px);
	cursor: pointer;
}

.ring {
	display: grid;
	place-items: center;
	width: var(--d);
	height: var(--d);
	border-radius: 50%;
	background: conic-gradient(var(--accent) var(--p), rgba(255, 255, 255, 0.14) 0);
}

.hole {
	width: var(--h);
	height: var(--h);
	border-radius: 50%;
	background: var(--bg-deep);
}

.tile .hole {
	background: var(--bg-base);
}

.glass .hole {
	background: #1a1a24;
}

.overview {
	margin: 2px 0 0;
	font-size: 14.5px;
	line-height: 1.55;
	color: var(--fg-muted);
	text-wrap: pretty;
}

.card {
	display: flex;
	flex-direction: column;
	margin-top: 4px;
	border: 1px solid var(--border);
	border-radius: 12px;
	background: var(--bg-elevated);
}

.card-head {
	display: flex;
	align-items: center;
	gap: 9px;
	min-height: 46px;
	padding: 11px 14px;
	border: 0;
	background: transparent;
	color: var(--fg);
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.card-head.open {
	border-bottom: 1px solid var(--border);
}

.dot {
	flex: none;
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: var(--status-downloading);
	box-shadow: 0 0 0 3px color-mix(in srgb, var(--status-downloading) 20%, transparent);
}

.dot.copy {
	background: var(--status-available);
	box-shadow: 0 0 0 3px color-mix(in srgb, var(--status-available) 18%, transparent);
}

.what {
	font-size: 13px;
	font-weight: 600;
}

.where {
	margin-left: auto;
	font: 400 11px var(--font-mono);
	color: var(--fg-subtle);
}

.chev {
	display: flex;
	flex: none;
	color: var(--fg-subtle);
	transition: transform var(--dur-base);
}

.chev.open {
	transform: rotate(180deg);
}

.fact {
	display: flex;
	gap: 10px;
	padding: 8px 14px;
	font: 400 11.5px var(--font-mono);
}

.k {
	width: 48px;
	padding-top: 1px;
	font-size: 10px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--fg-faint);
}

.v {
	flex: 1;
	min-width: 0;
	color: var(--fg-muted);
	overflow-wrap: anywhere;
}

.seasons {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin-top: 22px;
}

.pills {
	display: flex;
	gap: 8px;
	padding: 0 20px 6px;
	overflow-x: auto;
	scrollbar-width: none;
}

.scan {
	flex: none;
	width: 36px;
	height: 36px;
	margin-left: auto;
	display: grid;
	place-items: center;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: transparent;
	color: var(--fg-subtle);
	cursor: pointer;
}

.pill {
	flex: none;
	height: 36px;
	padding: 0 15px;
	border: 1px solid var(--border-strong);
	border-radius: var(--radius-full);
	background: transparent;
	color: var(--fg-subtle);
	font-size: 13.5px;
	font-weight: 500;
	cursor: pointer;
}

.pill.on {
	border-color: var(--accent-line);
	background: var(--accent-soft);
	color: var(--fg);
	font-weight: 600;
}

.ep {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 8px 20px;
}

.ep-play {
	flex: 1;
	min-width: 0;
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--fg);
	text-align: left;
	cursor: pointer;
}

.ep-play.wanted {
	opacity: 0.55;
	cursor: default;
}

.still {
	position: relative;
	flex: none;
	width: 124px;
	aspect-ratio: 16 / 9;
	border-radius: 8px;
	overflow: hidden;
	background: var(--bg-card);
}

.new {
	position: absolute;
	left: 5px;
	top: 5px;
	padding: 1px 5px;
	border-radius: 4px;
	background: color-mix(in srgb, var(--bg-deep) 85%, transparent);
	font: 500 9px var(--font-mono);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--accent-text);
}

.new.after-unread {
	left: 15px;
}

.bar {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	height: 3px;
	background: rgba(255, 255, 255, 0.2);
}

.bar span {
	display: block;
	height: 100%;
	background: var(--accent);
}

.ep-text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 3px;
}

.ep-title {
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
	font-size: 14px;
	font-weight: 500;
	line-height: 1.3;
}

.ep-rt {
	font: 400 11px var(--font-mono);
	color: var(--fg-subtle);
}

.ep-dl {
	flex: none;
	display: grid;
	place-items: center;
	width: 44px;
	height: 44px;
	margin-right: -8px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: transparent;
	cursor: pointer;
}

.rail {
	display: flex;
	flex-direction: column;
	gap: 10px;
	margin-top: 26px;
}

.rail.more {
	gap: 12px;
}

h2 {
	margin: 0;
	padding: 0 20px;
	font-size: 17px;
	font-weight: 600;
}

.cast {
	display: flex;
	gap: 2px;
	padding: 0 14px;
	overflow-x: auto;
	scrollbar-width: none;
}

.member {
	flex: none;
	width: 94px;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
	padding: 4px 4px 6px;
	border: 0;
	background: transparent;
	color: var(--fg);
	text-align: center;
	cursor: pointer;
}

.photo {
	position: relative;
	display: grid;
	place-items: center;
	width: 72px;
	height: 72px;
	border-radius: 50%;
	overflow: hidden;
	font-size: 23px;
	font-weight: 600;
	box-shadow: 0 0 0 1px var(--border);
}

.photo img {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.who {
	display: flex;
	flex-direction: column;
	gap: 2px;
	width: 100%;
}

.name,
.role {
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
	line-height: 1.3;
}

.name {
	font-size: 12px;
	font-weight: 600;
}

.role {
	font-size: 11px;
	color: var(--fg-subtle);
}

.similar {
	display: flex;
	gap: 12px;
	padding: 0 20px;
	overflow-x: auto;
	scrollbar-width: none;
}

.poster {
	position: relative;
	flex: none;
	width: 112px;
	aspect-ratio: 2 / 3;
	padding: 0;
	border: 0;
	border-radius: 9px;
	overflow: hidden;
	background: var(--bg-card);
	box-shadow: 0 0 0 1px var(--border);
	cursor: pointer;
}
</style>
