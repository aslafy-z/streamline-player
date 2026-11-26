<script lang="ts">
import Icon from "#lib/ui/Icon.svelte";
import type { Snippet } from "svelte";

const PAGE_PX = 660;

let {
	title,
	note,
	padX = 56,
	arrows = true,
	gap = 16,
	prevLabel,
	nextLabel,
	seeAll,
	children,
}: {
	title: string;
	note?: string;
	padX?: number;
	arrows?: boolean;
	gap?: number;
	prevLabel: string;
	nextLabel: string;
	/** Library's rails: the note beside the title and a "See all" before the arrows. */
	seeAll?: { label: string; onclick: () => void };
	children: Snippet;
} = $props();

let scroller = $state<HTMLElement>();
const page = (dir: -1 | 1) =>
	scroller?.scrollBy({
		left: dir * (seeAll ? scroller.clientWidth * 0.8 : PAGE_PX),
		behavior: "smooth",
	});

let atStart = $state(true);
let atEnd = $state(true);
function measure() {
	if (!scroller) return;
	atStart = scroller.scrollLeft <= 1;
	atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1;
}
// The row's width and its cards both change what is left to scroll.
$effect(() => {
	if (!scroller) return;
	const watch = new ResizeObserver(measure);
	watch.observe(scroller);
	for (const card of scroller.children) watch.observe(card);
	return () => watch.disconnect();
});
</script>

<section aria-label={title} class:rail={!!seeAll}>
	<div class="head" style:padding="0 {padX}px">
		<h2>{title}</h2>
		{#if seeAll && note}
			<span class="rail-note">{note}</span>
		{/if}
		<div class="tools">
			{#if seeAll}
				<button type="button" class="see-all" onclick={seeAll.onclick}>{seeAll.label}</button>
			{:else if note}
				<span class="note">{note}</span>
			{/if}
			{#if arrows}
				<button
					type="button"
					class="arrow"
					aria-label={prevLabel}
					disabled={atStart}
					onclick={() => page(-1)}
				>
					<Icon name="chevron-left" size={15} stroke={2} />
				</button>
				<button
					type="button"
					class="arrow"
					aria-label={nextLabel}
					disabled={atEnd}
					onclick={() => page(1)}
				>
					<Icon name="chevron-right" size={15} stroke={2} />
				</button>
			{/if}
		</div>
	</div>
	<div
		class="scroller"
		bind:this={scroller}
		onscroll={measure}
		style:padding={seeAll ? `4px ${padX}px 8px` : `6px ${padX}px 10px`}
		style:scroll-padding="0 {padX}px"
		style:gap="{gap}px"
	>
		{@render children()}
	</div>
</section>

<style>
section {
	display: flex;
	flex-direction: column;
	gap: 14px;
}

.head {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

h2 {
	margin: 0;
	font-size: 18px;
	font-weight: 600;
	letter-spacing: -0.01em;
}

.tools {
	display: flex;
	align-items: center;
	gap: 6px;
}

.note {
	margin-right: 6px;
	font: 400 12px var(--font-mono);
	/* Home's first row sits on the hero's picture: the count needs more than the subtle grey. */
	color: var(--fg-muted);
	text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7);
	white-space: nowrap;
}

.arrow {
	width: 30px;
	height: 30px;
	display: grid;
	place-items: center;
	padding: 0;
	border-radius: 50%;
	border: 1px solid var(--border-strong);
	background: var(--player-glass);
	color: var(--fg);
	cursor: pointer;
}

.arrow:disabled {
	opacity: 0.5;
	cursor: default;
}

.arrow:hover:not(:disabled) {
	background: color-mix(in srgb, var(--player-glass-strong), white 12%);
	color: var(--fg);
}

.scroller {
	display: flex;
	overflow-x: auto;
	scroll-snap-type: x proximity;
	scrollbar-width: none;
}

.rail {
	gap: 12px;
}

.rail .head {
	justify-content: flex-start;
	align-items: baseline;
	gap: 12px;
}

.rail-note {
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
}

.rail .tools {
	align-self: center;
	margin-left: auto;
}

.see-all {
	margin-right: 6px;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--fg-muted);
	font-size: 13px;
	font-weight: 500;
	cursor: pointer;
}

.see-all:hover {
	color: var(--fg);
}

.rail .arrow {
	border: 0;
	background: color-mix(in srgb, var(--fg) 6%, transparent);
	box-shadow: inset 0 0 0 1px var(--border);
	transition:
		opacity var(--dur-fast),
		background var(--dur-fast);
}

.rail .arrow:disabled {
	opacity: 0.35;
}

.rail .arrow:hover:not(:disabled) {
	background: color-mix(in srgb, var(--fg) 12%, transparent);
}

.rail .scroller {
	scroll-snap-type: x mandatory;
}
</style>
