process.env.TZ = "America/Los_Angeles";
// node dev/activity-view-check.ts
import { strictEqual as eq, deepStrictEqual as same } from "node:assert";
import { must } from "./must.ts";
import {
	bellLabel,
	FILTERS,
	feedView,
	groupOf,
	matches,
	rowOf,
	timeLabel,
	type Words,
} from "../src/lib/core/activity-view.ts";
import type { ActivityEvent, Title } from "../src/lib/core/types.ts";

const now = new Date(2026, 10, 9, 12, 0);
const local = (m: number, d: number, h = 12, min = 0) => new Date(2026, m - 1, d, h, min);

same(FILTERS, ["all", "library", "downloads", "system"]);
eq(matches("episodes", "library"), true);
eq(matches("download", "library"), false);
eq(matches("scan", "system"), true);

eq(groupOf(local(11, 9, 0, 5), now), "today");
eq(groupOf(local(11, 8, 23, 50), now), "yesterday");
eq(groupOf(local(11, 7), now), "week");
eq(groupOf(local(11, 3), now), "week");
eq(groupOf(local(11, 2), now), "earlier");

eq(timeLabel(local(11, 9, 14, 2), now, "en"), "14:02");
eq(timeLabel(local(11, 8, 23, 50), now, "en"), "23:50");
eq(timeLabel(local(11, 5), now, "en"), "Thu");
eq(timeLabel(local(11, 2), now, "en"), "2 Nov");

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const words: Words = {
	groups: { today: "Today", yesterday: "Yesterday", week: "This week", earlier: "Earlier" },
	newEpisodes: (n) => (n === 1 ? "New episode" : `${n} new episodes`),
	episodesReady: (s, list, n) => `S${s} · ${list} ${n === 1 ? "is" : "are"} ready to watch`,
	seasonAdded: (s) => `Season ${s} added`,
	episodeCount: (n) => plural(n, "1 episode", `${n} episodes`),
	movieAdded: "Added to Movies",
	upgraded: (k) => (k ? "Upgraded to 4K" : "Upgraded to 1080p"),
	replaced: (p, q) => `Replaced the ${p} copy with ${q}`,
	downloadFinished: "Download finished",
	downloadedEpisode: (s, e) => `S${s} · E${e} is on this device`,
	downloadedMovie: "On this device",
	deviceSignedIn: "New device signed in",
	serverUpdated: "Server updated",
	serverText: (v, s) => `Streamline Server ${v}${s === undefined ? "" : ` · restarted in ${s} s`}`,
	scanFinished: "Library scan finished",
	scanText: (a, u, e) =>
		`${plural(a, "1 new title", `${a} new titles`)} · ${u} upgraded · ${plural(e, "1 error", `${e} errors`)}`,
	unread: (n) => `${n} unread`,
	caughtUp: "All caught up",
	bell: (n) => `Activity, ${n} unread`,
	bellPlain: "Activity",
};

const library: Title[] = [
	{ id: 1, title: "Severance" },
	{ id: 2, title: "Shōgun" },
	{ id: 3, title: "The Last of Us" },
].map((t) => ({ ...t }) as Title);
const movies = [2, 3, 4, 6].map((id) => ({ id, title: `Movie ${id}` }) as Title);
const find = (kind: string, id: number) =>
	(kind === "series" ? library : movies).find((t) => t.id === id);

const at = (min: number) => new Date(now.getTime() - min * 60000).toISOString();
const ev = (
	e: Partial<ActivityEvent> & Pick<ActivityEvent, "id" | "kind">,
	min: number,
	read = true,
) => ({ at: at(min), read, ...e }) as ActivityEvent;
const a1 = ev(
	{ id: "a1", kind: "episodes", title: { kind: "series", id: 1 }, season: 2, episodes: [8, 9] },
	10,
	false,
);
const a2 = ev(
	{ id: "a2", kind: "download", title: { kind: "series", id: 2 }, season: 1, episodes: [10] },
	52,
	false,
);
const a4 = ev(
	{
		id: "a4",
		kind: "movie",
		title: { kind: "movies", id: 2 },
		file: { resolution: "2160p", hdr: "HDR10", audio: "Atmos" },
	},
	145,
);
const a3 = ev(
	{
		id: "a3",
		kind: "upgrade",
		title: { kind: "movies", id: 3 },
		file: { resolution: "2160p", hdr: "Dolby Vision" },
		previous: { resolution: "1080p" },
	},
	345,
	false,
);
const a7 = ev(
	{
		id: "a7",
		kind: "movie",
		title: { kind: "movies", id: 4 },
		file: { resolution: "1080p", audio: "EAC3", channels: "5.1" },
	},
	870,
);
const a5 = ev(
	{
		id: "a5",
		kind: "device",
		device: { name: "iPhone 16 Pro", platform: "ios", location: "Lyon, France" },
	},
	1020,
);
const a6 = ev(
	{ id: "a6", kind: "season", title: { kind: "series", id: 2 }, season: 1, episode_count: 10 },
	1140,
);
const a8 = ev(
	{ id: "a8", kind: "server", server: { version: "2.4.1", restart_seconds: 12 } },
	1980,
);
const a9 = ev(
	{
		id: "a9",
		kind: "movie",
		title: { kind: "movies", id: 6 },
		file: { resolution: "2160p", hdr: "Dolby Vision" },
	},
	5760,
);
const a10 = ev(
	{ id: "a10", kind: "season", title: { kind: "series", id: 3 }, season: 1, episode_count: 8 },
	7200,
);
const a11 = ev({ id: "a11", kind: "scan", scan: { added: 4, upgraded: 2, errors: 0 } }, 8640);
const all = [a1, a2, a4, a3, a7, a5, a6, a8, a9, a10, a11];
const row = (e: ActivityEvent, f = find) => rowOf(e, f, now, "en", words);

