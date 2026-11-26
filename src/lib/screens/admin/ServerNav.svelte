<script lang="ts">
import type { SectionKey } from "#lib/core/server-view.ts";
import ScopeMenu from "#lib/shells/phone/ScopeMenu.svelte";
import Icon, { type IconName } from "#lib/ui/Icon.svelte";

type Item = { key: SectionKey; icon: string; title: string; badge?: number; count?: number };

let {
	groups,
	active,
	host,
	dot,
	title,
	label,
	top,
	onopen,
}: {
	groups: { name: string; items: Item[] }[];
	active: SectionKey;
	host: string;
	dot: string;
	title: string;
	label: string;
	top: number;
	onopen: (key: SectionKey) => void;
} = $props();
</script>

<nav aria-label={label} style:top="{top}px" style:max-height="calc(100vh - 104px)">
	<div class="who">
		<span class="scope"><ScopeMenu here="admin" {title} {host} /></span>
		<span class="host"><span class="dot" style:background={dot}></span>{host}</span>
	</div>
	<div class="list">
		{#each groups as g (g.name)}
			<div class="group">
				{#if g.name}
					<span class="name">{g.name}</span>
				{/if}
				{#each g.items as it (it.key)}
					<button
						type="button"
						class="item"
						class:on={active === it.key}
						aria-current={active === it.key ? "true" : undefined}
						onclick={() => onopen(it.key)}
					>
						<Icon name={it.icon as IconName} size={16} stroke={1.75} />
						<span class="title">{it.title}</span>
						{#if it.badge}
							<span class="badge">{it.badge}</span>
						{:else if it.count !== undefined}
							<span class="count">{it.count}</span>
						{/if}
					</button>
				{/each}
			</div>
		{/each}
	</div>
</nav>

<style>
nav {
	position: sticky;
	align-self: start;
	display: flex;
	flex-direction: column;
	gap: 16px;
}

/* The title's menu is wider than the column, so only the list under it scrolls. */
.list {
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 16px;
	padding-bottom: 16px;
}

.scope {
	--title-size: 28px;
}

.who {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.host {
	display: flex;
	align-items: center;
	gap: 7px;
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
}

.dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
}

.group {
	display: flex;
	flex-direction: column;
	gap: 1px;
}

.name {
	padding: 0 10px 5px;
	font: 500 10px var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--fg-faint);
}

.item {
	flex: none;
	height: 32px;
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 0 10px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--fg-muted);
	font: inherit;
	font-size: 13.5px;
	font-weight: 500;
	text-align: left;
	cursor: pointer;
}

.item:hover {
	background: var(--surface);
	color: var(--fg);
}

.item.on {
	background: var(--accent-soft);
	color: var(--accent-text);
}

.item :global(.sl-ico) {
	flex: none;
}

.title {
	flex: 1;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.badge {
	min-width: 18px;
	height: 18px;
	padding: 0 5px;
	display: grid;
	place-items: center;
	border-radius: var(--radius-full);
	background: var(--accent);
	color: var(--fg-on-accent);
	font: 500 10.5px var(--font-mono);
}

.count {
	min-width: 18px;
	text-align: center;
	font: 500 11px var(--font-mono);
	color: var(--fg-faint);
}
</style>
