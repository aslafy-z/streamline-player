<script lang="ts">
import Icon from "#lib/ui/Icon.svelte";

/** Picks a whole group at once: ticked when all of it is picked, a dash when part of it is. */
let {
	state,
	label,
	margin,
	onclick,
}: {
	state: "true" | "mixed" | "false";
	label: string;
	margin?: string;
	onclick: () => void;
} = $props();
</script>

<!-- biome-ignore lint/a11y/useSemanticElements: a native checkbox has no mixed look to restyle. -->
<button
	type="button"
	class="tri"
	style:margin
	role="checkbox"
	aria-checked={state === "mixed" ? "mixed" : state === "true"}
	aria-label={label}
	{onclick}
>
	<span class="box" class:on={state === "true"} class:part={state === "mixed"} aria-hidden="true">
		<Icon name="tick" size={13} stroke={3} />
		<Icon name="minus" size={13} stroke={3} />
	</span>
</button>

<style>
.tri {
	flex: none;
	width: 32px;
	height: 32px;
	display: grid;
	place-items: center;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: transparent;
	cursor: pointer;
}

.box {
	width: 24px;
	height: 24px;
	display: grid;
	place-items: center;
	box-sizing: border-box;
	border-radius: 50%;
	border: 2px solid var(--pick-line, rgba(255, 255, 255, 0.85));
	color: var(--fg-on-accent);
	transition:
		background 150ms var(--ease),
		border-color 150ms var(--ease);
}

.box :global(.sl-ico) {
	grid-area: 1 / 1;
	opacity: 0;
}

.box.on {
	border-color: var(--accent);
	background: var(--accent);
}

.box.on :global(.sl-ico:first-child) {
	opacity: 1;
}

.box.part {
	border-color: var(--accent);
	background: var(--accent-soft);
}

.box.part :global(.sl-ico:last-child) {
	opacity: 1;
	color: var(--accent-text);
}
</style>
