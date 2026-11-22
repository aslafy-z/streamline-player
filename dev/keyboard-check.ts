// node dev/keyboard-check.ts
import { strictEqual as eq, deepStrictEqual as same } from "node:assert";
import { isPhoneSize } from "../src/lib/platform/form-factor.ts";
import { KEYBOARD_MIN_PX, keyboardWatch } from "../src/lib/platform/keyboard.ts";

let watch = keyboardWatch();
// A resize (the page's size changed) and a focus change (only the focused element did).
const size = (width: number, height: number, typing: boolean) =>
	watch({ width, height, typing, resized: true });
const focus = (width: number, height: number, typing: boolean) =>
	watch({ width, height, typing, resized: false });
const up = (state: { up: boolean }) => state.up;

// Focus, then the keyboard comes up and goes down again (Back, the field still focused).
same(size(412, 892, false), { up: false, page: 892 });
eq(up(focus(412, 892, true)), false);
same(size(412, 572, true), { up: true, page: 892 });
eq(up(size(412, 892, true)), false);
eq(up(size(412, 572, true)), true);
eq(up(size(412, 892, false)), false);

// The browser's bars coming and going are no keyboard.
watch = keyboardWatch();
size(412, 892, false);
focus(412, 892, true);
eq(up(size(412, 892 - KEYBOARD_MIN_PX + 1, true)), false);
eq(up(size(412, 892 - KEYBOARD_MIN_PX, true)), true);

// Shrunk without focus (a split screen), then focus: the keyboard counts from the new height.
watch = keyboardWatch();
size(412, 892, false);
same(size(412, 440, false), { up: false, page: 440 });
eq(up(focus(412, 440, true)), false);
eq(up(size(412, 200, true)), true);

// Focus passing through a button with the keyboard up (the search's clear button, a menu focusing
// its own field): the keyboard stays up and its height is never taken for the page's.
watch = keyboardWatch();
size(412, 892, false);
focus(412, 892, true);
size(412, 572, true);
same(focus(412, 572, false), { up: true, page: 892 });
same(focus(412, 572, true), { up: true, page: 892 });

// A tap on nothing: the keyboard stays up until the page has grown back, so nothing comes back
// above it on its way down.
watch = keyboardWatch();
size(412, 892, false);
focus(412, 892, true);
size(412, 572, true);
eq(up(focus(412, 572, false)), true);
same(size(412, 700, false), { up: true, page: 892 });
same(size(412, 892, false), { up: false, page: 892 });

// A rotation with the keyboard up finds the height that width had without it.
watch = keyboardWatch();
size(892, 412, false);
size(412, 892, false);
focus(412, 892, true);
eq(up(size(412, 572, true)), true);
same(size(892, 180, true), { up: true, page: 412 });
eq(up(size(412, 572, true)), true);
eq(up(size(412, 892, true)), false);

// A rotation with the keyboard up to a width never seen: the keyboard stays up and the page's
// height unknown until the page grows there, the keyboard closing.
watch = keyboardWatch();
size(412, 892, false);
focus(412, 892, true);
size(412, 572, true);
same(size(892, 180, true), { up: true, page: undefined });
same(size(892, 190, true), { up: true, page: undefined });
same(size(892, 412, true), { up: false, page: 412 });
eq(up(size(892, 180, true)), true);

// A width first met with a field focused and the keyboard down: the page's height is that one.
watch = keyboardWatch();
same(size(412, 892, true), { up: false, page: 892 });
eq(up(size(412, 572, true)), true);

// The form factor reads the page without the keyboard: a landscape tablet stays a tablet with the
// keyboard up (450 tall), and becomes a phone in a top and bottom split (390 tall, no field).
watch = keyboardWatch();
size(1280, 800, false);
focus(1280, 800, true);
const typed = size(1280, 450, true);
eq(typed.up, true);
eq(isPhoneSize(1280, typed.page ?? 0), false);
size(1280, 800, false);
const split = size(1280, 390, false);
eq(split.up, false);
eq(isPhoneSize(1280, split.page ?? 0), true);

// A window dragged by its edge passes through many widths; only the last ones are kept, and an
// old one is measured afresh.
watch = keyboardWatch();
for (let width = 400; width < 1400; width++) size(width, 800, false);
same(focus(400, 600, false), { up: false, page: undefined });

console.log("keyboard-check: ok");
