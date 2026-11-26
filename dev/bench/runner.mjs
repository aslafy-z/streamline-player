// One bench run: node dev/bench/runner.mjs --name <variant> --bin <app> --scenario nav|player
//   [--reduce] [--soft] [--out file.json] [--timeout s] [--url page] [--hook phase:command]
// Starts the bench app on the served desktop build with the compare shim and driver.js as its
// init script, and samples the CPU and PSS of the app's whole process tree (and of the display
// server, COMPOSITOR) at each mark the driver posts. SHOT=<dir> also grabs an X11 screenshot at
// each phase start. --hook runs `command <app pid> <out without .json>.<phase>` when that phase
// starts (profile.sh: threads and perf over the phase).
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";

const arg = (k, d) => {
	const i = process.argv.indexOf(`--${k}`);
	return i < 0 ? d : process.argv[i + 1];
};
const OUT = process.env.BENCH_OUT ?? "/tmp/streamline-bench";
const name = arg("name");
const bin = arg("bin");
const scenario = arg("scenario", "nav");
const reduce = process.argv.includes("--reduce");
const soft = process.argv.includes("--soft");
const out = arg("out", `${OUT}/results/${name}-${scenario}.json`);
const [hookPhase, hookCmd] = (arg("hook", "") ?? "").split(/:(.*)/);
const PORT = 8200;
const HZ = 100;

// --reduce: every animation and transition off, and prefers-reduced-motion reported as set, so
// the components' own reduced-motion paths run too. The upper bound of what cutting motion buys.
const REDUCE = `(() => {
	const mm = window.matchMedia.bind(window);
	window.matchMedia = (q) => /prefers-reduced-motion\\s*:\\s*reduce/.test(q)
		? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } }
		: mm(q);
	const css = "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}";
	const add = () => { const s = document.createElement("style"); s.textContent = css; (document.head ?? document.documentElement).appendChild(s); };
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add, { once: true }); else add();
})();`;
// Tauri defines __TAURI_INTERNALS__ non-writable and frozen, so the shim cannot replace it. The
// served build has every __TAURI_ renamed __BENCHT_ (stack.sh), and so does the shim here: the
// page talks to the shim only, whatever runtime hosts it.
const shim = readFileSync(new URL("../compare/shim.js", import.meta.url), "utf8").replaceAll(
	"__TAURI_",
	"__BENCHT_",
);
const init = [
	`window.__BENCH = ${JSON.stringify({ scenario, collector: `http://127.0.0.1:${PORT}` })};`,
	reduce ? REDUCE : "",
	// --soft: the shim answers the app's software_rendering command with true, as the real app
	// does on a machine without a GPU, which is what this bench runs on.
	soft ? "window.__softwareRendering = true;" : "",
	shim,
	readFileSync(new URL("./driver.js", import.meta.url), "utf8"),
]
	.map(
		(src, i) =>
			`try {\n${src}\n} catch (e) { fetch("http://127.0.0.1:${PORT}/mark", { method: "POST", body: JSON.stringify({ ev: "initerr", part: ${i}, message: String(e && e.stack || e) }) }); }`,
	)
	.join("\n");
mkdirSync(`${OUT}/init`, { recursive: true });
mkdirSync(dirname(out), { recursive: true });
const initPath = `${OUT}/init/${name}-${scenario}.js`;
writeFileSync(initPath, init);

