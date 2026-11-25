import { onMount } from "svelte";

/** How long a slide stays before the rotation moves on. */
export const HERO_MS = 8000;
/** The backdrop's slow zoom outlasts its slide, so it is still moving when the slide leaves. */
export const ZOOM_MS = HERO_MS + 1500;
const SWAP_MS = 260;
/** The share of the hero that must be on screen for it to keep moving. */
const ON_SCREEN = 0.5;
/**
 * The zoom is counted for PROBE_MS, PROBE_AFTER_MS into a slide. Under SMOOTH_FPS frames a second
 * the webview is drawing it on the CPU (no GPU, or a driver it does not use), where a full-screen
 * zoom takes whole cores: the backdrop then stays still and the progress bar moves in steps.
 * WebKitGTK names no renderer to the page (WebGL answers "Apple GPU" on llvmpipe too), so the
 * frame rate is the only sign of it the page can read.
 */
const PROBE_AFTER_MS = 1000;
const PROBE_MS = 2000;
const SMOOTH_FPS = 40;

/**
 * The rotation of a home hero: which slide shows, the phase of its text, and whether anything
 * may move. Nothing here runs on a tick: the progress bar and the zoom are CSS animations the
 * component pauses with `moving`, and one timeout per slide brings the next one.
 *
 * The hero stands still, where it is, while its window has no focus, the page is hidden or less
 * than half of it is on screen. With `prefers-reduced-motion` it does not rotate or zoom at all.
 */
export function heroRotation(count: () => number) {
	let index = $state(0);
	let phase = $state<"pre" | "in" | "out">("pre");
	let previous = $state(-1);
	let zoomed = $state(false);
	let reduced = $state(false);
	let focused = $state(true);
	let shown = $state(true);
	let onScreen = $state(true);
	let smooth = $state(true);
	let frozen = $state(-1);
	let probed = false;
	let left = HERO_MS;
	let swap: ReturnType<typeof setTimeout>;

	const at = $derived(count() ? index % count() : 0);
	const moving = $derived(focused && shown && onScreen);
	const rotating = $derived(phase === "in" && moving && !reduced && count() > 1);

	const settle = () => requestAnimationFrame(() => requestAnimationFrame(() => (phase = "in")));

	function go(i: number) {
		if (i === at || phase === "out") return;
		clearTimeout(swap);
		phase = "out";
		swap = setTimeout(() => {
			if (frozen !== at) frozen = -1;
			previous = at;
			index = i;
			left = HERO_MS;
			zoomed = false;
			phase = "pre";
			settle();
		}, SWAP_MS);
	}

	// The slide's remaining time is kept across a pause, so the timeout and the progress bar,
	// which the same pause freezes, reach the end together.
	$effect(() => {
		if (!rotating) return;
		const started = performance.now();
		const next = setTimeout(() => go((at + 1) % count()), Math.max(0, left));
		return () => {
			clearTimeout(next);
			left -= performance.now() - started;
		};
	});

	// One count per page, while the zoom runs undisturbed. A pause starts it over.
	$effect(() => {
		if (probed || reduced || phase !== "in" || !moving) return;
		let frame = 0;
		let frames = 0;
		let start = 0;
		const tick = (now: number) => {
			start ||= now;
			if (now - start >= PROBE_MS) {
				probed = true;
				if ((frames * 1000) / (now - start) < SMOOTH_FPS) {
					frozen = at;
					smooth = false;
				}
				return;
			}
			frames++;
			frame = requestAnimationFrame(tick);
		};
		const wait = setTimeout(() => (frame = requestAnimationFrame(tick)), PROBE_AFTER_MS);
		return () => {
			clearTimeout(wait);
			cancelAnimationFrame(frame);
		};
	});

	onMount(() => {
		const motion = matchMedia("(prefers-reduced-motion: reduce)");
		const onMotion = () => (reduced = motion.matches);
		const onFocus = () => (focused = true);
		const onBlur = () => (focused = false);
		const onShown = () => (shown = !document.hidden);
		onMotion();
		onShown();
		focused = document.hasFocus();
		motion.addEventListener("change", onMotion);
		window.addEventListener("focus", onFocus);
		window.addEventListener("blur", onBlur);
		document.addEventListener("visibilitychange", onShown);
		settle();
		return () => {
			motion.removeEventListener("change", onMotion);
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("blur", onBlur);
			document.removeEventListener("visibilitychange", onShown);
			clearTimeout(swap);
		};
	});

	return {
		get at() {
			return at;
		},
		get phase() {
			return phase;
		},
		get reduced() {
			return reduced;
		},
		/** False once the webview was seen drawing the zoom on the CPU. */
		get smooth() {
			return smooth;
		},
		/** False while the hero must stand still: the component pauses its animations on it. */
		get moving() {
			return moving;
		},
		/** The progress bar of the current slide advances. */
		get rotating() {
			return rotating;
		},
		go,
		/** Action for the hero element: tells whether enough of it is on screen. */
		watch(el: HTMLElement) {
			const seen = new IntersectionObserver(
				(entries) => (onScreen = (entries.at(-1)?.intersectionRatio ?? 1) >= ON_SCREEN),
				{ threshold: ON_SCREEN },
			);
			seen.observe(el);
			return {
				destroy() {
					seen.disconnect();
					onScreen = true;
				},
			};
		},
		/**
		 * Slide `i` carries the zoom animation: the current one once its text comes in, and the
		 * one that just left, which keeps the scale it had reached while it fades out.
		 */
		zooms: (i: number) =>
			!reduced && (i === frozen || (smooth && (i === at ? phase !== "pre" : i === previous))),
		/** Slide `i` is zooming right now, and only then worth a compositing layer of its own. */
		zooming: (i: number) => !reduced && smooth && i === at && phase !== "pre" && moving && !zoomed,
		/** Call when the current slide's zoom animation ends. */
		zoomEnded: () => (zoomed = true),
		/** Slide `i` carries the progress animation. */
		fills: (i: number) => !reduced && i === at && phase !== "pre",
	};
}
