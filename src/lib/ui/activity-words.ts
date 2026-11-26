import type { Words } from "#lib/core/activity-view.ts";
import { m as i18n } from "#lib/paraglide/messages.js";

const plural = (count: number, one: string, other: string) => (count === 1 ? one : other);

export const activityWords = (): Words => ({
	groups: {
		today: i18n.library_added_today(),
		yesterday: i18n.activity_yesterday(),
		week: i18n.activity_week(),
		earlier: i18n.activity_earlier(),
	},
	newEpisodes: (count) =>
		count === 1 ? i18n.activity_new_episode() : i18n.activity_new_episodes({ count }),
	episodesReady: (season, list, count) =>
		count === 1
			? i18n.activity_ready_one({ season, list })
			: i18n.activity_ready_other({ season, list }),
	seasonAdded: (season) => i18n.activity_season_added({ season }),
	episodeCount: (count) =>
		count === 1 ? i18n.activity_episodes_one() : i18n.activity_episodes_other({ count }),
	movieAdded: i18n.activity_movie_added(),
	upgraded: (is4k) => (is4k ? i18n.activity_upgraded_4k() : i18n.activity_upgraded_hd()),
	replaced: (previous, quality) => i18n.activity_replaced({ previous, quality }),
	downloadFinished: i18n.activity_download_finished(),
	downloadedEpisode: (season, episode) => i18n.activity_downloaded_episode({ season, episode }),
	downloadedMovie: i18n.activity_downloaded_movie(),
	deviceSignedIn: i18n.activity_device(),
	serverUpdated: i18n.activity_server_updated(),
	serverText: (version, restartSeconds) =>
		restartSeconds === undefined
			? i18n.activity_server_version({ version })
			: i18n.activity_server_restart({ version, seconds: restartSeconds }),
	scanFinished: i18n.activity_scan_finished(),
	scanText: (added, upgraded, errors) =>
		[
			plural(
				added,
				i18n.activity_titles_one({ count: added }),
				i18n.activity_titles_other({ count: added }),
			),
			plural(
				upgraded,
				i18n.activity_upgrades_one({ count: upgraded }),
				i18n.activity_upgrades_other({ count: upgraded }),
			),
			plural(
				errors,
				i18n.activity_errors_one({ count: errors }),
				i18n.activity_errors_other({ count: errors }),
			),
		].join(" · "),
	unread: (count) =>
		plural(count, i18n.activity_unread_one({ count }), i18n.activity_unread_other({ count })),
	caughtUp: i18n.activity_caught_up(),
	bell: (count) =>
		plural(count, i18n.activity_bell_one({ count }), i18n.activity_bell_other({ count })),
	bellPlain: i18n.shell_activity(),
});
