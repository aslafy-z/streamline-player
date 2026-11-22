// node dev/keyboard-check.ts
import { strictEqual as eq } from "node:assert";
import { KEYBOARD_MIN_PX, keyboardWatch } from "../src/lib/platform/keyboard.ts";

const watch = () => {
	const read = keyboardWatch();
	return (w: number, height: number, typing: boolean, settled = false) =>
		read(w, height, typing, settled).up;
};

// Focus, then the keyboard comes up and goes down again (Back, the field still focused).
let up = watch();
eq(up(412, 892, false), false);
eq(up(412, 892, true), false);
eq(up(412, 572, true), true);
eq(up(412, 892, true), false);
eq(up(412, 572, true), true);
eq(up(412, 892, false), false);

// The browser's bars coming and going are no keyboard.
up = watch();
eq(up(412, 892, true), false);
eq(up(412, 892 - KEYBOARD_MIN_PX + 1, true), false);
eq(up(412, 892 - KEYBOARD_MIN_PX, true), true);

// Shrunk without focus (a split screen), then focus: the keyboard counts from the new height.
up = watch();
eq(up(412, 892, false), false);
eq(up(412, 440, false), false);
eq(up(412, 440, true), false);
eq(up(412, 200, true), true);

// A tap on a button beside the field (a search's clear) moves focus for a moment: still up, and
// still up once the field has it back.
up = watch();
eq(up(412, 892, true), false);
eq(up(412, 572, true), true);
eq(up(412, 572, false), true);
eq(up(412, 572, true), true);

// Focus leaves and the keyboard closes: up while the page is still short, down once it is not.
up = watch();
eq(up(412, 892, true), false);
eq(up(412, 572, true), true);
eq(up(412, 572, false), true);
eq(up(412, 700, false), true);
eq(up(412, 800, false), false);
eq(up(412, 892, false), false);

// Focus left and the page stayed short: settled, it was no keyboard, and that is the height now.
up = watch();
eq(up(412, 892, true), false);
eq(up(412, 572, true), true);
eq(up(412, 572, false), true);
eq(up(412, 572, false, true), false);
eq(up(412, 572, true), false);

// A rotation with the keyboard up finds the height that width had without it.
up = watch();
eq(up(892, 412, false), false);
eq(up(412, 892, false), false);
eq(up(412, 892, true), false);
eq(up(412, 572, true), true);
eq(up(892, 180, true), true);
eq(up(412, 572, true), true);
eq(up(412, 892, true), false);

// A width never seen, reached with the keyboard up: the width left behind stands for its height.
up = watch();
eq(up(412, 892, true), false);
eq(up(412, 572, true), true);
eq(up(892, 180, true), true);
eq(up(892, 360, true), false);

// A width never seen without the keyboard up has nothing to count from.
up = watch();
eq(up(412, 572, true), false);

// The height without the keyboard is what the form factor reads: a landscape tablet keeps its
// own while typing, rotated or not, and a split screen changes it.
let read = keyboardWatch();
eq(read(1280, 800, false).height, 800);
eq(read(1280, 800, true).height, 800);
eq(read(1280, 450, true).height, 800);
eq(read(1280, 450, false).height, 800);
eq(read(1280, 800, false).height, 800);
read = keyboardWatch();
eq(read(800, 1280, true).height, 1280);
eq(read(800, 830, true).height, 1280);
eq(read(1280, 430, true).height, 800);
read = keyboardWatch();
eq(read(1280, 800, false).height, 800);
eq(read(1280, 390, false).height, 390);
eq(read(640, 800, false).height, 800);

// Only a few widths are kept: a window dragged wide and narrow does not pile them up.
read = keyboardWatch();
eq(read(400, 900, false).height, 900);
for (let w = 401; w < 1400; w++) read(w, 900, false);
eq(read(400, 600, true).height, 600);

console.log("keyboard-check: ok");
