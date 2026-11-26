<script lang="ts">
import { pushState, replaceState } from "$app/navigation";
import { page } from "$app/state";
import { admin } from "#lib/core/admin.svelte.ts";
import type { Section, SectionKey, Tone } from "#lib/core/server-view.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import type { Handlers } from "#lib/screens/admin/handlers.ts";
import ServerBlock from "#lib/screens/admin/ServerBlock.svelte";
import { TONES } from "#lib/screens/admin/tone.ts";
import ScopeMenu from "#lib/shells/phone/ScopeMenu.svelte";
import Icon, { type IconName } from "#lib/ui/Icon.svelte";
import Mark from "#lib/ui/Mark.svelte";
import { useScroll } from "#lib/ui/scroll.ts";
import type { Snippet } from "svelte";

let {
	secs,
	groups,
	health,
	host,
	version,
	h,
	strips,
	onrestart,
}: {
	secs: Section[];
	groups: { name: string; items: Section[] }[];
	health: { label: string; tone: Tone };
	host: string;
	version: string;
	h: Handlers;
	strips: Snippet;
	onrestart: () => void;
} = $props();

const getScroll = useScroll();

// The open section rides the history entry, so the system back gesture returns to the list.
const view = $derived((page.state as { section?: SectionKey }).section ?? null);
const index = $derived(secs.findIndex((s) => s.key === view));
const current = $derived(index >= 0 ? secs[index] : null);
const previous = $derived(index > 0 ? secs[index - 1] : null);
const next = $derived(index >= 0 ? (secs[index + 1] ?? null) : null);

function open(key: SectionKey | null) {
	if (key === null) history.back();
	else if (view) replaceState("", { section: key });
	else pushState("", { section: key });
	getScroll?.()?.scrollTo({ top: 0 });
}

const phoneHandlers: Handlers = $derived({ ...h, go: open });
</script>

