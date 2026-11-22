import { createSubscriber } from "svelte/reactivity";
import {
	type KeyboardReading,
	type KeyboardState,
	keyboardWatch,
	typesText,
} from "#lib/platform/keyboard.ts";

// The on-screen keyboard and the page's size without it. While the keyboard is up the phone shell
// hides its tab bar and both touch shells their mini player, which the page shrinking above it
// (app.html's `interactive-widget=resizes-content`, MainActivity's inset on Android,
// `--keyboard-inset` where neither applies) would otherwise lift above it; the form factor reads
// the size without it, so the keyboard never changes layouts. No platform says so directly:
// keyboard.ts tells it from the page's size.

/** The page's size without the on-screen keyboard. */
export type PageSize = { width: number; height: number };

const watch = keyboardWatch();
let up = false;
let page: PageSize | null = null;

/** How long focus stays out of every field, the page not grown back, before that means no keyboard. */
const IDLE_MS = 1000;

// Only a touch screen brings an on-screen keyboard up, and the app's touch screen is the primary
// pointer's, as the form factor reads it: with a mouse or a trackpad, a field keeping focus while
// the window is made shorter is just that. The page's size is read either way, so a pointer that
// turns coarse (a tablet mode) finds it known. Both sides come from the visual viewport, which the
// keyboard shrinks everywhere (on iOS it is the only one), times its scale, so a pinch, or iOS
// zooming in on a focused field, is neither a keyboard nor a rotation.
const touch = () => matchMedia("(pointer: coarse)").matches;

function measure(kind: KeyboardReading["kind"]): KeyboardState & { width: number } {
	const vv = window.visualViewport;
	const width = Math.round(vv ? vv.width * vv.scale : window.innerWidth);
	const coarse = touch();
	const reading = watch({
		width,
		height: vv ? vv.height * vv.scale : window.innerHeight,
		typing: coarse && typesText(document.activeElement),
		kind,
	});
	return { up: coarse && reading.up, page: reading.page, width };
}

// Where the layout viewport does not shrink for the keyboard (iOS: WebKit has no
// `interactive-widget`, and WKWebView is not resized), the part of it the keyboard covers, for the
// shells to stop above. Elsewhere the layout viewport ends at the keyboard already, and it is 0.
function inset(keyboard: boolean) {
	const vv = window.visualViewport;
	const px = keyboard && vv ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) : 0;
	document.documentElement.style.setProperty("--keyboard-inset", `${Math.round(px)}px`);
}

// A width whose height without the keyboard is unknown keeps the last size known.
const apply = (state: KeyboardState & { width: number }): boolean => {
	const next = state.page === undefined ? page : { width: state.width, height: state.page };
	const moved = next?.width !== page?.width || next?.height !== page?.height;
	const changed = state.up !== up || moved;
	up = state.up;
	page = next;
	return changed;
};

// One listener reads the page for both, at once on every resize and focus change, so the form
// factor and the shell never see a size the keyboard reading has not seen. Focus leaving every
// field with the keyboard up starts the idle wait; focus reaching one ends it.
const subscribe = createSubscriber((update) => {
	const vv = window.visualViewport;
	const pointer = matchMedia("(pointer: coarse)");
	let idle: ReturnType<typeof setTimeout> | undefined;
	const read = (kind: KeyboardReading["kind"]) => {
		const changed = apply(measure(kind));
		inset(up);
		if (changed) update();
	};
	const resized = () => read("resize");
	// iOS moves the visual viewport over the page under the keyboard: only the inset follows.
	const moved = () => inset(up);
	const focused = () => {
		clearTimeout(idle);
		read("focus");
		if (up && !typesText(document.activeElement)) idle = setTimeout(() => read("idle"), IDLE_MS);
	};
	// Read on subscribing too, as a fresh size: with no reader left the listeners stop, and the
	// value would be whatever they last saw.
	apply(measure("resize"));
	inset(up);
	vv?.addEventListener("resize", resized);
	vv?.addEventListener("scroll", moved);
	window.addEventListener("resize", resized);
	pointer.addEventListener("change", resized);
	document.addEventListener("focusin", focused);
	document.addEventListener("focusout", focused);
	return () => {
		clearTimeout(idle);
		document.documentElement.style.removeProperty("--keyboard-inset");
		vv?.removeEventListener("resize", resized);
		vv?.removeEventListener("scroll", moved);
		window.removeEventListener("resize", resized);
		pointer.removeEventListener("change", resized);
		document.removeEventListener("focusin", focused);
		document.removeEventListener("focusout", focused);
	};
});

/** Whether the on-screen keyboard is up. */
export function keyboardUp(): boolean {
	subscribe();
	return up;
}

/** The page's size without the on-screen keyboard, once it has been read. */
export function pageSize(): PageSize | null {
	subscribe();
	return page;
}
