import type { PlayerCommand, PlayerEvent, Stats } from "#lib/core/playback/port.ts";
import { isPhone } from "#lib/platform/form-factor.svelte.ts";
import shaka from "shaka-player";

type Handler = (payload: never) => void;
type Rect = { full?: boolean; x?: number; y?: number; width?: number; height?: number };

const TICK_MS = 500;
const BANDWIDTH_STEP = 0.1;
const HLS = "application/x-mpegurl";

const listeners = new Map<PlayerEvent, Set<Handler>>();
let video: HTMLVideoElement | null = null;
let engine: shaka.Player | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let rect: Rect = { full: true };
let generation = 0;
let errored = false;
let lastBandwidth = 0;
let styled: { destroy(): Promise<void>; timeOffset: number } | null = null;
let styledCanvas: HTMLCanvasElement | null = null;
let styledGeneration = 0;
let subtitleOffset = 0;

function emit(event: PlayerEvent, payload: unknown) {
	for (const cb of [...(listeners.get(event) ?? [])]) (cb as (p: unknown) => void)(payload);
}

export function on<T>(event: PlayerEvent, cb: (e: T) => void): Promise<() => void> {
	const set = listeners.get(event) ?? new Set();
	listeners.set(event, set);
	set.add(cb as Handler);
	return Promise.resolve(() => void set.delete(cb as Handler));
}

/** The picture lives under the page, in the root, so no screen owns it. */
function element(): HTMLVideoElement {
	if (video) return video;
	const el = document.createElement("video");
	el.playsInline = true;
	el.preload = "auto";
	el.setAttribute("aria-hidden", "true");
	el.tabIndex = -1;
	el.style.pointerEvents = "none";
	el.style.zIndex = "-1";
	el.style.position = "fixed";
	el.style.background = "black";
	el.style.display = "none";
	// The page is see-through for the picture under it, and the player's stage draws nothing of
	// its own: until the picture shows, a browser would paint its white canvas there.
	document.documentElement.style.background = "black";
	document.documentElement.appendChild(el);
	for (const name of ["playing", "pause", "waiting", "seeking", "seeked", "ended", "canplay"])
		el.addEventListener(name, () => emitState(el));
	el.addEventListener("volumechange", () => emit("volume", { volume: el.volume, muted: el.muted }));
	el.addEventListener("error", () => {
		if (errored || !el.error) return;
		errored = true;
		emit("error", {
			code:
				el.error.code === MediaError.MEDIA_ERR_NETWORK
					? "ERROR_CODE_IO_NETWORK_CONNECTION_FAILED"
					: `MEDIA_ERR_${el.error.code}`,
			message: el.error.message || "The browser could not play this stream",
		});
	});
	video = el;
	place();
	return el;
}

function place() {
	if (!video) return;
	const s = video.style;
	if (rect.full || rect.width === undefined) {
		s.inset = "0";
		s.width = "100%";
		s.height = "100%";
		s.objectFit = "contain";
		return;
	}
	s.inset = "auto";
	s.left = `${rect.x}px`;
	s.top = `${rect.y}px`;
	s.width = `${rect.width}px`;
	s.height = `${rect.height}px`;
	s.objectFit = "cover";
}

function emitState(el: HTMLVideoElement) {
	if (!engine && !el.src) return;
	if (el.ended) return emit("state", { state: "ended" });
	const starving = !el.paused && (el.seeking || el.readyState < 3);
	emit("state", { state: starving ? "buffering" : el.paused ? "paused" : "playing" });
}

const rangeEnd = (el: HTMLVideoElement) => {
	for (let i = 0; i < el.buffered.length; i++)
		if (el.buffered.start(i) <= el.currentTime + 0.1 && el.buffered.end(i) >= el.currentTime)
			return el.buffered.end(i);
	return el.currentTime;
};

const duration = (el: HTMLVideoElement) =>
	Number.isFinite(el.duration) ? el.duration : (engine?.seekRange().end ?? 0);

function tick() {
	const el = video;
	if (!el || (!engine && !el.src)) return;
	emit("position", { position: el.currentTime, buffered: rangeEnd(el), duration: duration(el) });
	const bitrate = engine?.getStats().estimatedBandwidth ?? 0;
	if (bitrate > 0 && Math.abs(bitrate - lastBandwidth) > lastBandwidth * BANDWIDTH_STEP) {
		lastBandwidth = bitrate;
		emit("bandwidth", { bitrate, source: "meter" });
	}
}

async function dropStyled() {
	styledGeneration++;
	const old = styled;
	styled = null;
	styledCanvas?.remove();
	styledCanvas = null;
	await old?.destroy().catch(() => {});
}

/** Draws an ASS track over the picture with libass, as the file's author styled it. */
async function drawStyled(url: string, fonts: string[]) {
	await dropStyled();
	const run = styledGeneration;
	const { default: JASSUB } = await import("jassub");
	if (run !== styledGeneration) return;
	const el = element();
	const canvas = document.createElement("canvas");
	canvas.style.position = "absolute";
	canvas.style.pointerEvents = "none";
	canvas.style.zIndex = el.style.zIndex;
	el.insertAdjacentElement("afterend", canvas);
	const drawn = new JASSUB({
		video: el,
		canvas,
		subUrl: url,
		// The caller's list is reactive state, and a proxy cannot be posted to the worker.
		fonts: [...fonts],
		timeOffset: -subtitleOffset,
		// The file's own fonts only: asking the browser for the viewer's installed fonts
		// prompts for a permission, and looking them up online tells a third party what plays.
		queryFonts: false,
	});
	styled = drawn;
	styledCanvas = canvas;
	try {
		await drawn.ready;
	} catch (e) {
		if (run === styledGeneration) await dropStyled();
		throw e;
	}
}

