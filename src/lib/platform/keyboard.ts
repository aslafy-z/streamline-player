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

/** Whether focus on this element brings the on-screen keyboard up. */
export const typesText = (el: Element | null): boolean =>
	el instanceof HTMLTextAreaElement ||
	(el instanceof HTMLInputElement && !NOT_TYPED.has(el.type)) ||
	(el instanceof HTMLElement && el.isContentEditable);

/** Widths remembered: both orientations and a split or two, not every step of a window drag. */
const WIDTHS_KEPT = 4;

export type KeyboardReading = {
	/** Whether the on-screen keyboard is up. */
	up: boolean;
	/** The page's height without the keyboard: what lays out by the window's size reads. */
	height: number;
};

/**
 * Tells the on-screen keyboard from the page's size. It comes up while a text field has focus and
 * the page stands at least KEYBOARD_MIN_PX shorter than it did at the same width without it.
 *
 * Once up, focus leaving the field is not the keyboard gone: a tap on a button beside it (a
 * search's clear) moves focus for a moment, and a keyboard closing takes a while to give the
 * height back. It stays up while the page is still short, until the height comes back or the
 * caller says the page has `settled` (a split screen made it short, not a keyboard).
 *
 * Without focus and without a keyboard, the height is the page's own, which a split screen
 * shrinks too. The height is kept per width, so a rotation finds the one that width had; a width
 * never seen, reached with the keyboard up, starts from the width left behind, which is about the
 * height the other orientation has.
 */
export function keyboardWatch(): (
	width: number,
	height: number,
	typing: boolean,
	settled?: boolean,
) => KeyboardReading {
	const fullAt = new Map<number, number>();
	let lastWidth = 0;
	let up = false;
	return (width, height, typing, settled = false) => {
		let known = fullAt.get(width);
		if (known === undefined && up && typing && lastWidth) known = lastWidth;
		const shrunk = known !== undefined && known - height >= KEYBOARD_MIN_PX;
		let full: number;
		if (typing) {
			full = Math.max(known ?? height, height);
			up = shrunk;
		} else if (up && shrunk && !settled) full = known ?? height;
		else {
			full = height;
			up = false;
		}
		fullAt.delete(width);
		fullAt.set(width, full);
		if (fullAt.size > WIDTHS_KEPT) fullAt.delete(fullAt.keys().next().value as number);
		lastWidth = width;
		return { up, height: full };
	};
}
