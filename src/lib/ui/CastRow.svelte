<script lang="ts">
import Icon from "#lib/ui/Icon.svelte";

const PAGE_PX = 496;

export type Member = {
	id: string;
	name: string;
	character: string;
	photo: string;
	initials: string;
	bg: string;
	fg: string;
};

let {
	title,
	count,
	members,
	padX = 56,
	arrows = true,
	prevLabel,
	nextLabel,
	onopen,
}: {
	title: string;
	count: number;
	members: Member[];
	padX?: number;
	arrows?: boolean;
	prevLabel: string;
	nextLabel: string;
	onopen: (id: string) => void;
} = $props();

let broken = $state<Record<string, boolean>>({});

let scroller = $state<HTMLElement>();
const page = (dir: -1 | 1) => scroller?.scrollBy({ left: dir * PAGE_PX, behavior: "smooth" });

let atStart = $state(true);
let atEnd = $state(true);
function measure() {
	if (!scroller) return;
	atStart = scroller.scrollLeft <= 1;
	atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1;
}
// The row's width and its members both change what is left to scroll.
$effect(() => {
	if (!scroller) return;
	void members;
	const watch = new ResizeObserver(measure);
	watch.observe(scroller);
	return () => watch.disconnect();
});
</script>

<section>
	<div class="cast-head">
		<h2>{title}</h2>
		<span class="count">{count}</span>
		<!-- A mouse has no other way along a row whose scrollbar is hidden. -->
		{#if arrows && !(atStart && atEnd)}
			<div class="tools">
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
			</div>
		{/if}
	</div>
	<div
		class="row"
		bind:this={scroller}
		onscroll={measure}
		style:margin="0 -{padX}px"
		style:padding="0 {padX - 6}px 4px"
	>
		{#each members as c, i (`${c.id}:${i}`)}
			<button type="button" class="castc" onclick={() => onopen(c.id)}>
				<span class="img" style:background={c.bg} style:color={c.fg}>
					{#if !broken[c.id]}
						<img
							src={c.photo}
							alt=""
							loading="lazy"
							decoding="async"
							onerror={() => (broken[c.id] = true)}
						>
					{:else}
						{c.initials}
					{/if}
				</span>
				<span class="who">
					<span class="n">{c.name}</span>
					<span class="r">{c.character}</span>
				</span>
			</button>
		{/each}
	</div>
</section>

<style>
section {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.cast-head {
	display: flex;
	align-items: baseline;
	gap: 12px;
}

h2 {
	margin: 0;
	font-size: 18px;
	font-weight: 600;
}

.count {
	font: 400 12px var(--font-mono);
	color: var(--fg-subtle);
}

.tools {
	margin-left: auto;
	display: flex;
	gap: 8px;
	align-self: center;
}

.arrow {
	width: 30px;
	height: 30px;
	display: grid;
	place-items: center;
	padding: 0;
	border-radius: 50%;
	border: 1px solid var(--border-strong);
	background: transparent;
	color: var(--fg-muted);
	cursor: pointer;
}

.arrow:disabled {
	opacity: 0.35;
	cursor: default;
}

.arrow:hover:not(:disabled) {
	background: color-mix(in srgb, var(--fg) 8%, transparent);
	color: var(--fg);
}

.row {
	display: flex;
	gap: 4px;
	overflow-x: auto;
	scrollbar-width: none;
}

.castc {
	flex: none;
	width: 124px;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 10px;
	padding: 10px 6px 12px;
	border: 0;
	border-radius: 14px;
	background: none;
	color: var(--fg);
	text-align: center;
	cursor: pointer;
}

.castc:hover {
	background: var(--surface);
}

.img {
	position: relative;
	display: grid;
	place-items: center;
	width: 84px;
	height: 84px;
	border-radius: 50%;
	overflow: hidden;
	font-size: 27px;
	font-weight: 600;
	letter-spacing: -0.01em;
	box-shadow: 0 0 0 1px var(--border);
}

.img img {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.who {
	display: flex;
	flex-direction: column;
	gap: 3px;
	width: 100%;
	min-width: 0;
}

.n,
.r {
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.n {
	font-size: 13.5px;
	font-weight: 600;
	line-height: 1.3;
}

.r {
	font-size: 12px;
	line-height: 1.35;
	color: var(--fg-subtle);
}
</style>