async function unload() {
	generation++;
	clearInterval(timer);
	timer = undefined;
	const old = engine;
	engine = null;
	if (video) {
		video.pause();
		video.removeAttribute("src");
		video.load();
	}
	await old?.destroy().catch(() => {});
}

async function load(url: string, at: number) {
	const el = element();
	await unload();
	const id = generation;
	errored = false;
	lastBandwidth = 0;
	el.style.display = "";
	place();
	emit("state", { state: "buffering" });
	if (/\/file\//.test(new URL(url, location.href).pathname)) {
		el.src = url;
		await new Promise<void>((done, fail) => {
			el.addEventListener("loadedmetadata", () => done(), { once: true });
			el.addEventListener("error", () => fail(new Error(el.error?.message ?? "load failed")), {
				once: true,
			});
		});
		if (at > 0) el.currentTime = at;
	} else {
		shaka.polyfill.installAll();
		const player = new shaka.Player();
		engine = player;
		player.configure({
			streaming: {
				retryParameters: {
					maxAttempts: 2,
					baseDelay: 500,
					backoffFactor: 1,
					fuzzFactor: 0,
					timeout: 8000,
				},
			},
			manifest: {
				// Shaka otherwise moves every segment so that its first decode time sits on the
				// playlist's start time. The engine's playlist is cut on keyframe pts, and a keyframe
				// followed by leading pictures (open GOP) decodes a frame or more earlier than the
				// others do, so that one segment got pushed late and left a hole before it. The
				// engine's segments carry the file's real times: they place themselves.
				// Captions detection: Shaka looks for captions carried inside the video, and when the
				// first segment has none it fetches the middle and the last one too. Each of those is
				// a seek to the engine, which restarts its conversion three times before the film
				// starts, and the run that comes back to the second segment no longer has the first
				// one to line up with: a hole in the sound two seconds in. Subtitles never come that way.
				hls: { ignoreManifestTimestampsInSegmentsMode: true, disableClosedCaptionsDetection: true },
				retryParameters: {
					maxAttempts: 2,
					baseDelay: 500,
					backoffFactor: 1,
					fuzzFactor: 0,
					timeout: 8000,
				},
			},
		});
		player.addEventListener("error", (e) => {
			const detail = (e as unknown as { detail: shaka.util.Error }).detail;
			if (errored || id !== generation || detail.severity !== shaka.util.Error.Severity.CRITICAL)
				return;
			errored = true;
			emit("error", {
				code:
					detail.category === shaka.util.Error.Category.NETWORK
						? "ERROR_CODE_IO_NETWORK_CONNECTION_FAILED"
						: `SHAKA_${detail.code}`,
				message: `Shaka ${detail.code}`,
			});
		});
		await player.attach(el);
		try {
			await player.load(url, at > 0 ? at : null, HLS);
		} catch (e) {
			throw new Error(`Shaka ${(e as shaka.util.Error).code ?? e}`);
		}
		if (id !== generation) return;
	}
	timer = setInterval(tick, TICK_MS);
	tick();
	emit("state", { state: "paused" });
}

async function play() {
	const el = element();
	try {
		await el.play();
	} catch (e) {
		if ((e as DOMException).name === "NotAllowedError") {
			emit("state", { state: "paused" });
			return;
		}
		if ((e as DOMException).name !== "AbortError") throw e;
	}
}

function stats(): Stats {
	const el = element();
	const quality = el.getVideoPlaybackQuality?.();
	const s = engine?.getStats();
	return {
		player: "Shaka",
		version: shaka.Player.version,
		buffer: Math.max(0, rangeEnd(el) - el.currentTime),
		videoBitrate: s?.streamBandwidth ?? 0,
		audioBitrate: 0,
		rendered: quality?.totalVideoFrames ?? 0,
		dropped: quality?.droppedVideoFrames ?? 0,
		displayHz: 0,
	};
}

/**
 * The web's share of what the Android app does for a film on a phone: the whole screen, turned to
 * landscape. A browser allows the turn only in fullscreen, and fullscreen only shortly after a tap.
 */
function fillScreen(on: boolean) {
	if (!isPhone()) return;
	if (!on) {
		if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
		return;
	}
	if (document.fullscreenElement) return;
	const turn = screen.orientation as { lock?: (to: string) => Promise<void> };
	document.documentElement
		.requestFullscreen()
		.then(() => turn.lock?.("landscape"))
		.catch(() => {});
}

export async function command(
	cmd: PlayerCommand,
	args: Record<string, unknown> = {},
): Promise<unknown> {
	switch (cmd) {
		case "load":
			return load(String(args.url), Number(args.at ?? 0));
		case "play":
			return play();
		case "pause":
			element().pause();
			return null;
		case "seek":
			element().currentTime = Number(args.seconds);
			setTimeout(tick, 0);
			return null;
		case "speed":
			element().playbackRate = Number(args.speed);
			return null;
		case "stop":
			await unload();
			if (video) video.style.display = "none";
			fillScreen(false);
			emit("state", { state: "idle" });
			return null;
		case "stats":
			return stats();
		case "volume": {
			const el = element();
			el.volume = Math.min(1, Math.max(0, Number(args.volume)));
			el.muted = !!args.muted;
			return null;
		}
		case "viewport":
			rect = args as Rect;
			place();
			fillScreen(!!args.full);
			return null;
		case "subtitle":
			if (args.kind !== "ass") return dropStyled();
			return drawStyled(String(args.url), (args.fonts as string[] | undefined) ?? []);
		case "timing":
			subtitleOffset = Number(args.subtitleOffset ?? 0);
			if (styled) styled.timeOffset = -subtitleOffset;
			return null;
		default:
			return null;
	}
}

export const position = () => video?.currentTime ?? 0;
