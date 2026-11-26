<script lang="ts">
import LoadFailed from "#lib/screens/LoadFailed.svelte";
import { feed, loadActivity, markAllRead, markRead } from "#lib/core/activity.svelte.ts";
import { FILTERS, type Filter, feedView, type RowView } from "#lib/core/activity-view.ts";
import { lib, loadLibrary } from "#lib/core/library.svelte.ts";
import { toast } from "#lib/core/toast.svelte.ts";
import type { Kind } from "#lib/core/types.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { isPhone, isTablet } from "#lib/platform/form-factor.svelte.ts";
import { getLocale } from "#lib/paraglide/runtime.js";
import ActivityRow from "#lib/ui/ActivityRow.svelte";
import { activityWords } from "#lib/ui/activity-words.ts";
import Button from "#lib/ui/Button.svelte";
import ChoicePills from "#lib/ui/ChoicePills.svelte";
import EmptyState from "#lib/ui/EmptyState.svelte";
import Icon, { type IconName } from "#lib/ui/Icon.svelte";
import { goto } from "#lib/ui/nav.ts";
import {
	activity,
	artwork,
	canDownload,
	home,
	library,
	markActivityRead,
	title,
	watchState,
} from "#platform";
import { onMount } from "svelte";

const PAD_X = $derived(isTablet() ? 44 : 56);
const TOP = 92;
const BOTTOM = 32;
// The phone shell already leaves 28 under its pages.
const PHONE_BOTTOM = 4;
const MAX_WIDTH = 980;
const PHONE_PAD_X = 20;
const PHONE_TOP_GAP = 12;
const port = { activity, markActivityRead };
const libraryPort = { library, watchState, home, title };

const LABELS = $derived<Record<Filter, string>>({
	all: i18n.library_all(),
	library: i18n.activity_filter_library(),
	downloads: i18n.shell_downloads(),
	system: i18n.settings_server(),
});

const phone = $derived(isPhone());
let filter = $state<Filter>("all");
const now = new Date();

const find = (kind: Kind, id: number) =>
	(kind === "movies" ? lib.movies : lib.shows).find((t) => t.id === id);
const view = $derived(feedView(feed.items, filter, find, now, getLocale(), activityWords()));

async function open(r: RowView) {
	markRead(port, [r.id]).then((ok) => {
		if (!ok) toast(i18n.settings_err_unknown(), { icon: "wifi", warning: true });
	});
	const to = r.open;
	if (!to) return;
	if (to.to === "downloads" && canDownload) {
		await goto("/downloads");
		return;
	}
	if (to.to === "detail")
		await goto(`/detail/${to.kind}/${to.id}${to.season ? `?s=${to.season}` : ""}`);
	else await goto(`/detail/${to.kind}/${to.id}`);
}

async function readAll() {
	if (!(await markAllRead(port)))
		toast(i18n.settings_err_unknown(), { icon: "wifi", warning: true });
}

onMount(() => {
	loadLibrary(libraryPort, lib.loaded);
	loadActivity(port, true);
});
</script>

<div
	class="page"
	class:phone
	style:padding={phone
		? `calc(env(safe-area-inset-top) + ${PHONE_TOP_GAP}px) ${PHONE_PAD_X}px ${PHONE_BOTTOM}px`
		: `${TOP}px ${PAD_X}px ${BOTTOM}px`}
	style:--max="{isTablet() ? MAX_WIDTH : MAX_WIDTH + 2 * PAD_X}px"
>
	<div class="top">
		<div class="lead">
			<div class="titles">
				<h1>{i18n.shell_activity()}</h1>
				<span class="summary">{view.summary}</span>
			</div>
			{#if phone}
				<button type="button" class="read-all" disabled={view.unread === 0} onclick={readAll}>
					<Icon name="check-check" size={16} stroke={2} />{i18n.activity_mark_all_short()}
				</button>
			{/if}
		</div>
		<div class="tools">
			<ChoicePills
				options={FILTERS.map((f) => [f, LABELS[f]])}
				value={filter}
				label={i18n.activity_filter()}
				onchange={(v) => (filter = v as Filter)}
			/>
			{#if !phone}
				<Button variant="secondary" icon="tick" disabled={view.unread === 0} onclick={readAll}>
					{i18n.activity_mark_all()}
				</Button>
			{/if}
		</div>
	</div>

	{#if feed.error !== null && !feed.loaded}
		<LoadFailed error={feed.error} retry={() => loadActivity(port, true)} />
	{:else}
		{#each view.groups as g (g.group)}
			<section>
				<h2>{g.label}</h2>
				{#each g.rows as r (r.id)}
					<div class="slot">
						<ActivityRow
							head={r.head}
							name={r.name}
							text={r.text}
							at={r.at}
							poster={r.poster && r.titleKind ? artwork(r.titleKind, r.poster.id, "poster") : null}
							small={r.poster && r.titleKind
								? artwork(r.titleKind, r.poster.id, "poster-w342")
								: undefined}
							badge={r.badge as IconName | null}
							badgeTone={r.badgeTone}
							icon={r.icon as IconName}
							unread={r.unread}
							onclick={() => open(r)}
						/>
					</div>
				{/each}
			</section>
		{/each}
		{#if view.empty && feed.loaded}
			<EmptyState icon="bell" title={i18n.activity_empty()} />
		{/if}
	{/if}
</div>

<style>
.page {
	box-sizing: border-box;
	max-width: var(--max);
	min-height: 100%;
	margin: 0 auto;
	display: flex;
	flex-direction: column;
	gap: 22px;
}

.page.phone {
	max-width: none;
}

.top {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	justify-content: space-between;
	gap: 14px 24px;
}

.titles {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

h1 {
	margin: 0;
	font-size: 30px;
	font-weight: 700;
	letter-spacing: -0.025em;
}

.summary {
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
}

.tools {
	display: flex;
	align-items: center;
	gap: 10px;
}

.lead {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: 12px;
}

.page.phone .lead,
.page.phone .tools {
	flex: 1 1 100%;
}

.page.phone .tools :global(.filters) {
	flex: 1 1 0;
}

.page.phone .tools :global(.filters button) {
	height: 36px;
}

.read-all {
	flex: none;
	display: flex;
	align-items: center;
	gap: 6px;
	height: 44px;
	margin: 0 -10px -12px 0;
	padding: 0 10px;
	border: 0;
	border-radius: var(--radius-md);
	background: transparent;
	color: var(--accent-text);
	font-size: 13.5px;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
}

.read-all:disabled {
	color: var(--fg-faint);
	cursor: default;
}

section {
	display: flex;
	flex-direction: column;
}

h2 {
	margin: 0 0 6px;
	font: 500 10.5px var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--fg-faint);
}

.slot {
	margin: 0 -12px;
}
</style>
