// In-page bench driver: the same script in every engine, no WebDriver or CDP in the loop.
// Reads window.__BENCH = { scenario, collector }, plays its phases and posts a mark at each
// phase boundary; the runner samples the process tree's CPU at each mark.
(() => {
	const cfg = window.__BENCH;
	if (!cfg || window.top !== window) return;
	const post = (body) =>
		fetch(cfg.collector + "/mark", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "text/plain" } }).catch(() => {});
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const until = async (fn, ms = 20000) => {
		const t0 = performance.now();
		while (performance.now() - t0 < ms) {
			const v = fn();
			if (v) return v;
			await sleep(100);
		}
		return null;
	};
	// SvelteKit routes a click on any <a>: a throwaway link keeps navigation client-side.
	const go = (path) => {
		const a = document.createElement("a");
		a.href = path;
		document.body.appendChild(a);
		a.click();
		a.remove();
	};
	const scroller = () => {
		const cands = [...document.querySelectorAll("*")].filter((el) => {
			const s = getComputedStyle(el);
			return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 50;
		});
		cands.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
		return cands[0] ?? document.scrollingElement;
	};
	// Frame stats: rAF only while a phase asks for it, so idle phases keep the engine's frame clock quiet.
	const frames = () => {
		let n = 0;
		let long = 0;
		let worst = 0;
		let last = performance.now();
		let on = true;
		const tick = (t) => {
			const dt = t - last;
			last = t;
			n++;
			if (dt > 34) long++;
			if (dt > worst) worst = dt;
			if (on) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		return () => {
			on = false;
			return { frames: n, long, worst: Math.round(worst) };
		};
	};
	const dom = () => ({ path: location.pathname, hero: !!document.querySelector(".hero"), imgs: [...document.images].filter((i) => i.complete && i.naturalWidth).length, hidden: document.hidden, vis: document.visibilityState, text: (document.body?.innerText ?? "").slice(0, 80).replace(/\s+/g, " ") });
	const phase = async (name, ms, body, { measureFrames = true } = {}) => {
		await post({ ev: "start", phase: name, dom: dom() });
		const t0 = performance.now();
		const stop = measureFrames ? frames() : () => ({});
		await body(t0 + ms);
		const f = stop();
		const dur = performance.now() - t0;
		await post({ ev: "end", phase: name, ms: Math.round(dur), ...f, fps: f.frames ? +(f.frames / (dur / 1000)).toFixed(1) : undefined });
	};
	const idle = (end) => sleep(end - performance.now());
	// Scroll a pixel distance per frame down to the bottom, then back up, until the phase ends.
	const scrollLoop = (getEl, step = 14) => (end) =>
		new Promise((resolve) => {
			let dir = 1;
			const f = () => {
				const el = getEl();
				if (performance.now() >= end) return resolve();
				if (el) {
					el.scrollTop += dir * step;
					if (dir > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) dir = -1;
					if (dir < 0 && el.scrollTop <= 0) dir = 1;
				}
				requestAnimationFrame(f);
			};
			f();
		});
	const move = (x, y) => {
		for (const t of ["pointermove", "mousemove"]) {
			const el = document.elementFromPoint(x, y) ?? document.body;
			el.dispatchEvent(new (t === "pointermove" ? PointerEvent : MouseEvent)(t, { bubbles: true, clientX: x, clientY: y }));
		}
	};

	const scenarios = {
		async nav() {
			await until(() => document.querySelector(".hero"));
			await sleep(3000);
			await phase("home-idle", 20000, idle, { measureFrames: false });
			await phase("home-scroll", 15000, scrollLoop(() => document.querySelector(".hero")?.closest(".content") ?? scroller()));
			document.querySelector(".hero")?.closest(".content")?.scrollTo(0, 0);
			go("/library/movies");
			await until(() => document.querySelector(".library"));
			await sleep(2000);
			await phase("library-scroll", 15000, scrollLoop(scroller));
			await phase("detail-cycle", 24000, async (end) => {
				let i = 0;
				while (performance.now() < end - 2500) {
					const id = (i++ % 17) + 1;
					go(`/detail/movies/${id}`);
					await sleep(1600);
					history.back();
					await sleep(900);
				}
				await idle(end);
			});
			go("/search");
			const input = await until(() => document.querySelector("input"));
			await sleep(1000);
			await phase("search-type", 12000, async (end) => {
				const words = ["dune", "matrix", "arrival", "sev", "gladiator", "the"];
				let w = 0;
				while (performance.now() < end) {
					const word = words[w++ % words.length];
					for (let k = 1; k <= word.length && performance.now() < end; k++) {
						input.value = word.slice(0, k);
						input.dispatchEvent(new Event("input", { bubbles: true }));
						await sleep(180);
					}
					await sleep(700);
				}
			});
		},
		async player() {
			window.__picture = true;
			window.__fakeTick = true;
			window.__fakeDuration = 3000;
			window.__tracks = {
				chapters: [
					{ start: 0, end: 300, title: "Cold open" },
					{ start: 300, end: 1500, title: "The first act" },
					{ start: 1500, end: 2700, title: "The second act" },
					{ start: 2700, end: 3000, title: "Aftermath" },
				],
				preparing: false,
				trickplay: null,
				subtitles: [],
				markers: { intro: [30, 75], credits: [2940, 3000] },
			};
			await until(() => document.querySelector(".hero"));
			await sleep(1500);
			go("/player/movies/1");
			await until(() => window.__fake?.p.playing && window.__fake.p.dur > 0);
			await sleep(2000);
			await phase("player-controls", 15000, async (end) => {
				let k = 0;
				while (performance.now() < end) {
					move(600 + (k % 2) * 20, 420);
					k++;
					await sleep(500);
				}
			});
			await sleep(4000);
			await phase("player-watching", 25000, idle, { measureFrames: false });
			await phase("player-scrub", 15000, async (end) => {
				const track = document.querySelector(".scrub");
				let k = 0;
				while (performance.now() < end) {
					const r = track?.getBoundingClientRect();
					if (r) move(r.x + r.width * ((k % 40) / 40), r.y + r.height / 2);
					else move(600, 420);
					k++;
					await sleep(120);
				}
			});
		},
	};

	const run = async () => {
		const gl = (() => { try { const c = document.createElement("canvas").getContext("webgl"); if (!c) return "no webgl"; const e = c.getExtension("WEBGL_debug_renderer_info"); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER); } catch (e) { return "err " + e; } })();
		await post({ ev: "ready", gl, dpr: devicePixelRatio, ua: navigator.userAgent, url: location.href, pre: window.__benchPre, shimActive: !!window.__fake, internals: Object.keys(window.__TAURI_INTERNALS__ || {}).slice(0, 12) });
		try {
			await scenarios[cfg.scenario]();
			await post({ ev: "done" });
		} catch (e) {
			await post({ ev: "error", message: String(e?.stack ?? e) });
		}
	};
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
	else run();
})();
