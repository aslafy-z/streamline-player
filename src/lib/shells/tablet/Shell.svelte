<script lang="ts">
import { prefs } from "#lib/core/prefs.svelte.ts";
import { goto } from "#lib/ui/nav.ts";
import { afterNavigate, beforeNavigate } from "$app/navigation";
import { page } from "$app/state";
import {
	type AskSpec,
	ask,
	asking,
	closeAsk,
	confirmAsk,
	countdown,
	counting,
	finishCountdown,
} from "#lib/core/ask.svelte.ts";
import { loadActivity, resetActivity, unread } from "#lib/core/activity.svelte.ts";
import { bellLabel } from "#lib/core/activity-view.ts";
import { account, clearMe, setMe } from "#lib/core/me.svelte.ts";
import { picture as profilePicture, syncPicture } from "#lib/core/picture.svelte.ts";
import { loadPendingPairs, pendingPairs, resetAdmin } from "#lib/core/admin.svelte.ts";
import {
	asking as dlAsking,
	canShowSub,
	closePick,
	closePopover,
	confirmPick,
	dropFromPopover,
	type PickState,
	type PopoverState,
	retryFromPopover,
} from "#lib/core/download-ask.svelte.ts";
import { pickView, popoverView } from "#lib/core/downloads-view.ts";
import { anyActive, dl, entry, initDownloads, refreshStorage } from "#lib/core/downloads.svelte.ts";
import { loadLibrary } from "#lib/core/library.svelte.ts";
import { net, watchOnline } from "#lib/core/online.svelte.ts";
import { activeToast, toast } from "#lib/core/toast.svelte.ts";
import { nowPlaying, stop, toFull } from "#lib/core/playback/now-playing.svelte.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { keyboardUp } from "#lib/platform/keyboard.svelte.ts";
import { adminPort } from "#lib/screens/admin/port.ts";
import { downloadsPort } from "#lib/screens/downloads-port.ts";
import DownloadPicker from "#lib/ui/DownloadPicker.svelte";
import CardLangPopover from "#lib/screens/CardLangPopover.svelte";
import DownloadPopover from "#lib/ui/DownloadPopover.svelte";
import { downloadWords } from "#lib/ui/download-words.ts";
import AppBar from "#lib/ui/AppBar.svelte";
import AskDialog from "#lib/ui/AskDialog.svelte";
import CountdownToast from "#lib/ui/CountdownToast.svelte";
import DesktopToast from "#lib/ui/DesktopToast.svelte";
import Menu from "#lib/ui/Menu.svelte";
import MiniPlayer from "#lib/ui/MiniPlayer.svelte";
import { activityWords } from "#lib/ui/activity-words.ts";
import { presence } from "#lib/ui/presence.svelte.ts";
import { provideScroll } from "#lib/ui/scroll.ts";
import {
	activity,
	canDownload,
	home,
	library,
	markActivityRead,
	me,
	myPicture,
	playbackPort,
	reachable,
	signOut,
	syncOffline,
	setWifiOnly,
	takeLaunchRoute,
	title as fetchTitle,
	watchState,
} from "#platform";
import type { Snippet } from "svelte";
import { onMount, untrack } from "svelte";

const ACTIVITY_PORT = { activity, markActivityRead };
const AVATAR_COLOR = "var(--kind-album)";

let { web, children }: { web: boolean; children: Snippet } = $props();

let scrolledDown = $state(false);
let menuOpen = $state(false);
let content = $state<HTMLElement>();
let pip = $state<HTMLElement>();
let pipArt = $state<HTMLElement>();
let hole = $state<{ x: number; y: number; width: number; height: number } | null>(null);
provideScroll(() => content);

// SvelteKit restores the window's scroll, and the pages scroll in `content`: without this a page
// opens wherever the one before it was left.
// ponytail: positions keyed by URL, so two history entries of one page share theirs; key by history entry if that shows.
const scrolls = new Map<string, number>();
beforeNavigate(({ from }) => {
	if (from?.url && content) scrolls.set(from.url.href, content.scrollTop);
});
afterNavigate(({ from, to, type }) => {
	if (!content || !to?.url || from?.url?.pathname === to.url.pathname) return;
	content.scrollTop = type === "popstate" ? (scrolls.get(to.url.href) ?? 0) : 0;
});

