import { createSubscriber } from "svelte/reactivity";
import { keyboardWatch, typesText } from "#lib/platform/keyboard.ts";

let up = false;

// The visual viewport is what the keyboard shrinks everywhere: on iOS, and in a browser that
// keeps the layout viewport, it is the only one. Times its scale, so a pinch is not a keyboard;
// the width is the layout's, which a zoom (iOS zooms into a small field on focus) leaves alone.
const subscribe = createSubscriber((update) => {
	const vv = window.visualViewport;
	const watch = keyboardWatch();
	let frame = 0;
	// A frame late: moving from one field to the next blurs the first before focusing the second.
	const check = () => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			const height = vv ? vv.height * vv.scale : window.innerHeight;
			const width = document.documentElement.clientWidth;
			const next = watch(width, height, typesText(document.activeElement)).up;
			if (next === up) return;
			up = next;
			update();
		});
	};
	check();
	vv?.addEventListener("resize", check);
	window.addEventListener("resize", check);
	document.addEventListener("focusin", check);
	document.addEventListener("focusout", check);
	return () => {
		cancelAnimationFrame(frame);
		// Unwatched, the keyboard is unknown: the next subscriber starts from down, not from stale.
		up = false;
		vv?.removeEventListener("resize", check);
		window.removeEventListener("resize", check);
		document.removeEventListener("focusin", check);
		document.removeEventListener("focusout", check);
	};
});

/** Whether the on-screen keyboard is up. */
export function keyboardUp() {
	subscribe();
	return up;
}
