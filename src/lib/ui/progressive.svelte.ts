import { flushSync, untrack } from "svelte";
import { SvelteSet } from "svelte/reactivity";

/** Indexes [from, to) of the items in rows `stride` px apart that meet a viewport `height` px tall, the list's top `top` px below the viewport's, plus `margin` rows each side. */
export function viewRange(
	top: number,
	height: number,
	stride: number,
	cols: number,
	total: number,
	margin: number,
) {
	if (stride <= 0) return { from: 0, to: Math.min(total, cols) };
	const first = Math.max(0, Math.floor(-top / stride) - margin);
	const last = Math.max(first, Math.ceil((height - top) / stride) + margin);
	return { from: Math.min(total, first * cols), to: Math.min(total, last * cols) };
}

type Range = { from: number; to: number };

export type Step = { urgent: boolean } & ({ draw: number } | { real: number[] });

/**
 * The next work on a list whose first `drawn` items are drawn, as skeletons or `real(i)`: skeletons
 * down to the end of `view`, then its skeletons made real, then skeletons for every item, then the
 * skeletons of `near`, the rows around the view, made real. `urgent` until every item is drawn, so
 * that the list is as tall as it will be and find-in-page sees every title, and while the viewport
 * shows skeletons. Draws at most `draws`, makes at most `reals` real.
 */
export function nextStep(
	real: (i: number) => boolean,
	total: number,
	drawn: number,
	view: Range,
	near: Range,
	draws: number,
	reals: number,
): Step | null {
	if (drawn < view.to) return { urgent: true, draw: Math.min(view.to - drawn, draws) };
	const inView = pick(real, view.from, view.to, reals);
	if (inView.length) return { urgent: true, real: inView };
	if (drawn < total) return { urgent: true, draw: Math.min(total - drawn, draws) };
	const around = pick(real, near.from, near.to, reals);
	return around.length ? { urgent: false, real: around } : null;
}

function pick(real: (i: number) => boolean, from: number, to: number, max: number) {
	const picked: number[] = [];
	for (let i = from; i < to && picked.length < max; i++) if (!real(i)) picked.push(i);
	return picked;
}

/** Height of the rows of `total` items not drawn yet, `drawn` drawn in rows of `cols`. */
export const restHeight = (total: number, drawn: number, cols: number, stride: number) =>
	(Math.ceil(total / cols) - Math.ceil(Math.min(drawn, total) / cols)) * stride;

/** How many items fit in `budget` ms at `each` ms apiece; `first` while that is unmeasured. */
export const fits = (budget: number, each: number, first: number) =>
	each > 0 ? Math.max(1, Math.floor(budget / each)) : first;

const BUDGET_MS = 8;
// For what must not wait several frames at 8 ms a frame: see `nextStep`.
const URGENT_BUDGET_MS = 24;
const MARGIN_ROWS = 1;
// Real ahead of the scroll, so that skeletons seldom reach the viewport.
const NEAR_ROWS = 3;
// Real items cost the webview on every frame it draws, on screen or not (WebKitGTK walks the
// layers of the whole page), so those beyond this go back to skeletons. Wider than NEAR_ROWS:
// a small scroll back and forth swaps nothing.
const KEEP_ROWS = 8;
// Before their cost is measured: 700 skeletons take ~50 ms, so this many stay well inside a frame.
const FIRST_DRAW = 240;

// One chunk per frame. Chromium runs back-to-back `scheduler.yield` or MessageChannel tasks ahead of
// rendering, drawing a frame only every ~120 ms while the list mounts; WebKitGTK, the desktop
// webview, has neither `scheduler.yield` nor `requestIdleCallback`.
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Draws a long list a little at a time: skeletons, the same size as the items, then the real items
 * for the rows in and around the viewport, wherever it scrolls to, within a time budget per frame. The list element, given to `track`, lays out `items()` in rows of
 * equal height (a CSS grid, or one per line), draws the first `drawn` of them, real where
 * `real(id)`, and is padded by `after` px, the rows not drawn yet, so that its height and a restored
 * scroll position hold. A new `key()` starts over; a refresh, a filter or a sort keeps what is real.
 *
 * Apply `after` as `padding-bottom` itself, not through a custom property: custom properties
 * inherit, so every drawn item would be restyled on each step.
 */