const menu = presence(() => menuOpen, 140);
const question = presence(() => !!asking.spec, 230);
const counter = presence(() => !!counting.spec, 240);
// The dialog and the toast stay drawn while they fade out, after the store has dropped the spec.
let lastAsk = $state<AskSpec>();
let lastCount = $state<{ title: string; note: string; seconds: number }>();
$effect(() => {
	if (asking.spec) lastAsk = asking.spec;
});
$effect(() => {
	const c = counting.spec;
	if (c) lastCount = { title: c.title, note: c.note, seconds: c.seconds };
});

const picker = presence(() => !!dlAsking.pick, 230);
const popover = presence(() => !!dlAsking.popover, 190);
let lastPick = $state.raw<PickState>();
let lastPopover = $state.raw<PopoverState>();
let popoverBox = $state<HTMLElement>();
let popoverAt = $state<{ x: number; y: number; up: boolean } | null>(null);
$effect(() => {
	if (dlAsking.pick) lastPick = dlAsking.pick;
});
$effect(() => {
	if (dlAsking.popover) lastPopover = dlAsking.popover;
});

const POPOVER_W = 320;
const POPOVER_GAP = 8;
const POPOVER_EDGE = 12;
let placedFor: PopoverState | null = null;
$effect(() => {
	const pop = dlAsking.popover;
	const box = popoverBox;
	if (!pop || !box || placedFor === pop) return;
	placedFor = pop;
	const a = pop.anchor;
	const w = window.innerWidth;
	const minY = (showBar ? 64 : 0) + POPOVER_GAP;
	const maxY = window.innerHeight - POPOVER_GAP;
	const h = box.offsetHeight;
	if (!a) {
		popoverAt = { x: (w - POPOVER_W) / 2, y: Math.max(minY, (minY + maxY - h) / 2), up: false };
		return;
	}
	const x = Math.max(
		POPOVER_EDGE,
		Math.min(w - POPOVER_W - POPOVER_EDGE, a.left + a.width / 2 - POPOVER_W / 2),
	);
	if (a.bottom + POPOVER_GAP + h <= maxY) popoverAt = { x, y: a.bottom + POPOVER_GAP, up: false };
	else if (a.top - POPOVER_GAP - h >= minY) popoverAt = { x, y: a.top - POPOVER_GAP, up: true };
	else popoverAt = { x, y: Math.max(minY, Math.min(maxY - h, a.bottom + POPOVER_GAP)), up: false };
});
$effect(() => {
	const pop = dlAsking.popover;
	if (pop && dl.loaded && pop.keys.every((k) => !entry(k))) closePopover();
});

const dlWords = $derived(downloadWords());
const pickQualities: [string, string][] = $derived([
	["original", i18n.dl_quality_original()],
	["1080p", "1080p"],
	["720p", "720p"],
]);
const pv = $derived.by(() => {
	const p = lastPick;
	if (!p) return null;
	return pickView(
		{
			label: p.label,
			count: p.items.length,
			quality: p.quality,
			audio: p.audio,
			subs: p.subs,
			remember: p.remember,
		},
		p.tracks,
		p.fileBitRate,
		p.items.reduce((n, it) => n + it.minutes, 0),
		canShowSub,
		dlWords,
	);
});
const flip = (list: number[], index: number) =>
	list.includes(index) ? list.filter((x) => x !== index) : [...list, index];
const popView = $derived.by(() => {
	const p = lastPopover;
	if (!p) return null;
	return popoverView(p.keys, entry, dl.rate, p.label, dlWords);
});
const popEyebrow = $derived.by(() => {
	const v = popView;
	if (!v) return "";
	const base = {
		downloading: i18n.dl_downloading(),
		waiting: i18n.dl_popover_waiting(),
		failed: i18n.dl_popover_failed(),
		done: i18n.dl_on_device(),
	}[v.state];
	if (!v.count) return base;
	return `${base} · ${v.state === "done" ? dlWords.episodes(v.count.total) : i18n.dl_count_of(v.count)}`;
});

const route = $derived(page.route.id ?? "");
const kind = $derived(page.params.kind);
const onboarding = $derived(
	route === "/welcome" || route === "/pair" || route.startsWith("/signin"),
);
const inPlayer = $derived(route.startsWith("/player"));
const showBar = $derived(!onboarding && !inPlayer);
const launch = $derived(nowPlaying.launch);
// The keyboard takes the mini player's place: a page being typed into keeps the room for itself.
const typing = $derived(keyboardUp());
const showMini = $derived(
	!typing && !!nowPlaying.pb && nowPlaying.mini && !!launch && !inPlayer && !onboarding,
);
const pictureReady = $derived((nowPlaying.pb?.position ?? 0) > 0);
const holed = $derived(showMini && pictureReady);
const solidBar = $derived(scrolledDown || !(route === "/" || route.startsWith("/detail")));
const PAD_LEFT = 28;
const PAD_RIGHT = 24;
const HIT = 44;
const MENU_RIGHT = 20;
const toastTop = $derived((showBar ? 64 : 0) + 16);
const COUNTDOWN_SHIFT = 74;

