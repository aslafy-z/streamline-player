<script module lang="ts">
import type { Card } from "#lib/core/downloads-view.ts";

export type PhoneGroup = {
	key: string;
	title: string;
	sub: string;
	poster: string;
	open: () => void;
	seasons: { label: string | null; cards: Card[] }[];
};
</script>

<script lang="ts">
import type { ActiveRow } from "#lib/core/downloads-view.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import Art from "#lib/ui/Art.svelte";
import Banner from "#lib/ui/Banner.svelte";
import Button from "#lib/ui/Button.svelte";
import EmptyState from "#lib/ui/EmptyState.svelte";
import Icon from "#lib/ui/Icon.svelte";
import TriPick from "#lib/ui/TriPick.svelte";
import StorageMeter from "#lib/ui/StorageMeter.svelte";
import { prefs } from "#lib/core/prefs.svelte.ts";
import { TARGET } from "#lib/platform/target.ts";
import { artworkAt } from "#platform";

const touch = TARGET === "android";

let {
	summary,
	meter,
	groups,
	active,
	empty,
	online,
	selecting,
	picked,
	pickedCount,
	pickedSize,
	allPicked,
	stillOf,
	posOf,
	oncancel,
	onretry,
	onplay,
	onremove,
	onselecting,
	onpick,
	onpickall,
	onremovepicked,
	onbrowse,
}: {
	summary: string;
	meter: { usedPct: number; otherPct: number; labels: [string, string, string] } | null;
	groups: PhoneGroup[];
	active: ActiveRow[];
	empty: boolean;
	online: boolean;
	selecting: boolean;
	picked: Set<string>;
	pickedCount: number;
	pickedSize: string;
	allPicked: boolean;
	stillOf: (key: string) => string;
	posOf: (key: string) => string;
	oncancel: (key: string) => void;
	onretry: (key: string) => void;
	onplay: (c: Card) => void;
	onremove: (c: Card) => void;
	onselecting: () => void;
	onpick: (key: string) => void;
	onpickall: () => void;
	onremovepicked: () => void;
	onbrowse: () => void;
} = $props();

type PickState = "true" | "mixed" | "false";
const stateOf = (keys: string[]): PickState => {
	const n = keys.filter((k) => picked.has(k)).length;
	return n === 0 ? "false" : n === keys.length ? "true" : "mixed";
};
const toggleAll = (keys: string[]) => {
	const all = stateOf(keys) === "true";
	for (const k of keys) if (picked.has(k) === all) onpick(k);
};
const keysOf = (cards: Card[]) => cards.map((c) => c.key);
</script>

