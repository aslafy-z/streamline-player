<script lang="ts">
import Icon from "#lib/ui/Icon.svelte";
import { TAB_ICONS, type PhoneTab } from "#lib/shells/phone/tabs.ts";

let {
	items,
	current,
	label,
	downloadsDot = false,
	onnavigate,
}: {
	items: { id: PhoneTab; label: string }[];
	current: PhoneTab | null;
	label: string;
	downloadsDot?: boolean;
	onnavigate: (id: PhoneTab) => void;
} = $props();
</script>

<nav class="ptabs" aria-label={label}>
	{#each items as item (item.id)}
		<button
			type="button"
			class="ptab"
			aria-current={current === item.id ? "page" : undefined}
			onclick={() => onnavigate(item.id)}
		>
			<Icon name={TAB_ICONS[item.id]} />
			{item.label}
			{#if item.id === "downloads" && downloadsDot}
				<span class="dot"></span>
			{/if}
		</button>
	{/each}
</nav>

<style>
.ptabs {
	display: flex;
	min-height: calc(58px + env(safe-area-inset-bottom));
	padding-bottom: env(safe-area-inset-bottom);
	border-top: 1px solid var(--border);
	background: color-mix(in srgb, var(--bg-deep) 86%, transparent);
	-webkit-backdrop-filter: blur(16px) saturate(150%);
	backdrop-filter: blur(16px) saturate(150%);
}

.ptab {
	position: relative;
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 3px;
	min-height: 56px;
	padding: 0;
	border: 0;
	background: none;
	color: var(--fg-subtle);
	font-size: 10.5px;
	font-weight: 500;
	line-height: 1.5;
}

.ptab :global(.sl-ico) {
	font-size: 23px;
}

.ptab[aria-current="page"] {
	color: var(--fg);
}

.ptab[aria-current="page"] :global(.sl-ico) {
	stroke-width: 2;
}

.ptab[aria-current="page"]::before {
	content: "";
	position: absolute;
	top: -1px;
	left: 50%;
	width: 28px;
	height: 2px;
	margin-left: -14px;
	border-radius: 0 0 2px 2px;
	background: var(--accent);
}

.dot {
	position: absolute;
	top: 8px;
	left: 50%;
	margin-left: 8px;
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: var(--status-downloading);
	box-shadow: 0 0 0 2px var(--bg-deep);
}
</style>
