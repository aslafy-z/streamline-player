<script lang="ts">
import { dismiss } from "#lib/ui/dismiss.ts";
import Icon, { type IconName } from "#lib/ui/Icon.svelte";
import { presence } from "#lib/ui/presence.svelte.ts";

/** A page title that opens a menu of the page's siblings: the title names the one shown. */
let {
	here,
	title,
	label,
	items,
	width = 300,
	onpick,
}: {
	here: string;
	title: string;
	label: string;
	items: { key: string; icon: IconName; label: string; sub: string; badge?: number }[];
	width?: number;
	onpick: (key: string) => void;
} = $props();

let open = $state(false);
const menu = presence(() => open, 150);

function pick(key: string) {
	open = false;
	if (key !== here) onpick(key);
}
</script>

<div class="scope" use:dismiss={() => (open = false)}>
	<h1>
		<button
			type="button"
			class="title"
			class:open
			aria-haspopup="menu"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			{title}
			<span class="chev"><Icon name="chevron-down" size={18} stroke={2} /></span>
		</button>
	</h1>
	{#if menu.mounted}
		<div
			class="menu"
			class:shown={menu.shown && open}
			role="menu"
			aria-label={label}
			style:width="{width}px"
		>
			{#each items as o (o.key)}
				<button
					type="button"
					role="menuitemradio"
					aria-checked={o.key === here}
					class:on={o.key === here}
					onclick={() => pick(o.key)}
				>
					<span class="ico"><Icon name={o.icon} size={16} stroke={1.75} /></span>
					<span class="text">
						<span class="label">{o.label}</span>
						<span class="sub">{o.sub}</span>
					</span>
					{#if o.badge}
						<span class="badge">{o.badge}</span>
					{/if}
					<span class="check" class:on={o.key === here}
						><Icon name="tick" size={14} stroke={2.5} /></span
					>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
.scope {
	position: relative;
	align-self: flex-start;
	max-width: 100%;
}

h1 {
	margin: 0;
	font-size: var(--title-size, 30px);
	font-weight: 700;
	letter-spacing: -0.025em;
}

.title {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	margin: -4px -8px;
	padding: 4px 8px;
	border: 0;
	border-radius: var(--radius-md);
	background: transparent;
	font: inherit;
	letter-spacing: inherit;
	color: var(--fg);
	cursor: pointer;
	white-space: nowrap;
}

.title.open {
	background: var(--surface);
}

.chev {
	display: inline-flex;
	color: var(--fg-subtle);
	transition: transform var(--dur-base) var(--ease);
}

.open .chev {
	transform: rotate(180deg);
}

.menu {
	position: absolute;
	left: -8px;
	top: calc(100% + 8px);
	z-index: 30;
	max-width: calc(100vw - 32px);
	box-sizing: border-box;
	padding: 6px;
	border-radius: 12px;
	background: var(--bg-elevated);
	border: 1px solid var(--border-strong);
	box-shadow: var(--shadow-4);
	transform-origin: top left;
	opacity: 0;
	transform: translateY(-6px) scale(0.97);
	pointer-events: none;
	transition:
		opacity 130ms var(--ease-in),
		transform 150ms var(--ease-in);
}

.menu.shown {
	opacity: 1;
	transform: none;
	pointer-events: auto;
	transition:
		opacity 160ms var(--ease),
		transform 220ms var(--ease);
}

.menu button {
	width: 100%;
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 8px 10px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--fg);
	text-align: left;
	cursor: pointer;
}

.menu button.on {
	background: var(--surface);
}

.ico {
	flex: none;
	width: 32px;
	height: 32px;
	border-radius: 9px;
	display: grid;
	place-items: center;
	background: var(--bg-deep);
	border: 1px solid var(--border);
	color: var(--accent-text);
}

.text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 1px;
}

.label {
	font-size: 13.5px;
	font-weight: 500;
	white-space: nowrap;
}

.sub {
	font: 400 11px var(--font-mono);
	color: var(--fg-subtle);
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

.check {
	flex: none;
	width: 14px;
	color: var(--accent);
	opacity: 0;
}

.check.on {
	opacity: 1;
}
</style>