<div class="page">
	{#if current}
		<div class="sechead">
			<button type="button" class="back" onclick={() => open(null)}>
				<Icon name="chevron-left" size={18} stroke={2} />{i18n.settings_server()}
			</button>
			<div class="titleline">
				<span class="tile"><Icon name={current.icon as IconName} size={22} stroke={1.75} /></span>
				<span class="titles">
					<h1 class="small">{current.title}</h1>
					<p>{current.intro}</p>
				</span>
			</div>
		</div>
	{:else}
		<div class="top">
			<div class="heading"><ScopeMenu here="admin" title={i18n.settings_server()} {host} /></div>
			<div class="ext">
				<Mark size={44} radius={12} ring={false} />
				<span class="who">
					<span class="name">{i18n.server_phone_extension({ version })}</span>
					<span class="where">
						<span class="dot" title={health.label} style:background={TONES[health.tone].fg}></span>
						<span class="clip">{host} · {health.label}</span>
					</span>
				</span>
				<button
					type="button"
					class="restart"
					disabled={admin.restarting}
					aria-label={i18n.server_phone_restart_label()}
					onclick={onrestart}
				>
					{admin.restarting ? i18n.server_status_restarting() : i18n.server_act_restart()}
				</button>
			</div>
		</div>
	{/if}

	{@render strips()}

	{#if current}
		<div class="blocks">
			{#each current.blocks as block, bi (bi)}
				<ServerBlock {block} h={phoneHandlers} drafts={admin.drafts} />
			{/each}
		</div>
		{#if previous || next}
			<div class="pager">
				{#if previous}
					{@const p = previous}
					<button type="button" class="prev" onclick={() => open(p.key)}>
						<span class="eyebrow">{i18n.server_phone_previous()}</span>
						<span class="ptitle">{p.title}</span>
					</button>
				{/if}
				{#if next}
					{@const n = next}
					<button type="button" class="next" onclick={() => open(n.key)}>
						<span class="eyebrow">{i18n.server_phone_next()}</span>
						<span class="ptitle">{n.title}</span>
					</button>
				{/if}
			</div>
		{/if}
	{:else}
		<div class="index">
			{#each groups as g (g.name)}
				<section>
					<h2>{g.name || i18n.settings_server()}</h2>
					<div class="card">
						{#each g.items as it (it.key)}
							<button type="button" class="item" onclick={() => open(it.key)}>
								<Icon name={it.icon as IconName} size={19} stroke={1.75} />
								<span class="text">
									<span class="label">{it.title}</span>
									<span class="sum">{it.sum}</span>
								</span>
								{#if it.badge}
									<span class="badge">{it.badge}</span>
								{/if}
								<Icon name="chevron-right" size={16} stroke={2} />
							</button>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}

	<div class="foot">{i18n.server_phone_footer({ version, host })}</div>
</div>

<style>
.page {
	box-sizing: border-box;
	min-height: 100%;
	display: flex;
	flex-direction: column;
	gap: 22px;
	padding: calc(env(safe-area-inset-top) + 2px) 16px 28px;
	background: var(--bg-deep);
	color: var(--fg);
}

.top {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.heading {
	display: flex;
	padding: 0 4px;
}

.ext {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 14px 16px;
	border-radius: 14px;
	background: var(--bg-elevated);
	border: 1px solid var(--border);
}

.who {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.name {
	font-size: 15px;
	font-weight: 600;
}

.where {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
	font: 400 11px var(--font-mono);
	color: var(--fg-subtle);
}

.dot {
	flex: none;
	width: 7px;
	height: 7px;
	border-radius: 50%;
}

.clip {
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.restart {
	flex: none;
	height: 40px;
	padding: 0 12px;
	border-radius: var(--radius-md);
	border: 0;
	background: color-mix(in srgb, var(--status-failed) 12%, transparent);
	color: var(--status-failed);
	font-size: 14px;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
}

.restart:disabled {
	opacity: 0.5;
	cursor: default;
}

.sechead {
	display: flex;
	flex-direction: column;
	gap: 14px;
}

.back {
	align-self: flex-start;
	height: 44px;
	display: flex;
	align-items: center;
	gap: 3px;
	padding: 0 10px 0 4px;
	margin-left: -6px;
	border: 0;
	border-radius: var(--radius-full);
	background: transparent;
	color: var(--accent-text);
	font-size: 14px;
	font-weight: 500;
	cursor: pointer;
}

.titleline {
	display: flex;
	align-items: flex-start;
	gap: 16px;
}

.tile {
	flex: none;
	width: 48px;
	height: 48px;
	border-radius: 13px;
	display: grid;
	place-items: center;
	background: var(--bg-elevated);
	border: 1px solid var(--border);
	color: var(--accent-text);
}

.titles {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

h1.small {
	margin: 0;
	font-size: 26px;
	font-weight: 700;
	letter-spacing: -0.025em;
	line-height: 1.15;
}

.titles p {
	margin: 0;
	font-size: 13.5px;
	line-height: 1.5;
	color: var(--fg-subtle);
	text-wrap: pretty;
}

.blocks {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	gap: 28px 14px;
	align-items: start;
}

.blocks :global(.row) {
	padding: 13px 16px;
}

.blocks :global(.row:has(.tiles)) {
	padding: 0;
}

.blocks :global(.tiles:not(:has(.value.mono))) {
	--tile-min: 150px;
}

.blocks :global(input) {
	height: 42px;
	font-size: 16px;
}

.blocks :global(.action),
.blocks :global(.row button.act),
.blocks :global(.row .go) {
	min-height: 44px;
}

/* Touch sizes for the rows the desktop page draws small. */
.blocks :global(.filters.compact button) {
	height: 36px;
}

.blocks :global(.sl-btn--sm) {
	height: 44px;
}

.blocks :global(.tiles:has(.value.mono)) {
	--tile-min: 280px;
}

.blocks :global(.pair .bottom) {
	padding-left: 0;
}

.blocks :global(.pair .to),
.blocks :global(.pair .to .filters) {
	flex: 1 1 100%;
}

.blocks :global(.pair .btns) {
	flex: 1 1 100%;
	gap: 8px;
}

.blocks :global(.pair .btns button) {
	flex: 1 1 0;
	height: 44px;
}

.blocks :global(.thumb) {
	width: 104px;
}

.blocks :global(.stop) {
	height: 40px;
}

.index {
	display: flex;
	flex-direction: column;
	gap: 20px;
}

section {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

h2 {
	margin: 0;
	padding: 0 16px;
	font: 500 10.5px var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--fg-faint);
}

.card {
	border-radius: 14px;
	background: var(--bg-elevated);
	border: 1px solid var(--border);
	overflow: hidden;
}

.item {
	width: 100%;
	min-height: 56px;
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 8px 12px 8px 16px;
	border: 0;
	background: transparent;
	color: var(--fg);
	text-align: left;
	cursor: pointer;
}

.item + .item {
	border-top: 1px solid var(--border);
}

.item > :global(.sl-ico:first-child) {
	color: var(--fg-subtle);
}

.item > :global(.sl-ico:last-child) {
	color: var(--fg-faint);
}

.text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 1px;
}

.label {
	font-size: 15px;
}

.sum {
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.badge {
	flex: none;
	min-width: 20px;
	height: 20px;
	padding: 0 6px;
	display: grid;
	place-items: center;
	border-radius: var(--radius-full);
	background: var(--accent);
	color: var(--fg-on-accent);
	font: 500 11px var(--font-mono);
}

.pager {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	gap: 10px;
	padding-top: 4px;
}

.pager button {
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 3px;
	padding: 12px 14px;
	border-radius: 12px;
	background: transparent;
	border: 1px solid var(--border);
	color: var(--fg);
	cursor: pointer;
}

.prev {
	grid-column: 1;
	align-items: flex-start;
	text-align: left;
}

.next {
	grid-column: 2;
	align-items: flex-end;
	text-align: right;
}

.eyebrow {
	font: 500 10px var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--fg-faint);
}

.ptitle {
	max-width: 100%;
	font-size: 14px;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.foot {
	padding-top: 6px;
	font: 400 11.5px var(--font-mono);
	color: var(--fg-faint);
	text-align: center;
}
</style>
