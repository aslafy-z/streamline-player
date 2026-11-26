<script lang="ts">
import { localKey, localLaunch } from "#lib/core/download-launch.ts";
import { dl } from "#lib/core/downloads.svelte.ts";
import { episodesOf } from "#lib/core/format.ts";
import { lib } from "#lib/core/library.svelte.ts";
import { net } from "#lib/core/online.svelte.ts";
import { localPort } from "#lib/core/playback/local-port.ts";
import {
	type Launch,
	nowPlaying,
	play,
	stop,
	toFull,
	toMini,
} from "#lib/core/playback/now-playing.svelte.ts";
import type { PlaybackPort } from "#lib/core/playback/port.ts";
import { loadLaunch } from "#lib/core/player-view.ts";
import { prefs } from "#lib/core/prefs.svelte.ts";
import type { DownloadEntry, Kind } from "#lib/core/types.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import LoadFailed from "#lib/screens/LoadFailed.svelte";
import { downloadsPort } from "#lib/screens/downloads-port.ts";
import PlayerControls from "#lib/screens/phone/PlayerControls.svelte";
import BufferingSpinner from "#lib/ui/BufferingSpinner.svelte";
import { goto } from "#lib/ui/nav.ts";
import {
	artwork,
	artworkAt,
	canDownload,
	everything,
	localPlayback,
	noteOffline,
	playbackPort,
	title as fetchTitle,
	watchState,
} from "#platform";
import { afterNavigate, beforeNavigate } from "$app/navigation";
import { untrack } from "svelte";

let {
	kind,
	id,
	epId,
	resume,
	local = null,
}: {
	kind: Kind;
	id: number;
	epId: number | null;
	resume: boolean;
	local?: { season: number | null; episode: number | null } | null;
} = $props();

let launch = $state.raw<Launch | null>(null);
let failed = $state<string | null>(null);
let attempt = $state(0);
let controls = $state<PlayerControls>();
let fromApp = false;
let leaving = false;

afterNavigate(({ from }) => {
	if (from?.route.id && !from.route.id.startsWith("/player")) fromApp = true;
});

beforeNavigate(({ to }) => {
	if (!to?.route.id?.startsWith("/player") && !nowPlaying.mini) stop();
});

const pb = $derived(launch && nowPlaying.launch?.key === launch.key ? nowPlaying.pb : null);
const detail = $derived(`/detail/${kind}/${id}`);

async function openLocal(entry: DownloadEntry, resuming: boolean, serverStart?: number) {
	const found = await localPlayback(entry.key);
	if (!found) throw new Error("no local file");
	const watched =
		serverStart ??
		(await watchState().catch(() => lib.watch)).find((w) => w.media_id === entry.media_id)
			?.position_seconds ??
		0;
	const position = !resuming ? 0 : entry.offline !== null ? found.position : watched;
	const file = {
		key: entry.key,
		url: found.url,
		tracks: found.tracks,
		position,
		duration: entry.meta.runtime * 60,
		size: entry.bytes,
	};
	return {
		launch: localLaunch(entry, artworkAt, position),
		port: localPort(playbackPort, file, noteOffline),
	};
}

async function downloaded(key: string | null) {
	if (!canDownload || !key) return null;
	const items = dl.items.length > 0 ? dl.items : await downloadsPort.downloads().catch(() => []);
	return items.find((e) => e.key === key && e.state === "done") ?? null;
}

function libraryKey(k: Kind, i: number, e: number | null) {
	if (k === "movies") return localKey(k, i, null, null);
	const found = lib.shows.find((t) => t.id === i);
	const ep = found && episodesOf(found).find((x) => x.id === e);
	return ep ? localKey(k, i, ep.season, ep.number) : null;
}

async function open(
	k: Kind,
	i: number,
	e: number | null,
	r: boolean,
	file: { season: number | null; episode: number | null } | null,
) {
	if (file) {
		const entry = await downloaded(localKey(k, i, file.season, file.episode));
		if (!entry) throw new Error("not downloaded");
		return openLocal(entry, true);
	}
	try {
		const l = await loadLaunch({ title: fetchTitle, watchState, artwork, everything }, k, i, e, r);
		if (!net.online) {
			const entry = await downloaded(
				dl.items.find((x) => x.media_id === l.item.mediaId)?.key ?? null,
			);
			if (entry) return await openLocal(entry, r, l.item.start);
		}
		return { launch: l, port: playbackPort as PlaybackPort };
	} catch (error) {
		const entry = net.online ? null : await downloaded(libraryKey(k, i, e));
		if (!entry) throw error;
		return openLocal(entry, r);
	}
}

$effect(() => {
	const [k, i, e, r, file] = [kind, id, epId, resume, local, attempt];
	let stale = false;
	failed = null;
	leaving = false;
	untrack(() => open(k, i, e, r, file)).then(
		({ launch: l, port }) => {
			if (stale) return;
			launch = l;
			start(l, port);
		},
		(error) => {
			if (!stale) failed = String(error);
		},
	);
	return () => {
		stale = true;
	};
});

function start(l: Launch, port: PlaybackPort) {
	const onEnd = () => (prefs.autoplay ? goNext() : nowPlaying.pb?.skip());
	play(
		port,
		{ ...l, item: { ...l.item, onEnd: l.view.next ? onEnd : undefined } },
		{
			started: () => controls?.show(),
			subtitlesUnavailable: () => controls?.flash(i18n.player_subtitles_unavailable()),
		},
	);
	toFull();
	playbackPort.command("viewport", { full: true }).catch(() => {});
}

function back() {
	if (local) goto("/downloads", { replace: true });
	else if (fromApp) history.back();
	else goto(launch?.view.season ? `${detail}?s=${launch.view.season}` : detail, { replace: true });
}

function exit() {
	stop();
	back();
}

function toPip() {
	if (!pb || pb.ended || pb.halt) return;
	toMini();
	back();
}

function goNext() {
	const next = launch?.view.next;
	if (!next || leaving) return;
	leaving = true;
	(pb?.leave() ?? Promise.resolve()).then(() => goto(next.href, { replace: true }));
}

function openMore(href: string) {
	stop();
	goto(href, { replace: true });
}
</script>

{#if failed}
	<LoadFailed error={failed} title={i18n.halt_error_title()} retry={() => (attempt += 1)} />
{:else if pb && launch}
	<PlayerControls
		bind:this={controls}
		{pb}
		{launch}
		onexit={exit}
		onpip={toPip}
		onnext={goNext}
		onopen={openMore}
	/>
{:else}
	<div
		class="loading"
		style:background-image="url({JSON.stringify(
			artwork(kind, id, "backdrop"),
		)}), url({JSON.stringify(artwork(kind, id, "poster"))})"
	>
		<BufferingSpinner label={i18n.player_buffering()} />
	</div>
{/if}

<style>
.loading {
	position: fixed;
	inset: 0;
	background: #000 center / cover no-repeat;
	color: var(--player-ink);
}

.loading::before {
	content: "";
	position: absolute;
	inset: 0;
	background: rgba(0, 0, 0, 0.55);
}
</style>