const name = $derived(account.me?.name ?? "");
const initials = $derived(account.me?.initials ?? "");
const picture = $derived(profilePicture.url);
$effect(() => {
	void syncPicture(myPicture, account.me?.picture, account.version);
});
const isAdmin = $derived(account.me?.role === "Admin");
const bell = $derived(bellLabel(unread(), activityWords()));

const tabs = $derived([
	{ id: "home", label: i18n.nav_home(), on: route === "/" },
	{ id: "movies", label: i18n.nav_movies(), on: route === "/library/[kind]" && kind !== "series" },
	{ id: "shows", label: i18n.nav_shows(), on: route === "/library/[kind]" && kind === "series" },
]);
const PATHS: Record<string, string> = {
	home: "/",
	movies: "/library/movies",
	shows: "/library/series",
	search: "/search",
	settings: "/settings",
	server: "/admin",
	activity: "/activity",
	downloads: "/downloads",
};

const go = (id: string) => goto(PATHS[id] ?? "/");

function search() {
	const field = document.querySelector<HTMLInputElement>("[data-search-field]");
	if (!field) return go("search");
	field.focus();
	field.select();
}

async function leave() {
	menuOpen = false;
	await stop();
	await signOut();
	toast(web ? i18n.shell_signed_out() : i18n.shell_signed_out_key_removed());
	await (web ? goto("/signin", { replace: true }) : goto("/welcome", { replace: true }));
}

const items = $derived([
	{
		icon: "settings" as const,
		label: i18n.nav_settings(),
		onclick: () => {
			menuOpen = false;
			go("settings");
		},
	},
	...(isAdmin
		? [
				{
					icon: "server" as const,
					label: i18n.server_open(),
					badge: pendingPairs.n ? String(pendingPairs.n) : undefined,
					onclick: () => {
						menuOpen = false;
						go("server");
					},
				},
			]
		: []),
	{ icon: "log-out" as const, label: i18n.shell_sign_out(), separator: true, onclick: leave },
]);

$effect(() => {
	if (onboarding) {
		clearMe();
		resetActivity();
		resetAdmin();
	} else untrack(() => loadActivity(ACTIVITY_PORT));
});

$effect(() => {
	if (onboarding || !account.me) return;
	if (isAdmin) untrack(() => loadPendingPairs(adminPort));
	else pendingPairs.n = 0;
});

$effect(() => {
	if (onboarding || account.me) return;
	// A fetch still in flight at sign-out must not put the old account back for the next person.
	let stale = false;
	me()
		.then((v) => {
			if (!stale) setMe(v);
		})
		.catch(() => {});
	return () => {
		stale = true;
	};
});

$effect(() => {
	if (!showMini || !pip || !pipArt) {
		hole = null;
		return;
	}
	const wrap = pip;
	const art = pipArt;
	// The card's rise animation moves the art, so the position comes from the wrapper and only the size from the art.
	const measure = () => {
		const at = wrap.getBoundingClientRect();
		const size = art.getBoundingClientRect();
		hole = { x: at.left, y: at.top, width: size.width, height: size.height };
	};
	measure();
	const watch = new ResizeObserver(measure);
	watch.observe(wrap);
	watch.observe(art);
	window.addEventListener("resize", measure);
	return () => {
		watch.disconnect();
		window.removeEventListener("resize", measure);
	};
});

$effect(() => {
	if (!showMini || !hole) return;
	playbackPort.command("viewport", { ...hole }).catch(() => {});
});

$effect(() => {
	if (showMini && nowPlaying.pb?.ended) stop();
});

function expand() {
	const href = launch?.view.href;
	if (!href) return;
	toFull();
	goto(href);
}

const miniTitle = $derived(
	launch?.view.season ? launch.view.eyebrow : (launch?.view.heading ?? ""),
);
const miniProgress = $derived(
	nowPlaying.pb && nowPlaying.pb.duration > 0
		? Math.min(100, (nowPlaying.pb.position / nowPlaying.pb.duration) * 100)
		: 0,
);
const miniLabels = $derived({
	play: i18n.player_play(),
	pause: i18n.player_pause(),
	expand: i18n.player_mini_expand(),
	close: i18n.player_mini_close(),
});