<div class="page" style:--pick-line="color-mix(in srgb, var(--fg) 28%, transparent)">
	<div class="top">
		<div class="titles">
			<h1>{i18n.shell_downloads()}</h1>
			<span class="summary">{summary}</span>
		</div>
		{#if meter}
			<div class="meter">
				<StorageMeter usedPct={meter.usedPct} otherPct={meter.otherPct} labels={meter.labels} />
			</div>
		{/if}
		{#if touch}
			<p class="wifi">
				<Icon name="wifi" size={15} stroke={1.75} />
				{prefs.wifiOnly ? i18n.dl_wifi_note_on() : i18n.dl_wifi_note_off()}
			</p>
		{/if}
	</div>

	{#if !online}
		<Banner
			status="paused"
			icon="wifi-off"
			title={i18n.dl_offline_title()}
			detail={i18n.dl_offline_detail()}
		/>
	{/if}

	{#if active.length > 0}
		<section class="active">
			<h2>{i18n.dl_downloading()}</h2>
			{#each active as r (r.key)}
				<div class="arow {r.state}" data-key={r.key} data-state={r.state}>
					<span class="thumb dim"><Art src={stillOf(r.key)} position={posOf(r.key)} /></span>
					<span class="body">
						<span class="name">{r.title}</span>
						<span class="bar"><span class="fill" style:width="{r.pct}%"></span></span>
						<span class="line">
							<span class="sub">{r.sub}</span>
							<span class="note {r.noteTone}">{r.note}</span>
						</span>
					</span>
					{#if r.canRetry}
						<span class="icon">
							<Button
								variant="icon"
								icon="rotate-cw"
								label={i18n.dl_retry_download()}
								onclick={() => onretry(r.key)}
							/>
						</span>
					{/if}
					<span class="icon">
						<Button
							variant="icon"
							icon="x"
							label={i18n.dl_cancel()}
							onclick={() => oncancel(r.key)}
						/>
					</span>
				</div>
			{/each}
		</section>
	{/if}

	{#if groups.length > 0}
		<section class="done">
			<div class="shead">
				<h2>{i18n.dl_on_device()}</h2>
				<button type="button" class="select" aria-pressed={selecting} onclick={onselecting}>
					{selecting ? i18n.dl_select_done() : i18n.dl_select()}
				</button>
			</div>
			{#each groups as g (g.key)}
				<div class="group">
					<div class="grow">
						{#if selecting}
							{@const keys = g.seasons.flatMap((s) => keysOf(s.cards))}
							{@const st = stateOf(keys)}
							<TriPick
								state={st}
								label={(st === "true" ? i18n.dl_unselect_all_of : i18n.dl_select_all_of)({
									name: g.title,
								})}
								margin="-4px -4px 0"
								onclick={() => toggleAll(keys)}
							/>
						{/if}
						<button type="button" class="ghead" onclick={g.open}>
							<span class="poster"><Art src={artworkAt(g.poster)} kind="poster" /></span>
							<span class="gtext">
								<span class="gname">{g.title}</span>
								<span class="gsub">{g.sub}</span>
							</span>
							<Icon name="chevron-right" size={18} stroke={2} />
						</button>
					</div>
					{#each g.seasons as s (s.label ?? "")}
						{#if s.label}
							<div class="srow">
								{#if selecting}
									{@const st = stateOf(keysOf(s.cards))}
									<TriPick
										state={st}
										label={(st === "true" ? i18n.dl_unselect_all_of : i18n.dl_select_all_of)({
											name: s.label,
										})}
										margin="0 -4px"
										onclick={() => toggleAll(keysOf(s.cards))}
									/>
								{/if}
								<span class="season">{s.label}</span>
							</div>
						{/if}
						{#each s.cards as c (c.key)}
							{@const on = picked.has(c.key)}
							<div class="item" data-key={c.key}>
								<button
									type="button"
									class="tap"
									aria-label={selecting
										? (on ? i18n.dl_unselect_item : i18n.dl_select_item)({ title: c.fullTitle })
										: i18n.library_play_title({ title: c.fullTitle })}
									aria-pressed={selecting ? on : undefined}
									onclick={() => (selecting ? onpick(c.key) : onplay(c))}
								>
									{#if selecting}
										<span class="box" class:on aria-hidden="true">
											<Icon name="tick" size={13} stroke={3} />
										</span>
									{/if}
									<span class="thumb">
										<Art src={stillOf(c.key)} position={posOf(c.key)} />
										<span class="playdot"><Icon name="play" size={11} filled /></span>
										{#if c.watched}
											<span class="seen"></span>
										{/if}
									</span>
									<span class="itext">
										<span class="ititle">{c.head}</span>
										<span class="isub">{c.meta}</span>
										<span class="itracks">{c.tracks}</span>
										{#if c.offText}
											<span class="off"
												><Icon name="history" size={13} stroke={2} />{c.offText}</span
											>
										{/if}
									</span>
								</button>
								<span class="icon trash">
									<Button
										variant="icon"
										icon="trash-2"
										label={i18n.dl_remove()}
										onclick={() => onremove(c)}
									/>
								</span>
							</div>
						{/each}
					{/each}
				</div>
			{/each}
		</section>
	{/if}

	{#if selecting}
		<div class="selbar" role="toolbar" aria-label={i18n.dl_selection()}>
			<span class="selinfo">
				<span class="selcount"
					>{pickedCount
						? (pickedCount === 1 ? i18n.dl_selected_one : i18n.dl_selected_other)({
								count: pickedCount,
							})
						: i18n.dl_pick_what()}</span
				>
				{#if pickedCount}
					<span class="selsize">{pickedSize}</span>
				{/if}
			</span>
			<button type="button" class="selall" onclick={onpickall}>
				{allPicked ? i18n.dl_select_clear() : i18n.dl_select_all()}
			</button>
			<Button variant="danger" icon="trash-2" disabled={!pickedCount} onclick={onremovepicked}>
				{i18n.dl_remove_one()}
			</Button>
		</div>
	{/if}

	{#if empty}
		<div class="none">
			<EmptyState icon="download" title={i18n.dl_empty_title()} text={i18n.dl_empty_text()}>
				{#snippet action()}
					<span class="cta">
						<Button variant="primary" onclick={onbrowse}>{i18n.dl_browse()}</Button>
					</span>
				{/snippet}
			</EmptyState>
		</div>
	{/if}
</div>

<style>
.page {
	position: relative;
	box-sizing: border-box;
	min-height: 100%;
	display: flex;
	flex-direction: column;
	gap: 22px;
	/* 4 on top of the 28 the shell leaves under its pages. */
	padding: calc(env(safe-area-inset-top) + 12px) 20px 4px;
}

.none {
	flex: 1;
	display: grid;
	place-items: center;
}

.top {
	display: flex;
	flex-direction: column;
	gap: 14px;
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

.meter :global(.card) {
	max-width: none;
}

.selbar {
	position: sticky;
	bottom: calc(var(--tabs-h, env(safe-area-inset-bottom)) + 10px);
	z-index: 10;
	align-self: center;
	width: 100%;
	max-width: 560px;
	box-sizing: border-box;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 8px 8px 16px;
	border-radius: var(--radius-lg);
	background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
	backdrop-filter: blur(16px) saturate(150%);
	box-shadow:
		inset 0 0 0 1px var(--border-strong),
		var(--shadow-4);
	animation: slp-rise 200ms var(--ease);
}

.selinfo {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 1px;
}

.selcount {
	font-size: 14px;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.selsize {
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
}

.selall,
.select {
	flex: none;
	border: 0;
	border-radius: var(--radius-md);
	background: transparent;
	color: var(--accent-text);
	font-size: 13.5px;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
}

.selall {
	height: 44px;
	padding: 0 12px;
}

.select {
	height: 32px;
	margin: -8px -10px -8px 0;
	padding: 0 10px;
}

.selall:active,
.select:active {
	background: var(--surface-2);
}

.shead {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	margin: 0 0 6px;
}

.grow,
.srow {
	display: flex;
	align-items: center;
	gap: 10px;
}

.srow {
	min-height: 32px;
	padding: 6px 0 0;
}

section {
	display: flex;
	flex-direction: column;
}

.active {
	gap: 6px;
}

.done {
	gap: 2px;
}

h2 {
	margin: 0 0 6px;
	font: 500 10.5px var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--fg-faint);
}

.active h2 {
	margin-bottom: 4px;
}

.shead h2 {
	margin: 0;
}

.arow {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 10px 0;
}

.thumb {
	position: relative;
	flex: none;
	width: 112px;
	aspect-ratio: 16 / 9;
	border-radius: 8px;
	overflow: hidden;
	background: var(--bg-card);
}

.thumb.dim :global(img.loaded) {
	opacity: 0.7;
}

.body {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 5px;
}

.name {
	font-size: 15px;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.bar {
	display: block;
	height: 3px;
	border-radius: 2px;
	background: color-mix(in srgb, var(--fg) 10%, transparent);
	overflow: hidden;
}

.fill {
	display: block;
	height: 100%;
	background: var(--status-downloading);
	transition: width 450ms linear;
}

.waiting .fill {
	background: var(--fg-subtle);
}

.failed .fill {
	background: var(--status-failed);
}

.line {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	gap: 2px 12px;
	font: 400 11.5px var(--font-mono);
}

.sub {
	color: var(--fg-subtle);
}

.note.rate {
	color: var(--accent-text);
}

.note.muted {
	color: var(--fg-subtle);
}

.note.failed {
	color: var(--status-failed);
}

.icon {
	flex: none;
	display: inline-flex;
}

.icon :global(.sl-btn) {
	width: 44px;
	height: 44px;
}

.trash :global(.sl-btn) {
	color: var(--status-failed);
}

.group {
	display: flex;
	flex-direction: column;
	padding: 10px 0 6px;
	border-top: 1px solid var(--border);
}

.ghead {
	flex: 1;
	min-width: 0;
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 4px 0 8px;
	border: 0;
	background: transparent;
	color: var(--fg);
	text-align: left;
	cursor: pointer;
}

.ghead :global(.sl-ico) {
	color: var(--fg-faint);
}

.poster {
	position: relative;
	flex: none;
	width: 34px;
	aspect-ratio: 2 / 3;
	border-radius: 5px;
	overflow: hidden;
}

.gtext {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 1px;
}

.gname {
	font-size: 16px;
	font-weight: 600;
}

.gsub {
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
}

.season {
	padding: 0;
	font: 500 10.5px var(--font-mono);
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--fg-subtle);
}

.item {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 6px 0;
}

.tap {
	flex: 1;
	min-width: 0;
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--fg);
	text-align: left;
	cursor: pointer;
}

.playdot {
	position: absolute;
	left: 6px;
	bottom: 6px;
	width: 26px;
	height: 26px;
	display: grid;
	place-items: center;
	border-radius: 50%;
	background: color-mix(in srgb, var(--fg) 92%, transparent);
	color: var(--fg-on-accent);
}

.playdot :global(.sl-ico) {
	margin-left: 1px;
}

.seen {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	height: 3px;
	background: var(--accent);
}

.itext {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 3px;
}

.ititle {
	font-size: 14.5px;
	font-weight: 500;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.isub {
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
}

.itracks {
	font: 400 11px var(--font-mono);
	color: var(--fg-subtle);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.off {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-top: 3px;
	font-size: 12px;
	line-height: 1.35;
	color: var(--fg-muted);
}

.off :global(.sl-ico) {
	flex: none;
	color: var(--status-wanted);
}

.cta :global(.sl-btn) {
	height: 44px;
}

.box {
	flex: none;
	width: 24px;
	height: 24px;
	display: grid;
	place-items: center;
	box-sizing: border-box;
	border-radius: 50%;
	border: 2px solid color-mix(in srgb, var(--fg) 28%, transparent);
	background: transparent;
	color: var(--fg-on-accent);
	transition:
		background 150ms var(--ease),
		border-color 150ms var(--ease);
}

.box :global(.sl-ico) {
	opacity: 0;
}

.box.on {
	border-color: var(--accent);
	background: var(--accent);
}

.box.on :global(.sl-ico:first-child) {
	opacity: 1;
}

.box :global(.sl-ico) {
	grid-area: 1 / 1;
}

.wifi {
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 0;
	font-size: 12.5px;
	color: var(--fg-subtle);
}
</style>
