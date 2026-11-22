<script lang="ts">
import { prefs } from "#lib/core/prefs.svelte.ts";
import { goto } from "#lib/ui/nav.ts";
import { afterNavigate, beforeNavigate } from "$app/navigation";
import { page } from "$app/state";
import {
	type AskSpec,
	asking,
	closeAsk,
	confirmAsk,
	counting,
	finishCountdown,
} from "#lib/core/ask.svelte.ts";
import { loadActivity, resetActivity } from "#lib/core/activity.svelte.ts";
import { account, clearMe, setMe } from "#lib/core/me.svelte.ts";
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
import { anyActive, dl, entry, initDownloads } from "#lib/core/downloads.svelte.ts";
import { loadLibrary } from "#lib/core/library.svelte.ts";
import { net, watchOnline } from "#lib/core/online.svelte.ts";
import { activeToast, toast } from "#lib/core/toast.svelte.ts";
import { nowPlaying, stop, toFull } from "#lib/core/playback/now-playing.svelte.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { keyboardUp } from "#lib/platform/keyboard.svelte.ts";
import { adminPort } from "#lib/screens/admin/port.ts";
import { downloadsPort } from "#lib/screens/downloads-port.ts";
import CardLangPopover from "#lib/screens/CardLangPopover.svelte";
import { currentTab, hidesTabs, type PhoneTab, TAB_PATHS } from "#lib/shells/phone/tabs.ts";
import Sheet from "#lib/shells/phone/Sheet.svelte";
import TabBar from "#lib/shells/phone/TabBar.svelte";
import AskDialog from "#lib/ui/AskDialog.svelte";
import { provideDialogSurface } from "#lib/ui/dialog-surface.ts";
import CountdownToast from "#lib/ui/CountdownToast.svelte";
import DesktopToast from "#lib/ui/DesktopToast.svelte";
import DownloadPicker from "#lib/ui/DownloadPicker.svelte";
import DownloadPopover from "#lib/ui/DownloadPopover.svelte";
import MiniPlayer from "#lib/ui/MiniPlayer.svelte";
import { downloadWords } from "#lib/ui/download-words.ts";
import { presence } from "#lib/ui/presence.svelte.ts";
import { provideScroll } from "#lib/ui/scroll.ts";
import {
	activity,
	canDownload,
	home,
	library,
	markActivityRead,
	me,
	playbackPort,
	reachable,
	syncOffline,
	setWifiOnly,
	takeLaunchRoute,
	title as fetchTitle,
	watchState,
} from "#platform";
import type { Snippet } from "svelte";
import { onMount, untrack } from "svelte";

const ACTIVITY_PORT = { activity, markActivityRead };
const LIBRARY_PORT = { library, watchState, home, title: fetchTitle };
const COUNTDOWN_SHIFT = 74;
const PIP_WIDTH = 220;

let { children }: { children: Snippet } = $props();

provideDialogSurface(Sheet);

let content = $state<HTMLElement>();
provideScroll(() => content);

const scrolls = new Map<string, number>();
beforeNavigate(({ from }) => {
	if (from?.url && content) scrolls.set(from.url.href, content.scrollTop);
});
afterNavigate(({ from, to, type }) => {
	if (!content || !to?.url || from?.url?.pathname === to.url.pathname) return;
	content.scrollTop = type === "popstate" ? (scrolls.get(to.url.href) ?? 0) : 0;
});

const route = $derived(page.route.id ?? "");
const onboarding = $derived(
	route === "/welcome" || route === "/pair" || route.startsWith("/signin"),
);
const inPlayer = $derived(route.startsWith("/player"));
// The keyboard takes the tabs' place: a page being typed into keeps the room for itself. Read
// first, so the watch holds on every route and a tabbed one never starts from a stale reading.
const showTabs = $derived(!keyboardUp() && !hidesTabs(route));

let pip = $state<HTMLElement>();
let pipArt = $state<HTMLElement>();
let hole = $state<{ x: number; y: number; width: number; height: number } | null>(null);
const launch = $derived(nowPlaying.launch);
const showMini = $derived(
	!!nowPlaying.pb && nowPlaying.mini && !!launch && !inPlayer && !onboarding,
);
const pictureReady = $derived((nowPlaying.pb?.position ?? 0) > 0);
const holed = $derived(showMini && pictureReady);
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