const r1 = row(a1);
eq(r1.head, "2 new episodes");
eq(r1.name, "Severance");
eq(r1.text, "S2 · E8–E9 are ready to watch");
eq(r1.badge, "plus");
eq(r1.badgeTone, "accent");
same(r1.open, { to: "detail", kind: "series", id: 1, season: 2 });
eq(r1.unread, true);

const r3 = row(a3);
eq(r3.head, "Upgraded to 4K");
eq(r3.text, "Replaced the 1080p copy with 2160p · Dolby Vision");
eq(r3.badge, "sparkles");
eq(r3.badgeTone, "warning");
eq(row(a4).head, "Added to Movies");
eq(row(a4).text, "2160p · HDR10 · Atmos");
eq(row(a7).text, "1080p · EAC3 5.1");
const r6 = row(a6);
eq(r6.head, "Season 1 added");
eq(r6.text, "10 episodes");
eq(r6.open?.to === "detail" && r6.open.season, undefined);
const r2 = row(a2);
eq(r2.head, "Download finished");
eq(r2.text, "S1 · E10 is on this device");
eq(r2.open?.to, "downloads");
eq(r2.badge, "arrow-down-to-line");
eq(r2.badgeTone, "available");
eq(row({ ...a2, episodes: undefined }).text, "On this device");

const r5 = row(a5);
eq(r5.head, "New device signed in");
eq(r5.text, "iPhone 16 Pro · Lyon, France");
eq(r5.icon, "smartphone");
eq(r5.poster, null);
eq(r5.open, null);
eq(row({ ...a5, device: { name: "iPhone 16 Pro", platform: "ios" } }).text, "iPhone 16 Pro");
eq(row({ ...a5, device: { name: "Den", platform: "tvos" } }).icon, "tv");
eq(row({ ...a5, device: { name: "Firefox", platform: "web" } }).icon, "globe");
eq(row({ ...a5, device: { name: "PC", platform: "linux" } }).icon, "monitor");
const r8 = row(a8);
eq(r8.head, "Server updated");
eq(r8.text, "Streamline Server 2.4.1 · restarted in 12 s");
eq(r8.icon, "server");
const r11 = row(a11);
eq(r11.head, "Library scan finished");
eq(r11.text, "4 new titles · 2 upgraded · 0 errors");
eq(r11.icon, "refresh-cw");

const one = row({ ...a1, episodes: [8] });
eq(one.head, "New episode");
eq(one.text, "S2 · E8 is ready to watch");
eq(row({ ...a1, episodes: [8, 10] }).text, "S2 · E8, E10 are ready to watch");

const gone = row(a1, () => undefined);
eq(gone.poster, null);
eq(gone.name, "");
eq(gone.icon, "bell");
eq(gone.badge, null);
eq(gone.open, null);
eq(gone.head, "2 new episodes");
eq(gone.text, "S2 · E8–E9 are ready to watch");

const view = (events: ActivityEvent[], f: Parameters<typeof feedView>[1]) =>
	feedView(events, f, find, now, "en", words);
const full = view(all, "all");
same(
	full.groups.map((g) => [g.group, g.label, g.rows.length]),
	[
		["today", "Today", 4],
		["yesterday", "Yesterday", 4],
		["week", "This week", 3],
	],
);
eq(full.unread, 3);
eq(full.summary, "3 unread");
eq(full.empty, false);
for (const [f, n] of [
	["library", 7],
	["downloads", 1],
	["system", 3],
] as const) {
	const v = view(all, f);
	eq(
		v.groups.reduce((s, g) => s + g.rows.length, 0),
		n,
		f,
	);
	eq(v.unread, 3);
}

const noDownloads = view(
	all.filter((e) => e.id !== "a2"),
	"downloads",
);
eq(noDownloads.empty, true);
same(noDownloads.groups, []);
eq(noDownloads.unread, 2);
eq(noDownloads.summary, "2 unread");

eq(
	view(
		all.map((e) => ({ ...e, read: true })),
		"all",
	).summary,
	"All caught up",
);
eq(bellLabel(3, words), "Activity, 3 unread");
eq(bellLabel(0, words), "Activity");

const west = view(
	[ev({ id: "x", kind: "scan", scan: { added: 0, upgraded: 0, errors: 0 } }, 0)],
	"all",
);
eq(must(west.groups[0]).group, "today");
const late = { ...a11, at: local(11, 8, 23, 50).toISOString() };
const lateView = view([late], "all");
eq(must(lateView.groups[0]).group, "yesterday");
eq(must(must(lateView.groups[0]).rows[0]).at, "23:50");
const earlier = view([{ ...a11, at: local(11, 2).toISOString() }], "all");
eq(must(earlier.groups[0]).label, "Earlier");

console.log("activity-view-check: ok");