const LIBRARY_PORT = { library, watchState, home, title: fetchTitle };

function wentOffline() {
	if (!dl.items.some((e) => e.state === "done")) return;
	toast(i18n.dl_offline_title(), {
		icon: "wifi-off",
		warning: true,
		text: i18n.dl_toast_offline_text(),
	});
}

async function cameBack() {
	const n = await syncOffline().catch(() => 0);
	toast(i18n.dl_toast_back_online(), {
		icon: "wifi",
		text: n === 0 ? "" : n === 1 ? i18n.dl_toast_synced_one() : i18n.dl_toast_synced({ n }),
	});
	loadLibrary(LIBRARY_PORT, true);
}

// Playing a download notes its position on this device; with the server there, it goes up as soon as the player closes.
let hadLaunch = false;
$effect(() => {
	const has = !!nowPlaying.launch;
	if (hadLaunch && !has && canDownload && untrack(() => net.online)) syncOffline().catch(() => {});
	hadLaunch = has;
});

$effect(() => {
	if (canDownload) setWifiOnly(prefs.wifiOnly).catch(() => {});
});

onMount(() => {
	const stops: (() => void)[] = [];
	if (canDownload) {
		let gone = false;
		initDownloads(downloadsPort, (e) => {
			const m = e.meta;
			toast(
				i18n.dl_toast_available({
					label: m.season != null ? `${m.title} S${m.season} E${m.episode}` : m.title,
				}),
			);
		}).then((stop) => (gone ? stop() : stops.push(stop)));
		stops.push(
			watchOnline({ reachable }, (up) => (up ? cameBack() : wentOffline())),
			() => (gone = true),
		);
	}
	const openLaunchRoute = () => {
		if (canDownload)
			takeLaunchRoute().then(
				(path) => {
					if (path) goto(path);
				},
				() => {},
			);
	};
	openLaunchRoute();
	const onVisible = () => {
		if (document.visibilityState !== "visible") return;
		openLaunchRoute();
		if (onboarding) return;
		loadActivity(ACTIVITY_PORT);
		if (isAdmin) loadPendingPairs(adminPort);
	};
	document.addEventListener("visibilitychange", onVisible);
	// A tap on the notification while the app is already in front fires no visibilitychange.
	window.addEventListener("focus", openLaunchRoute);
	return () => {
		document.removeEventListener("visibilitychange", onVisible);
		window.removeEventListener("focus", openLaunchRoute);
		for (const stop of stops) stop();
	};
});

const doneSignature = $derived(
	`${dl.items.length}:${dl.items.filter((e) => e.state === "done").length}`,
);
$effect(() => {
	if (!canDownload || route !== "/downloads") return;
	doneSignature;
	untrack(() => refreshStorage(downloadsPort));
});

const toastNow = $derived(activeToast());

if (import.meta.env.DEV)
	(window as unknown as { __slp: unknown }).__slp = { ask, countdown, toast };
</script>