$effect(() => {
	if (!showMini || !pip || !pipArt) {
		hole = null;
		return;
	}
	// The tabs coming and going move the pip without resizing anything: measure it again then.
	void showTabs;
	const wrap = pip;
	const art = pipArt;
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

const tabs = $derived<{ id: PhoneTab; label: string }[]>([
	{ id: "home", label: i18n.nav_home() },
	{ id: "library", label: i18n.nav_library() },
	{ id: "search", label: i18n.nav_search() },
	...(canDownload ? [{ id: "downloads" as const, label: i18n.shell_downloads() }] : []),
]);

const go = (id: PhoneTab) => goto(TAB_PATHS[id]);

const question = presence(() => !!asking.spec, 230);
const counter = presence(() => !!counting.spec, 240);
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
$effect(() => {
	if (dlAsking.pick) lastPick = dlAsking.pick;
});
$effect(() => {
	if (dlAsking.popover) lastPopover = dlAsking.popover;
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

$effect(() => {
	if (onboarding) {
		clearMe();
		resetActivity();
		resetAdmin();
	} else untrack(() => loadActivity(ACTIVITY_PORT));
});

$effect(() => {
	if (onboarding || !account.me) return;
	if (account.me.role === "Admin") untrack(() => loadPendingPairs(adminPort));
	else pendingPairs.n = 0;
});

$effect(() => {
	if (onboarding || account.me) return;
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
		if (account.me?.role === "Admin") loadPendingPairs(adminPort);
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

const toastNow = $derived(activeToast());
</script>

<div class="shell" class:player={inPlayer} class:tabbed={showTabs} class:holed>
	<div
		class="layer"
		style:--hole-x="{hole?.x ?? 0}px"
		style:--hole-y="{hole?.y ?? 0}px"
		style:--hole-w="{hole?.width ?? 0}px"
		style:--hole-h="{hole?.height ?? 0}px"
	>
		<div class="content" bind:this={content}>
			{@render children()}
		</div>

		{#if showTabs}
			<div class="bar">
				<TabBar
					items={tabs}
					current={currentTab(route)}
					label={i18n.nav_main()}
					downloadsDot={anyActive()}
					onnavigate={go}
				/>
			</div>
		{/if}
	</div>

	{#if showMini && launch && nowPlaying.pb}
		<div class="pip" bind:this={pip}>
			<MiniPlayer
				title={miniTitle}
				still={launch.view.still}
				progress={miniProgress}
				playing={nowPlaying.pb.playing}
				width={PIP_WIDTH}
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

	<CardLangPopover barHeight={0} />

	{#if popover.mounted && lastPopover && popView}
		<Sheet
			closeLabel={i18n.shell_close()}
			shown={popover.shown && !!dlAsking.popover}
			onclose={closePopover}
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
		</Sheet>
	{/if}

	{#if counter.mounted && lastCount}
		<div class="toasts countdown" class:shown={counter.shown}>
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
		<div class="toasts" style:--shift="{counting.spec ? COUNTDOWN_SHIFT : 0}px">
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
	--tabs-h: calc(58px + env(safe-area-inset-bottom));
	position: fixed;
	inset: 0;
	overflow: hidden;
	background: var(--bg-deep);
	color: var(--fg);
}

.shell.player {
	background: transparent;
}

.layer {
	position: absolute;
	inset: 0;
}

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

.pip {
	position: absolute;
	right: 12px;
	bottom: calc(12px + env(safe-area-inset-bottom));
	z-index: 40;
}

.tabbed .pip {
	bottom: calc(var(--tabs-h) + 12px);
}

.content {
	position: absolute;
	inset: 0;
	overflow-x: hidden;
	overflow-y: auto;
	overscroll-behavior: contain;
	scrollbar-width: none;
}

.tabbed .content {
	padding-bottom: calc(var(--tabs-h) + 28px);
}

.bar {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	z-index: 20;
}

.toasts {
	position: absolute;
	left: 12px;
	right: 12px;
	top: calc(env(safe-area-inset-top) + 16px + var(--shift, 0px));
	z-index: 60;
	pointer-events: none;
}

.toasts :global(.sl-toast),
.toasts :global(.sl-cdtoast) {
	width: 100%;
}

.toasts.countdown {
	top: calc(env(safe-area-inset-top) + 16px);
	z-index: 61;
	pointer-events: auto;
	opacity: 0;
	transform: translateY(-10px);
	transition:
		opacity var(--dur-base) var(--ease),
		transform 240ms var(--ease);
}

.toasts.countdown.shown {
	opacity: 1;
	transform: none;
}
</style>
