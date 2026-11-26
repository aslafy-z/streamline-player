<script lang="ts">
import { m as i18n } from "#lib/paraglide/messages.js";
import Art from "#lib/ui/Art.svelte";
import Icon, { type IconName } from "#lib/ui/Icon.svelte";
import "#lib/ui/ui.css";

let {
	head,
	name,
	text,
	at,
	poster,
	small,
	badge,
	badgeTone,
	icon,
	unread,
	onclick,
}: {
	head: string;
	name: string;
	text: string;
	at: string;
	poster: string | null;
	small?: string;
	badge: IconName | null;
	badgeTone: "accent" | "warning" | "available" | null;
	icon: IconName;
	unread: boolean;
	onclick: () => void;
} = $props();

const TONES = {
	accent: "var(--accent)",
	warning: "var(--status-warning)",
	available: "var(--status-available)",
};
</script>

<button type="button" class="row" {onclick}>
	<span class="lead">
		{#if poster}
			<span class="poster"><Art src={poster} {small} kind="poster" ratio="2 / 3" /></span>
			{#if badge}
				<span class="badge" style:--c={badgeTone ? TONES[badgeTone] : undefined}>
					<Icon name={badge} />
				</span>
			{/if}
		{:else}
			<span class="sys"><Icon name={icon} /></span>
		{/if}
	</span>
	<span class="col">
		<span class="head">
			<span class="h">{head}</span>
			{#if name}
				<span class="n">{name}</span>
			{/if}
		</span>
		{#if text}
			<span class="t">{text}</span>
		{/if}
	</span>
	<span class="end">
		<span class="at">{at}</span>
		<span class="dot" class:on={unread} aria-hidden="true"></span>
		{#if unread}
			<span class="sr">{i18n.activity_unread_row()}</span>
		{/if}
	</span>
</button>

<style>
.row {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: 16px;
	width: 100%;
	padding: 12px;
	border: 0;
	border-radius: 12px;
	background: none;
	color: var(--fg);
	text-align: left;
	cursor: pointer;
	transition: background var(--dur-fast);
}

.row:hover {
	background: var(--surface);
}

.lead {
	position: relative;
	flex: none;
	width: 44px;
	display: grid;
	place-items: center;
}

.poster {
	display: block;
	width: 44px;
	height: 66px;
	border-radius: var(--radius-sm);
	overflow: hidden;
	box-shadow: 0 0 0 1px var(--border);
}

.poster :global(.art) {
	width: 100%;
	height: 100%;
}

.badge {
	position: absolute;
	right: -6px;
	bottom: -6px;
	width: 22px;
	height: 22px;
	display: grid;
	place-items: center;
	border-radius: 50%;
	background: var(--c, var(--accent));
	color: var(--fg-on-accent);
	font-size: 12px;
	box-shadow: 0 0 0 2px var(--bg-deep);
}

.badge :global(.sl-ico) {
	stroke-width: 2.5;
}

.sys {
	width: 44px;
	height: 44px;
	display: grid;
	place-items: center;
	border-radius: 12px;
	background: var(--bg-elevated);
	border: 1px solid var(--border);
	color: var(--fg-muted);
	font-size: 19px;
}

.col {
	display: flex;
	flex-direction: column;
	gap: 3px;
	min-width: 0;
}

.head {
	display: flex;
	align-items: baseline;
	gap: 8px;
	min-width: 0;
}

.h {
	font-size: 14.5px;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.n {
	font-size: 14px;
	color: var(--fg-muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.t {
	font-size: 13px;
	line-height: 1.45;
	color: var(--fg-subtle);
	text-wrap: pretty;
}

.end {
	display: flex;
	align-items: center;
	gap: 12px;
}

.at {
	font: 400 11.5px var(--font-mono);
	color: var(--fg-faint);
	white-space: nowrap;
}

.dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--accent);
	opacity: 0;
	transform: scale(0);
	transition:
		opacity var(--dur-base),
		transform var(--dur-base) var(--ease);
}

.sr {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
}

.dot.on {
	opacity: 1;
	transform: none;
}
</style>
