import { strictEqual as eq, ok } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HomeFeed, Me, Title } from "../../src/lib/core/types.ts";
import { kind, startTarget, violationLines } from "./target.ts";

type ApiError = { error: { code: string } };

const NOW = "1794225600";
const REASONS = ["continue", "next", "new_episodes", "added"];
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(1024 - 8)]);

const dir = mkdtempSync(join(tmpdir(), "browse-check-"));
mkdirSync(join(dir, "art", "p"), { recursive: true });
writeFileSync(join(dir, "art", "p", "dune2.jpg"), PNG);

const stops: (() => void)[] = [];
try {
	const full = await startTarget(
		"full",
		kind === "mock" ? ["--clip", "/nonexistent.mkv", "--now", NOW, "--art", join(dir, "art")] : [],
	);
	stops.push(full.stop);
	const api = full.api;
	const auth = { Authorization: `Bearer ${await full.signIn()}` };
	const call = (path: string, init: RequestInit = {}) =>
		fetch(`${api}${path}`, { ...init, headers: { ...auth, ...(init.headers as object) } });
	const json = <T>(path: string, init?: RequestInit) =>
		call(path, init).then((r) => r.json() as Promise<T>);
	const put = (body: Buffer, type: string) =>
		call("/me/picture", { method: "PUT", headers: { "Content-Type": type }, body });

	const home = await json<HomeFeed>("/home");
	if (kind === "mock") eq(home.featured.length, 3);
	for (const f of home.featured) ok(REASONS.includes(f.reason), f.reason);
	ok(home.arrivals.length > 0);
	const days = home.arrivals.map((d) => d.date);
	eq(days.join(), [...days].sort().reverse().join());
	for (const day of home.arrivals) ok(day.items.length > 0);

	const profile = await json<Me>("/me");
	eq(profile.role, "Admin");
	ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(profile.streamline_url), profile.streamline_url);

	await call("/me/picture", { method: "DELETE" });
	eq((await json<Me>("/me")).picture, false);
	eq((await put(PNG, "image/png")).status, 204);
	const me = await json<Me>("/me");
	eq(me.picture, true);
	ok(/^[A-Z]{1,2}$/.test(me.initials), me.initials);
	eq((await call("/posters/users/me/photo.jpg")).status, 200);
	eq((await fetch(`${api}/posters/users/me/photo.jpg`)).status, 401);
	const big = await put(Buffer.alloc(768 * 1024), "image/png");
	eq(big.status, 413);
	eq(((await big.json()) as Partial<ApiError>).error?.code, "too_large");
	eq((await put(Buffer.concat([Buffer.from("GIF89a"), PNG]), "image/gif")).status, 415);
	eq((await call("/me/picture", { method: "DELETE" })).status, 204);
	eq((await json<Me>("/me")).picture, false);
	eq((await call("/posters/users/me/photo.jpg")).status, 404);

	const poster = "/posters/movies/1/poster.jpg";
	if (full.mock) {
		const mock = (path: string) => fetch(`${full.mock}${path}`, { method: "POST" });
		eq((await call(poster)).status, 200);
		eq((await mock("/dev/art/off")).status, 204);
		eq((await call(poster)).status, 404);
		eq((await mock("/dev/art/on")).status, 204);
	}
	// The stack serves the artwork folder it booted with, which the contract task fills (CONTRACT_ART).
	if (full.mock || process.env.CONTRACT_ART) eq((await call(poster)).status, 200);
	else eq([200, 404].includes((await call(poster)).status), true);

	const files = (await json<{ items: Title[] }>("/movies")).items;
	ok(files.every((m) => m.file_summary.size > 0));

	const lines = await violationLines(full);
	eq(lines.length, 0, lines.join("\n"));

	// An empty library is a mock flag; the stack boots on one library.
	if (kind === "mock") {
		const empty = await startTarget("empty", [
			"--clip",
			"/nonexistent.mkv",
			"--now",
			NOW,
			"--empty",
		]);
		stops.push(empty.stop);
		const emptyApi = empty.api;
		const emptyAuth = { Authorization: `Bearer ${await empty.signIn()}` };
		const feed = await fetch(`${emptyApi}/home`, { headers: emptyAuth }).then(
			(r) => r.json() as Promise<HomeFeed>,
		);
		eq(feed.featured.length, 0);
		eq(feed.arrivals.length, 0);
		eq(
			(
				await fetch(`${emptyApi}/movies`, { headers: emptyAuth }).then(
					(r) => r.json() as Promise<{ items: Title[] }>,
				)
			).items.length,
			0,
		);
		const emptyLines = await violationLines(empty);
		eq(emptyLines.length, 0, emptyLines.join("\n"));
	}

	console.log("browse-check: ok");
} finally {
	for (const stop of stops) stop();
}