<div class="shell" class:player={inPlayer} class:holed>
	<div
		class="layer"
		style:--hole-x="{hole?.x ?? 0}px"
		style:--hole-y="{hole?.y ?? 0}px"
		style:--hole-w="{hole?.width ?? 0}px"
		style:--hole-h="{hole?.height ?? 0}px"
	>
		<div
			class="content"
			bind:this={content}
			onscroll={(e) => (scrolledDown = e.currentTarget.scrollTop > 24)}
		>
			{@render children()}
		</div>

		{#if showBar}
			<AppBar
				{tabs}
				padLeft={PAD_LEFT}
				padRight={PAD_RIGHT}
				hit={HIT}
				scrolled={solidBar}
				searchLabel={i18n.nav_search()}
				activityLabel={bell}
				activityDot={unread() > 0}
				activityOn={route === "/activity"}
				downloadsLabel={i18n.shell_downloads()}
				showDownloads={canDownload}
				downloadsDot={anyActive()}
				downloadsOn={route === "/downloads"}
				account={{ name, email: account.me?.email ?? "", initials, color: AVATAR_COLOR, picture }}
				accountLabel={i18n.shell_account_menu()}
				{menuOpen}
				accountDot={pendingPairs.n > 0 && !menuOpen}
				accountOn={route === "/settings" || route === "/admin"}
				onhome={() => go("home")}
				ontab={go}
				onsearch={search}
				onactivity={() => go("activity")}
				ondownloads={() => go("downloads")}
				onmenu={() => (menuOpen = !menuOpen)}
			/>
		{/if}
	</div>

	{#if showMini && launch && nowPlaying.pb}
		<div class="pip" bind:this={pip}>
			<MiniPlayer
				title={miniTitle}
				still={launch.view.still}
				progress={miniProgress}
				playing={nowPlaying.pb.playing}
				live
				ready={pictureReady}
				labels={miniLabels}
				bind:art={pipArt}
				ontoggle={() => nowPlaying.pb?.togglePlay()}
				onexpand={expand}
				onclose={() => stop()}
			/>
		</div>
	{/if}

	{#if showBar && menu.mounted}
		<button
			type="button"
			class="scrim"
			tabindex="-1"
			aria-label={i18n.shell_close()}
			style:pointer-events={menuOpen ? "auto" : "none"}
			onclick={() => (menuOpen = false)}
		></button>
		<div
			class="menu"
			class:shown={menu.shown}
			class:closing={!menuOpen}
			style:right="{MENU_RIGHT}px"
			style:pointer-events={menuOpen ? "auto" : "none"}
		>
			<Menu
				{name}
				email={account.me?.email}
				{initials}
				color={AVATAR_COLOR}
				{picture}
				{items}
				label={i18n.shell_account_menu()}
			/>
		</div>
	{/if}

	{#if question.mounted && lastAsk}
		{#key lastAsk}
			<AskDialog
				spec={lastAsk}
				shown={question.shown}
				cancelLabel={i18n.settings_cancel()}
				closeLabel={i18n.shell_close()}
				optionalLabel={i18n.ask_optional()}
				onclose={closeAsk}
				onconfirm={confirmAsk}
			/>
		{/key}
	{/if}

	{#if picker.mounted && lastPick && pv}
		<DownloadPicker
			title={pv.title}
			note={pv.qNote}
			audio={pv.audio}
			subs={pv.subs}
			total={pv.total}
			canDownload={pv.canDownload}
			quality={lastPick.quality}
			qualities={pickQualities}
			remember={lastPick.remember}
			shown={picker.shown}
			words={{
				quality: i18n.dl_quality(),
				qualityGroup: i18n.dl_quality_label(),
				audio: i18n.player_audio(),
				subtitles: i18n.player_subtitles(),
				remember: i18n.dl_pick_remember(),
				cancel: i18n.settings_cancel(),
				download: i18n.dl_download_short(),
				close: i18n.shell_close(),
			}}
			onquality={(q) => {
				if (dlAsking.pick) dlAsking.pick.quality = q as typeof dlAsking.pick.quality;
			}}
			onaudio={(i) => {
				if (dlAsking.pick) dlAsking.pick.audio = flip(dlAsking.pick.audio, i);
			}}
			onsub={(i) => {
				if (dlAsking.pick) dlAsking.pick.subs = flip(dlAsking.pick.subs, i);
			}}
			onremember={() => {
				if (dlAsking.pick) dlAsking.pick.remember = !dlAsking.pick.remember;
			}}
			oncancel={closePick}
			onconfirm={confirmPick}
		/>
	{/if}

	<CardLangPopover barHeight={showBar ? 64 : 0} />

	{#if popover.mounted && lastPopover && popView}
		<button
			type="button"
			class="dl-scrim"
			tabindex="-1"
			aria-label={i18n.shell_close()}
			style:pointer-events={dlAsking.popover ? "auto" : "none"}
			onclick={closePopover}
		></button>
		<div
			class="dl-pop"
			class:shown={popover.shown && !!popoverAt}
			class:up={popoverAt?.up}
			bind:this={popoverBox}
			style:left="{popoverAt?.x ?? 0}px"
			style:top="{popoverAt?.y ?? 0}px"
			style:pointer-events={dlAsking.popover ? "auto" : "none"}
		>
			<DownloadPopover
				state={popView.state}
				title={popView.title}
				eyebrow={popEyebrow}
				progress={popView.progress}
				got={popView.got}
				rate={popView.rate}
				size={popView.size}
				quality={popView.quality}
				cause={popView.cause}
				kept={popView.kept}
				group={lastPopover.group}
				words={{
					open: i18n.dl_open_downloads(),
					size: i18n.dl_size(),
					quality: i18n.dl_quality(),
					removeDownload: i18n.dl_remove(),
					removeAll: i18n.dl_remove_all(),
					retry: i18n.dl_retry(),
					remove: i18n.dl_remove_one(),
					cancel: i18n.settings_cancel(),
					cancelRemaining: i18n.dl_cancel_remaining(),
				}}
				onopen={() => {
					closePopover();
					go("downloads");
				}}
				oncancel={() => dropFromPopover(downloadsPort)}
				onremove={() => dropFromPopover(downloadsPort)}
				onretry={() => retryFromPopover(downloadsPort)}
			/>
		</div>
	{/if}

	{#if counter.mounted && lastCount}
		<div class="countdown" class:shown={counter.shown} style:top="{toastTop}px">
			<CountdownToast
				title={lastCount.title}
				line={lastCount.note
					? i18n.countdown_in_note({ left: counting.left, note: lastCount.note })
					: i18n.countdown_in({ left: counting.left })}
				total={lastCount.seconds}
				nowLabel={i18n.countdown_now()}
				abortLabel={i18n.countdown_abort()}
				onnow={() => finishCountdown(true)}
				onabort={() => finishCountdown(false)}
			/>
		</div>
	{/if}

	{#if toastNow}
		<div class="toasts" style:top="{toastTop + (counting.spec ? COUNTDOWN_SHIFT : 0)}px">
			{#key toastNow.title}
				<DesktopToast
					title={toastNow.title}
					text={toastNow.text}
					icon={toastNow.icon}
					warning={toastNow.warning}
					leaving={toastNow.leaving}
				/>
			{/key}
		</div>
	{/if}
</div>

<style>
.shell {
	position: fixed;
	inset: 0;
	/* Where the window does not shrink for the keyboard (iOS), the shell stops above it. */
	bottom: var(--keyboard-inset, 0px);
	overflow: hidden;
	background: var(--bg-deep);
	color: var(--fg);
}

/* The picture is drawn under the page, so the player route is a hole in it. */
.shell.player {
	background: transparent;
}

.layer {
	position: absolute;
	inset: 0;
}

/* The picture shows through the mini player's art area, so the page is painted around that rectangle. */
.shell.holed {
	background: transparent;
}

.shell.holed .layer {
	background: var(--bg-deep);
	mask-image: linear-gradient(#000 0 0), linear-gradient(#000 0 0);
	mask-size:
		100% 100%,
		var(--hole-w) var(--hole-h);
	mask-position:
		0 0,
		var(--hole-x) var(--hole-y);
	mask-repeat: no-repeat;
	mask-composite: exclude;
	-webkit-mask-composite: xor;
}

.content {
	position: absolute;
	inset: 0;
	overflow-y: auto;
	scrollbar-width: none;
}

.pip {
	position: absolute;
	right: 24px;
	bottom: 24px;
	z-index: 40;
}

.scrim {
	position: absolute;
	inset: 0;
	z-index: 80;
	border: 0;
	padding: 0;
	background: transparent;
}

.dl-scrim {
	position: absolute;
	inset: 0;
	z-index: 80;
	border: 0;
	padding: 0;
	background: transparent;
}

.dl-pop {
	position: absolute;
	z-index: 81;
	width: 320px;
	opacity: 0;
	transform: translateY(-6px) scale(0.96);
	transform-origin: top center;
	transition:
		opacity 130ms var(--ease-in),
		transform 130ms var(--ease-in);
}

.dl-pop.up {
	transform: translateY(-100%) translateY(6px) scale(0.96);
	transform-origin: bottom center;
}

.dl-pop.shown {
	opacity: 1;
	transform: translateY(0) scale(1);
	transition:
		opacity 180ms var(--ease),
		transform 180ms var(--ease);
}

.dl-pop.up.shown {
	transform: translateY(-100%) scale(1);
}

.menu {
	position: absolute;
	top: 60px;
	z-index: 81;
	transform-origin: top right;
	opacity: 0;
	transform: translateY(10px);
	transition:
		opacity 130ms var(--ease-in),
		transform 130ms var(--ease-in);
}

.menu.closing {
	transform: translateY(6px);
}

.menu.shown {
	opacity: 1;
	transform: translateY(0);
	transition:
		opacity 180ms var(--ease),
		transform 180ms var(--ease);
}

.toasts {
	position: absolute;
	right: 24px;
	z-index: 60;
	pointer-events: none;
}

.countdown {
	position: absolute;
	right: 24px;
	z-index: 61;
	opacity: 0;
	transform: translateY(-10px);
	transition:
		opacity var(--dur-base) var(--ease),
		transform 240ms var(--ease);
}

.countdown.shown {
	opacity: 1;
	transform: none;
}
</style>