const stat = (pid) => {
	try {
		const s = readFileSync(`/proc/${pid}/stat`, "utf8");
		const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
		// utime + stime + cutime + cstime: a reaped child's time moves into its parent's.
		return {
			ppid: +f[1],
			cpu: +f[11] + +f[12] + +f[13] + +f[14],
			comm: s.slice(s.indexOf("(") + 1, s.lastIndexOf(")")),
		};
	} catch {
		return null;
	}
};
const pss = (pid) => {
	try {
		return +(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8").match(/^Pss:\s+(\d+)/m)?.[1] ?? 0);
	} catch {
		return 0;
	}
};
const pids = () => readdirSync("/proc").filter((d) => /^\d+$/.test(d));
const tree = (root) => {
	const all = pids()
		.map((d) => [+d, stat(d)])
		.filter(([, s]) => s);
	const kids = new Map();
	for (const [pid, s] of all) {
		if (!kids.has(s.ppid)) kids.set(s.ppid, []);
		kids.get(s.ppid).push(pid);
	}
	const by = new Map(all);
	const found = [];
	const walk = (p) => {
		if (by.has(p)) found.push({ pid: p, ...by.get(p) });
		for (const k of kids.get(p) ?? []) walk(k);
	};
	walk(root);
	return found;
};
// Every display-server process counts: Xvfb, or Weston plus the XWayland it spawns.
const compositor = new RegExp(`^(${process.env.COMPOSITOR ?? "Xvfb|weston|Xwayland"})$`);
const displayCpu = () =>
	pids().reduce((a, d) => {
		const s = stat(d);
		return s && compositor.test(s.comm) ? a + s.cpu : a;
	}, 0);
let child;
const sample = () => {
	const t = tree(child.pid);
	const byComm = {};
	for (const p of t) byComm[p.comm] = (byComm[p.comm] ?? 0) + p.cpu;
	return {
		at: performance.now(),
		cpu: t.reduce((a, p) => a + p.cpu, 0),
		x: displayCpu(),
		byComm,
		pss: t.reduce((a, p) => a + pss(p.pid), 0),
		procs: t.length,
	};
};
const pct = (ticks, wall) => +((ticks / HZ / wall) * 100).toFixed(1);

const result = { name, scenario, reduce, phases: [], errors: [] };
const open = new Map();
const log = [];
let server;
const finish = (why) => {
	if (result.end) return;
	result.end = why;
	result.app_log = log.join("").slice(-4000);
	writeFileSync(out, JSON.stringify(result, null, 2));
	console.log(`${name} ${scenario}: ${why}`);
	for (const p of result.phases)
		console.log(
			`  ${p.phase.padEnd(16)} cpu ${String(p.cpu_pct).padStart(6)}%  x ${String(p.x_pct).padStart(5)}%  fps ${p.fps ?? "-"}  long ${p.long ?? "-"}  pss ${p.pss_mb}MB`,
		);
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {}
	server.close();
	setTimeout(() => process.exit(0), 300);
};
const shot = (phase) => {
	if (!process.env.SHOT || !process.env.DISPLAY) return;
	mkdirSync(process.env.SHOT, { recursive: true });
	spawn("ffmpeg", [
		...["-y", "-v", "error", "-f", "x11grab", "-video_size", "1920x1080"],
		...["-i", process.env.DISPLAY, "-frames:v", "1"],
		`${process.env.SHOT}/${name}-${scenario}-${phase}.png`,
	]);
};
const onMark = (m) => {
	if (m.ev === "ready") {
		result.ua = m.ua;
		result.ready = m;
	} else if (m.ev === "start") {
		open.set(m.phase, sample());
		result.dom ??= {};
		result.dom[m.phase] = m.dom;
		shot(m.phase);
		if (hookCmd && m.phase === hookPhase)
			spawn(hookCmd, [String(child.pid), `${out.replace(/\.json$/, "")}.${m.phase}`], { stdio: "inherit" });
	} else if (m.ev === "end") {
		const a = open.get(m.phase);
		const b = sample();
		const wall = (b.at - a.at) / 1000;
		const byProcess = {};
		for (const k of Object.keys(b.byComm)) byProcess[k] = pct(b.byComm[k] - (a.byComm[k] ?? 0), wall);
		const { ev: _ev, phase, dom: _dom, ...rest } = m;
		result.phases.push({
			phase,
			wall_s: +wall.toFixed(1),
			cpu_pct: pct(b.cpu - a.cpu, wall),
			x_pct: pct(b.x - a.x, wall),
			by_process: byProcess,
			pss_mb: Math.round(b.pss / 1024),
			procs: b.procs,
			...rest,
		});
	} else if (m.ev === "error" || m.ev === "initerr") result.errors.push(m);
	else if (m.ev === "done") finish("done");
};
server = createServer((req, res) => {
	let body = "";
	req.on("data", (c) => {
		body += c;
	});
	req.on("end", () => {
		res
			.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*" })
			.end();
		if (req.method === "POST") onMark(JSON.parse(body || "{}"));
	});
});
server.listen(PORT, "127.0.0.1", () => {
	child = spawn(bin, [], {
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			BENCH_URL: arg("url", "http://127.0.0.1:1440/"),
			BENCH_INIT: initPath,
		},
	});
	child.stdout.on("data", (d) => log.push(String(d)));
	child.stderr.on("data", (d) => log.push(String(d)));
	child.on("exit", (code, signal) => finish(`app exited ${code ?? signal}`));
	setTimeout(() => finish("timeout"), +arg("timeout", "240") * 1000);
});
