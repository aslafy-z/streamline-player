import { stars, years } from "#lib/core/browse.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { getLocale } from "#lib/paraglide/runtime.js";
import { dateLocale } from "#lib/core/date-locale.ts";
import { prefs } from "#lib/core/prefs.svelte.ts";
import type { FileSummary, Kind, Title, Watch } from "#lib/core/types.ts";

/** Initials on a colour of its own, for people without a headshot (the design's monogram). */
export function monogram(name: string) {
	const [first = "", ...rest] = name.trim().split(/\s+/);
	let h = 0;
	for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
	const hue = h % 360;
	return {
		initials: (first.charAt(0) + (rest.at(-1) ?? "").charAt(0)).toUpperCase(),
		bg: `oklch(0.36 0.06 ${hue})`,
		fg: `oklch(0.92 0.04 ${hue})`,
	};
}

/** Which seasons a series credit covers: "Season 2", "Seasons 2–5", "All 4 seasons". */
export function seasonSpan(seasons: number[], total: number) {
	if (seasons.length === total)
		return total === 1 ? i18n.common_season_n({ n: 1 }) : i18n.person_all_seasons({ count: total });
	const first = seasons[0];
	const last = seasons.at(-1);
	if (first === undefined || last === undefined) return "";
	if (seasons.length === 1) return i18n.common_season_n({ n: first });
	const run = seasons.slice(1).every((n, i) => n - 1 === seasons[i]);
	return run
		? i18n.person_seasons_range({ from: first, to: last })
		: i18n.person_seasons_list({ list: seasons.join(", ") });
}

export const runtime = (min: number) => {
	const h = Math.floor(min / 60);
	const m = min % 60;
	return h
		? i18n.common_runtime_hm({ h, m: String(m).padStart(2, "0") })
		: i18n.common_runtime_m({ m });
};
export const left = (sec: number) => {
	const m = Math.max(1, Math.round(sec / 60));
	return m >= 60
		? i18n.common_left_hm({ h: Math.floor(m / 60), m: m % 60 })
		: i18n.common_left_m({ m });
};
export const inProgress = (w?: Watch) => !!w && !w.watched && w.position_seconds > 0;
export const pct = (w?: Watch) =>
	w && w.duration_seconds > 0 ? Math.round((w.position_seconds / w.duration_seconds) * 100) : 0;

export function badges(q?: FileSummary) {
	if (!q) return [];
	if (prefs.techDetails)
		return [
			q.resolution,
			q.codec,
			q.hdr,
			q.audio && `${q.audio} ${q.channels ?? ""}`.trim(),
		].filter((b): b is string => !!b);
	const res =
		q.resolution === "4320p"
			? "8K"
			: q.resolution === "2160p"
				? "4K"
				: q.resolution === "1080p"
					? "HD"
					: q.resolution;
	const hdr = q.hdr === "Dolby Vision" ? "Dolby Vision" : q.hdr ? "HDR" : null;
	return [res, hdr, q.audio && /Atmos/.test(q.audio) ? "Dolby Atmos" : q.channels].filter(
		(b): b is string => !!b,
	);
}

export const meta = (kind: Kind, t: Title) => {
	const rated = stars(t.rating, t.rating.toLocaleString(getLocale()));
	if (kind !== "series")
		return [t.year, runtime(t.runtime ?? 0), t.certification, rated].filter(Boolean).join(" · ");
	const count = t.total_seasons ?? t.seasons?.length ?? 0;
	const seasons =
		count === 1 ? i18n.common_seasons_one({ count }) : i18n.common_seasons_other({ count });
	return [years(t), seasons, rated].filter(Boolean).join(" · ");
};

/** The line under a title on a wide rail card: when it is from and how long it runs. */
export const railSub = (kind: Kind, t: Title) => {
	if (kind !== "series")
		return [t.year, t.runtime ? runtime(t.runtime) : ""].filter(Boolean).join(" · ");
	const count = t.total_seasons ?? t.seasons?.length ?? 0;
	return `${years(t)} · ${count === 1 ? i18n.common_seasons_one({ count }) : i18n.common_seasons_other({ count })}`;
};

/** Episodes in play order, each with its season number. */
export const episodesOf = (t: Title) =>
	(t.seasons ?? []).flatMap((s) => s.episodes.map((e) => ({ ...e, season: s.number })));

const STILL_POS = ["50% 45%", "22% 40%", "78% 55%", "35% 30%", "64% 70%", "12% 60%", "88% 35%"];
export const stillPos = (episode: number, season: number) =>
	STILL_POS[(episode + season) % STILL_POS.length] ?? "50% 50%";

export const sizeText = (bytes?: number) => {
	if (!bytes) return "";
	const gb = bytes / 1e9;
	const fmt = (n: number) => n.toLocaleString(getLocale(), { maximumFractionDigits: 1 });
	return gb >= 1
		? i18n.library_size_gb({ n: fmt(gb) })
		: i18n.library_size_mb({ n: fmt(bytes / 1e6) });
};

export const addedText = (iso: string, now: Date) => {
	const at = new Date(iso);
	if (at.toISOString().slice(0, 10) === now.toISOString().slice(0, 10))
		return i18n.library_added_today();
	return at.toLocaleDateString(
		dateLocale(getLocale()),
		at.getFullYear() === now.getFullYear()
			? { day: "numeric", month: "short" }
			: { month: "short", year: "numeric" },
	);
};
