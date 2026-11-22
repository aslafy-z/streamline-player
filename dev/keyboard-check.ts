// node dev/keyboard-check.ts
import { strictEqual as eq } from "node:assert";
import { KEYBOARD_MIN_PX, keyboardWatch } from "../src/lib/platform/keyboard.ts";

const watch = () => {
	const read = keyboardWatch();
	return (w: number, height: number, typing: boolean) => read(w, height, typing).up;
};

// Focus, then the keyboard comes up and goes down again.
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

// A rotation with the keyboard up keeps it up, in an orientation seen before or not.
up = watch();
eq(up(412, 892, true), false);
eq(up(412, 572, true), true);
eq(up(892, 180, true), true);
eq(up(892, 412, true), false);
eq(up(892, 180, true), true);
eq(up(412, 572, true), true);
eq(up(412, 892, true), false);

// A rotation without the keyboard is no keyboard either way.
up = watch();
eq(up(412, 892, true), false);
eq(up(892, 412, true), false);
eq(up(412, 892, true), false);

// The height without the keyboard is the page's own: what the form factor reads.
const read = keyboardWatch();
eq(read(800, 1280, false).height, 1280);
eq(read(800, 1280, true).height, 1280);
eq(read(800, 930, true).height, 1280);
eq(read(800, 1250, true).height, 1250);
eq(read(800, 600, false).height, 600);

console.log("keyboard-check: ok");