export function progressive(items: () => { id: number }[], key: () => unknown) {
	const real = new SvelteSet<number>();
	const geo = $state({ cols: 1, stride: 0 });
	let drawn = $state(Math.min(items().length, 1));
	const restart = $derived(key());
	let node: HTMLElement | undefined;
	let run = 0;
	let pumping = false;

	function measure(el: HTMLElement) {
		const style = getComputedStyle(el);
		const tracks = style.gridTemplateColumns;
		const row = el.firstElementChild?.getBoundingClientRect().height ?? 0;
		geo.cols = tracks === "none" ? 1 : tracks.split(" ").length;
		geo.stride = row > 0 ? row + (Number.parseFloat(style.rowGap) || 0) : 0;
		return el.getBoundingClientRect().top;
	}

	async function pump() {
		const id = ++run;
		pumping = true;
		const cost = { draw: 0, real: 0 };
		let more = true;
		while (more) {
			await nextFrame();
			if (id !== run || !node) break;
			const list = items();
			const start = performance.now();
			const top = measure(node);
			const rows = (margin: number) =>
				viewRange(top, window.innerHeight, geo.stride, geo.cols, list.length, margin);
			const view = rows(MARGIN_ROWS);
			const near = rows(NEAR_ROWS);
			const keep = rows(KEEP_ROWS);
			const isReal = (i: number) => i < drawn && real.has(list[i]?.id ?? -1);
			// Outside the budget: a fast scroll spends all of it on the viewport, and what it left
			// behind would pile up and slow every frame.
			if (real.size > 0)
				for (let i = 0; i < drawn; i++)
					if (i < keep.from || i >= keep.to) real.delete(list[i]?.id ?? -1);
			while (true) {
				const next = nextStep(isReal, list.length, drawn, view, near, 1, 1);
				if (!next) {
					more = false;
					break;
				}
				const left = (next.urgent ? URGENT_BUDGET_MS : BUDGET_MS) - (performance.now() - start);
				if (left <= 0) break;
				const step = nextStep(
					isReal,
					list.length,
					drawn,
					view,
					near,
					fits(left, cost.draw, FIRST_DRAW),
					fits(left, cost.real, geo.cols),
				);
				if (!step) break;
				const at = performance.now();
				if ("draw" in step) drawn += step.draw;
				else for (const i of step.real) real.add(list[i]?.id ?? -1);
				flushSync();
				// Reads layout, so the cost per item includes it.
				node.getBoundingClientRect();
				const took = performance.now() - at;
				if ("draw" in step) cost.draw = took / step.draw;
				else cost.real = took / step.real.length;
			}
		}
		if (id === run) pumping = false;
	}

	let shownFor: unknown = {};
	$effect(() => {
		const list = restart;
		const count = items().length;
		untrack(() => {
			if (list !== shownFor) {
				shownFor = list;
				real.clear();
				drawn = Math.min(count, 1);
				pump();
			} else if (!pumping && count > 0) pump();
		});
	});
	$effect(() => () => {
		run++;
	});
	// The loop ends once the rows around the viewport are real; a scroll or a resize moves them.
	$effect(() => {
		const again = () => {
			if (!pumping && node) pump();
		};
		window.addEventListener("scroll", again, { capture: true, passive: true });
		window.addEventListener("resize", again, { passive: true });
		return () => {
			window.removeEventListener("scroll", again, { capture: true });
			window.removeEventListener("resize", again);
		};
	});

	return {
		get drawn() {
			return drawn;
		},
		real: (id: number) => real.has(id),
		get after() {
			return restHeight(items().length, drawn, geo.cols, geo.stride);
		},
		track: (el: HTMLElement) => {
			node = el;
			measure(el);
			return {
				destroy: () => {
					if (node === el) node = undefined;
				},
			};
		},
	};
}
