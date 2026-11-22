// Drives the TV app in the emulator like a remote: real D-pad key events through adb, with the
// WebView's DevTools (CDP, on :9222 once forwarded) only to read where the focus is.
//   node dev/android-tcg/remote.ts focus
//   node dev/android-tcg/remote.ts keys UP RIGHT CENTER BACK
//   node dev/android-tcg/remote.ts type "http://127.0.0.1:8081"    (the welcome screen's keyboard)
//   node dev/android-tcg/remote.ts eval "location.pathname"
import { execFileSync } from "node:child_process";

const ADB = `${process.env.ANDROID_HOME ?? `${process.env.HOME}/android-sdk`}/platform-tools/adb`;
const CODES: Record<string, number> = {
	UP: 19,
	DOWN: 20,
	LEFT: 21,
	RIGHT: 22,
	CENTER: 23,
	BACK: 4,
	PLAY_PAUSE: 85,
};
// The welcome screen's on-screen keyboard, row by row (src/lib/screens/tv/Welcome.svelte).
const ROWS = ["abcdefghij", "klmnopqrst", "uvwxyz1234", "567890.-:/"];

const press = (key: string) =>
	execFileSync(ADB, ["shell", "input", "keyevent", String(CODES[key] ?? key)]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Target = { type: string; url: string; webSocketDebuggerUrl: string };
const targets = (await (await fetch("http://127.0.0.1:9222/json")).json()) as Target[];
const page = targets.find((t) => t.type === "page" && t.url.startsWith("http://tauri.localhost"));
if (!page) {
	console.error("no app page on :9222: forward the WebView's devtools socket first (README)");
	process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let next = 0;
const pending = new Map<number, (v: unknown) => void>();
ws.onmessage = (m) => {
	const d = JSON.parse(String(m.data));
	pending.get(d.id)?.(d.result?.result?.value);
	pending.delete(d.id);
};
await new Promise((r) => {
	ws.onopen = r;
});
const evaluate = (expression: string) =>
	new Promise<unknown>((resolve) => {
		const id = ++next;
		pending.set(id, resolve);
		const params = { expression, returnByValue: true };
		ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params }));
	});
const focus = () =>
	evaluate(
		`(() => { const a = document.activeElement; return a && (a.getAttribute("aria-label") || a.textContent.trim()) })()`,
	) as Promise<string | null>;
// Under emulation a key press takes seconds to land: wait for the focus to move.
async function moved(before: string | null) {
	for (let i = 0; i < 60; i++) {
		const now = await focus();
		if (now !== before) return now;
		await sleep(500);
	}
	return focus();
}
function cell(c: string | null): [number, number] | null {
	for (const [r, row] of ROWS.entries()) {
		const x = c && c.length === 1 ? row.indexOf(c) : -1;
		if (x >= 0) return [r, x];
	}
	return null;
}

const [cmd = "", ...args] = process.argv.slice(2);
const text = args[0] ?? "";
if (cmd === "focus") console.log(await focus());
else if (cmd === "eval") console.log(JSON.stringify(await evaluate(text)));
else if (cmd === "keys") {
	for (const key of args) {
		const before = await focus();
		press(key);
		console.log(key, "->", await moved(before));
	}
} else if (cmd === "type") {
	let at = await focus();
	if (!cell(at)) {
		press("RIGHT");
		at = await moved(at);
	}
	for (const c of text) {
		const want = cell(c);
		if (!want) throw new Error(`${c} is not on the keyboard`);
		for (let i = 0; i < 20 && at !== c; i++) {
			const [r, x] = cell(at) ?? [4, 0];
			press(r !== want[0] ? (want[0] > r ? "DOWN" : "UP") : want[1] > x ? "RIGHT" : "LEFT");
			at = await moved(at);
		}
		if (at !== c) throw new Error(`could not reach ${c}; focus is on ${at}`);
		press("CENTER");
		await sleep(300);
		process.stdout.write(c);
	}
	console.log();
} else {
	console.error("usage: remote.ts focus | keys KEY... | type TEXT | eval EXPR");
	process.exit(2);
}
process.exit(0);
