import { createSubscriber } from "svelte/reactivity";
import { type KeyboardState, keyboardWatch, typesText } from "#lib/platform/keyboard.ts";

// The on-screen keyboard and the page's size without it. While the keyboard is up the phone shell
// hides its tab bar and both touch shells their mini player, which the page shrinking above it
// (app.html's `interactive-widget=resizes-content`, MainActivity's inset on Android) would
// otherwise lift above it; the form factor reads the size without it, so the keyboard never
// changes layouts. No platform says so directly: keyboard.ts tells it from the page's size.

/** The page's size without the on-screen keyboard. */
export type PageSize = { width: number; height: number };

const watch = keyboardWatch();
let up = false;
let page: PageSize | null = null;

// Only a touch screen brings an on-screen keyboard up, and the app's touch screen is the primary
// pointer's, as the form factor reads it: with a mouse or a trackpad, a field keeping focus while
// the window is made shorter is just that. Both sides come from the visual viewport, which the
// keyboard shrinks everywhere (on iOS it is the only one), times its scale, so a pinch, or iOS
// zooming in on a focused field, is neither a keyboard nor a rotation.
function measure(resized: boolean): KeyboardState & { width: number } {
	const vv = window.visualViewport;
	const width = Math.round(vv ? vv.width * vv.scale : window.innerWidth);
	if (!matchMedia("(pointer: coarse)").matches) return { up: false, page: undefined, width };
	const reading = watch({
		width,
		height: vv ? vv.height * vv.scale : window.innerHeight,
		typing: typesText(document.activeElement),
		resized,
	});
	return { ...reading, width };
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
// factor and the shell never see a size the keyboard reading has not seen.
const subscribe = createSubscriber((update) => {
	const vv = window.visualViewport;
	const resized = () => {
		if (apply(measure(true))) update();
	};
	const focused = () => {
		if (apply(measure(false))) update();
	};
	// Read on subscribing too, as a fresh size: with no reader left the listeners stop, and the
	// value would be whatever they last saw.
	apply(measure(true));
	vv?.addEventListener("resize", resized);
	window.addEventListener("resize", resized);
	document.addEventListener("focusin", focused);
	document.addEventListener("focusout", focused);
	return () => {
		vv?.removeEventListener("resize", resized);
		window.removeEventListener("resize", resized);
		document.removeEventListener("focusin", focused);
		document.removeEventListener("focusout", focused);
	};
});

/** Whether the on-screen keyboard is up. */
export function keyboardUp(): boolean {
	subscribe();
	return up;
}

/** The page's size without the on-screen keyboard, once a touch screen has been read. */
export function pageSize(): PageSize | null {
	subscribe();
	return page;
}
