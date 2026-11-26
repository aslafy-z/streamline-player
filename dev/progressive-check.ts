// node --import ./dev/controller-check/register.mjs dev/progressive-check.ts
import { deepStrictEqual as same, strictEqual as eq } from "node:assert";

const { fits, nextStep, restHeight, viewRange } = await import(
	"../src/lib/ui/progressive.svelte.ts"
);

same(viewRange(157, 1000, 0, 6, 700, 1), { from: 0, to: 6 });
same(viewRange(157, 1000, 419.25, 6, 700, 1), { from: 0, to: 24 });
same(viewRange(-19843, 1000, 419.25, 6, 700, 1), { from: 276, to: 306 });
same(viewRange(-48100, 1000, 419.25, 6, 700, 1), { from: 678, to: 700 });
same(viewRange(1200, 1000, 400, 6, 700, 1), { from: 0, to: 6 });
same(viewRange(157, 1000, 65, 1, 3, 1), { from: 0, to: 3 });

const done = new Set([0, 1, 2, 5, 40, 41]);
const real = (i: number) => done.has(i);
const view = { from: 38, to: 44 };
const near = { from: 34, to: 48 };
same(nextStep(real, 100, 10, view, near, 240, 3), { urgent: true, draw: 34 });
same(nextStep(real, 100, 10, view, near, 20, 3), { urgent: true, draw: 20 });
same(nextStep(real, 100, 50, view, near, 240, 3), { urgent: true, real: [38, 39, 42] });
same(nextStep(real, 100, 50, { from: 40, to: 42 }, near, 240, 3), { urgent: true, draw: 50 });
same(nextStep(real, 100, 100, { from: 40, to: 42 }, near, 240, 4), {
	urgent: false,
	real: [34, 35, 36, 37],
});
eq(
	nextStep(() => true, 100, 100, view, near, 240, 4),
	null,
);

eq(restHeight(700, 1, 6, 419.25), 116 * 419.25);
eq(restHeight(700, 700, 6, 419.25), 0);
eq(restHeight(700, 900, 6, 419.25), 0);
eq(restHeight(700, 1, 6, 0), 0);

eq(fits(8, 0, 6), 6);
eq(fits(8, 1.5, 6), 5);
eq(fits(24, 1.5, 6), 16);
eq(fits(8, 40, 6), 1);
