// The activity feed and its read state, through the contract proxy.
import { strictEqual as eq, ok } from "node:assert";
import type { ActivityEvent, ActivityKind } from "../../src/lib/core/types.ts";
import { kind, startTarget, violationLines, type Target } from "./target.ts";

type ApiError = { error: { code: string } };

const KINDS: ActivityKind[] = [
	"episodes",
	"season",
	"movie",
	"upgrade",
	"download",
	"device",
	"server",
	"scan",
];
const stops: (() => void)[] = [];
// A target and the credential its calls carry.
async function start(name: string, ...extra: string[]) {
	const t = await startTarget(name, ["--now", "1794225600", ...extra]);
	stops.push(t.stop);
	return { t, auth: { Authorization: `Bearer ${await t.signIn()}` } };
}
type Started = Awaited<ReturnType<typeof start>>;

const JSON_HEADERS = { "Content-Type": "application/json" };
const feed = async ({ t, auth }: Started) => {
	const r = await fetch(`${t.api}/activity`, { headers: auth });
	eq(r.status, 200);
	return ((await r.json()) as { items: ActivityEvent[] }).items;
};
const read = ({ t, auth }: Started, body: unknown) =>
	fetch(`${t.api}/activity/read`, {
		method: "POST",
		headers: { ...JSON_HEADERS, ...auth },
		body: JSON.stringify(body),
	});

const clean = async (t: Target) => {
	const lines = await violationLines(t);
	eq(lines.length, 0, lines.join("\n"));
};

try {
	if (kind === "mock") {
		const demo = await start("demo", "--demo-activity");
		const items = await feed(demo);
		eq(items.length, 11);
		eq(items[0].id, "a1");
		for (let i = 1; i < items.length; i++)
			ok(items[i - 1].at > items[i].at, `${items[i].id} is older`);
		eq(
			items
				.filter((e) => !e.read)
				.map((e) => e.id)
				.join(),
			"a1,a2,a3",
		);

		eq((await read(demo, { ids: ["a1", "nope"] })).status, 204);
		eq((await feed(demo)).filter((e) => !e.read).length, 2);
		await clean(demo.t);

		const lean = await start("lean", "--demo-activity=no-downloads");
		const leanItems = await feed(lean);
		eq(leanItems.length, 10);
		ok(leanItems.every((e) => e.kind !== "download"));
		await clean(lean.t);

		const empty = await start("empty", "--empty");
		eq((await feed(empty)).length, 0);
		await clean(empty.t);
	}

	// The proxy rightly reports these requests as breaking the contract, so they go to a proxy of their own.
	const bad = await start("bad");
	for (const body of [{}, { ids: [] }]) {
		const r = await read(bad, body);
		eq(r.status, 400);
		eq(((await r.json()) as ApiError).error.code, "invalid_request");
	}

	const plain = await start("plain");
	const derived = await feed(plain);
	for (const e of derived) ok(KINDS.includes(e.kind), e.kind);
	if (kind === "mock") {
		ok(derived.length > 0);
		for (const e of derived) {
			eq(e.read, true);
			ok(e.kind === "movie" || e.kind === "season", e.kind);
		}
	} else {
		// The first comparison (admin-check's scan) only records the library that was already there: no arrival is announced.
		// Downloads are device-scoped, so their feed and read marks are checked by downloads-api-check.
		const arrivals = derived.filter((e) => e.kind !== "download");
		eq(arrivals.length, 0, JSON.stringify(arrivals));
	}
	await clean(plain.t);

	console.log("activity-check: ok");
} finally {
	for (const stop of stops) stop();
}
