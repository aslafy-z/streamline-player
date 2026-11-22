// node dev/keyboard-check.ts
import { strictEqual as eq } from "node:assert";
import { KEYBOARD_MIN_PX, keyboardWatch } from "../src/lib/platform/keyboard.ts";

// Focus, then the keyboard comes up and goes down again (Back, the field still focused).
let up = keyboardWatch();
eq(up(412, 892, false), false);
eq(up(412, 892, true), false);
eq(up(412, 572, true), true);
eq(up(412, 892, true), false);
eq(up(412, 572, true), true);
eq(up(412, 892, false), false);

// The browser's bars coming and going are no keyboard.
up = keyboardWatch();
eq(up(412, 892, true), false);
eq(up(412, 892 - KEYBOARD_MIN_PX + 1, true), false);
eq(up(412, 892 - KEYBOARD_MIN_PX, true), true);

// Shrunk without focus (a split screen), then focus: the keyboard counts from the new height.
up = keyboardWatch();
eq(up(412, 892, false), false);
eq(up(412, 440, false), false);
eq(up(412, 440, true), false);
eq(up(412, 200, true), true);

// A rotation with the keyboard up finds the height that width had without it.
up = keyboardWatch();
eq(up(892, 412, false), false);
eq(up(412, 892, false), false);
eq(up(412, 892, true), false);
eq(up(412, 572, true), true);
eq(up(892, 180, true), true);
eq(up(412, 572, true), true);
eq(up(412, 892, true), false);

// A width never seen without the keyboard has nothing to count from.
up = keyboardWatch();
eq(up(412, 572, true), false);

console.log("keyboard-check: ok");
