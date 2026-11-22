import { createSubscriber } from "svelte/reactivity";
import { type KeyboardReading, keyboardWatch, typesText } from "#lib/platform/keyboard.ts";

// Whether the on-screen keyboard is up, and the page's size without it. The page shrinks above
// the keyboard (app.html's `interactive-widget=resizes-content`, MainActivity's inset on Android,
// `--keyboard-inset` below where neither applies), and what lays out by the window's size (the
// form factor, the phone shell's tab bar) must not follow it. No platform says so directly:
// keyboard.ts tells it from the page's size.

const watch = keyboardWatch();
let up = false;

/** How long focus may stay off the field, the page still short, before that is no keyboard. */
const SETTLE_MS = 800;

// Both sides come from the visual viewport, which the keyboard shrinks everywhere (on iOS it is
// the only one), times its scale, so a pinch, or iOS zooming in on a focused field, is neither a
// keyboard nor a rotation nor a new form factor.
function viewport() {
	const vv = window.visualViewport;
	return {
		width: Math.round(vv ? vv.width * vv.scale : window.innerWidth),
		height: vv ? vv.height * vv.scale : window.innerHeight,
	};
}

// Only a touch screen brings an on-screen keyboard up: with a mouse alone, a field keeping focus
// while the window is made shorter is just that.
function read(settled = false): KeyboardReading & { width: number } {
	const { width, height } = viewport();
	if (!matchMedia("(any-pointer: coarse)").matches) return { up: false, width, height };
	return { ...watch(width, height, typesText(document.activeElement), settled), width };
}

// Where the layout viewport does not shrink for the keyboard (iOS: WebKit has no
// `interactive-widget`, and WKWebView is not resized), the part of it the keyboard covers, for the
// shells to stop above. Elsewhere the layout viewport ends at the keyboard already, and it is 0.
function inset(keyboard: boolean) {
	const vv = window.visualViewport;
	const px = keyboard && vv ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) : 0;
	document.documentElement.style.setProperty("--keyboard-inset", `${Math.round(px)}px`);
}

const subscribe = createSubscriber((update) => {
	const vv = window.visualViewport;
	let frame = 0;
	let settle = 0;
	const set = (next: KeyboardReading) => {
		inset(next.up);
		// Focus off the field with the page still short: the keyboard closing, or focus passing
		// through a button. Neither lasts; past that, it was something else that made it short.
		clearTimeout(settle);
		if (next.up && !typesText(document.activeElement))
			settle = window.setTimeout(() => set(read(true)), SETTLE_MS);
		if (next.up === up) return;
		up = next.up;
		update();
	};
	// A resize is read at once, before anything that lays out by the page's size reads it. A blur
	// waits a frame: moving from one field to the next blurs the first before it focuses the second.
	const now = () => {
		cancelAnimationFrame(frame);
		set(read());
	};
	const later = () => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => set(read()));
	};
	// Read on subscribing too: with no reader left the listeners stop, and the value would be
	// whatever they last saw.
	const first = read();
	up = first.up;
	inset(up);
	vv?.addEventListener("resize", now);
	vv?.addEventListener("scroll", now);
	window.addEventListener("resize", now);
	document.addEventListener("focusin", now);
	document.addEventListener("focusout", later);
	return () => {
		cancelAnimationFrame(frame);
		clearTimeout(settle);
		document.documentElement.style.removeProperty("--keyboard-inset");
		vv?.removeEventListener("resize", now);
		vv?.removeEventListener("scroll", now);
		window.removeEventListener("resize", now);
		document.removeEventListener("focusin", now);
		document.removeEventListener("focusout", later);
	};
});

/** Whether the on-screen keyboard is up. */
export function keyboardUp(): boolean {
	subscribe();
	return up;
}

/**
 * The page's size without the on-screen keyboard, from the visual viewport times its scale: what
 * lays out by the window's size reads, so focusing a field never changes the layout under it.
 */
export function pageSize(): { width: number; height: number } {
	subscribe();
	const { width, height } = read();
	return { width, height };
}
