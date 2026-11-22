/** Least the page shrinks by when the on-screen keyboard opens: less is the browser's own bars. */
export const KEYBOARD_MIN_PX = 120;

const NOT_TYPED = new Set([
	"button",
	"checkbox",
	"color",
	"file",
	"hidden",
	"image",
	"radio",
	"range",
	"reset",
	"submit",
]);

/** Whether focus on this element brings up the on-screen keyboard. */
export const typesText = (el: Element | null) =>
	el instanceof HTMLTextAreaElement ||
	(el instanceof HTMLInputElement && !NOT_TYPED.has(el.type)) ||
	(el instanceof HTMLElement && el.isContentEditable);

export type KeyboardReading = {
	/** Whether the on-screen keyboard is up. */
	up: boolean;
	/** The page's height without the keyboard: what the window is, whatever is typed into it. */
	height: number;
};

/**
 * Tells the on-screen keyboard from the page's height: up while a field has focus and the page
 * stands shorter than it did before. Without focus the height is the page's own (a split screen
 * shrinks it too). A new width is a rotation: the height known for that width holds again, and
 * one never seen keeps the keyboard up if it was, by as much as it took before.
 */
export function keyboardWatch() {
	const fullAt = new Map<number, number>();
	let width = 0;
	let full = 0;
	let last = 0;
	let up = false;
	return (w: number, height: number, typing: boolean): KeyboardReading => {
		if (!typing) full = height;
		else if (w !== width) {
			const known = fullAt.get(w);
			full = Math.max(known ?? (up ? height + full - last : height), height);
		} else full = Math.max(full, height);
		fullAt.set(w, full);
		width = w;
		last = height;
		up = typing && full - height >= KEYBOARD_MIN_PX;
		return { up, height: up ? full : height };
	};
}
