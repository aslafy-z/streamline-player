import { account } from "#lib/core/me.svelte.ts";
import { toast } from "#lib/core/toast.svelte.ts";
import type { Kind, ScanScope } from "#lib/core/types.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { adminScanTitles } from "#platform";

export const canScan = () => account.me?.role === "Admin";

/** An admin's scan of movie `id`, or of the episodes `eps` of a series, toasting `label` once it is under way. */
export function scanTitle(
	kind: Kind,
	id: number,
	label: string,
	eps: { id: number; has_file: boolean }[] = [],
) {
	const scope: ScanScope =
		kind === "movies"
			? { movies: [id] }
			: { episodes: eps.filter((e) => e.has_file).map((e) => e.id) };
	// The extension reads an empty scope as the whole library.
	if (!scope.movies?.length && !scope.episodes?.length) return;
	adminScanTitles(scope).then(
		() => toast(label, { text: i18n.detail_toast_scan_text() }),
		() => {},
	);
}
