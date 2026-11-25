<script lang="ts">
import Art from "#lib/ui/Art.svelte";
import Icon from "#lib/ui/Icon.svelte";
import { HERO_MS, heroRotation, ZOOM_MS } from "#lib/ui/hero-rotation.svelte.ts";

export type Slide = {
	key: string;
	img: string;
	eyebrow: string;
	title: string;
	meta: string;
	chips: string[];
	overview: string;
	primary: string;
	progress?: { pct: number; left: string };
	onprimary: () => void;
	oninfo: () => void;
};

let {
	slides,
	height,
	padX = 56,
	titleSize = 58,
	infoLabel,
	dotLabel,
	drawnOnCpu,
}: {
	slides: Slide[];
	height: number;
	padX?: number;
	titleSize?: number;
	infoLabel: string;
	dotLabel: (title: string) => string;
	drawnOnCpu: () => Promise<boolean>;
} = $props();

const hero = heroRotation(
	() => slides.length,
	() => drawnOnCpu(),
);
const slide = $derived(slides[hero.at]);

const text = $derived(
	hero.phase === "out"
		? "opacity:0;transform:translateY(-10px);transition:opacity 240ms var(--ease-in), transform 240ms var(--ease-in)"
		: hero.phase === "pre"
			? "opacity:0;transform:translateY(18px);transition:none"
			: "opacity:1;transform:translateY(0);transition:opacity 600ms var(--ease) 80ms, transform 700ms var(--ease) 80ms",
);
</script>

{#if slide}
	<section
		class="hero"
		class:reduced={hero.reduced}
		class:coarse={!hero.smooth}
		style:height="{height}px"
		style:--hero-ms="{HERO_MS}ms"
		style:--zoom-ms="{ZOOM_MS}ms"
		use:hero.watch
	>
		{#each slides as s, i (s.key)}
			<div
				class="frame"
				class:on={i === hero.at}
				class:zoom={hero.zooms(i)}
				class:zooming={hero.zooming(i)}
				style:transform-origin={i % 2 ? "30% 40%" : "70% 35%"}
				onanimationend={hero.zoomEnded}
			>
				<Art src={s.img} position="50% 30%" />
			</div>
		{/each}
		<div class="side"></div>
		<div class="fade"></div>
		<div class="body" style:left="{padX}px" style="{text}">
			<div class="eyebrow">{slide.eyebrow}</div>
			<h1 style:font-size="{titleSize}px">{slide.title}</h1>
			<div class="meta">
				<span>{slide.meta}</span>
				{#each slide.chips as c}
					<span class="chip">{c}</span>
				{/each}
			</div>
			<p>{slide.overview}</p>
			<div class="actions">
				<button type="button" class="cta" onclick={slide.onprimary}>
					<Icon name="play" filled size={18} />{slide.primary}
				</button>
				<button type="button" class="glass" onclick={slide.oninfo}>
					<Icon name="info" size={18} />{infoLabel}
				</button>
				{#if slide.progress}
					<div class="resume">
						<i><b style:width="{slide.progress.pct}%"></b></i>{slide.progress.left}
					</div>
				{/if}
			</div>
		</div>
		{#if slides.length > 1}
			<div class="dots" style:right="{padX}px">
				{#each slides as s, i (s.key)}
					<button
						type="button"
						class="dot"
						style:width="{i === hero.at ? 44 : 18}px"
						aria-label={dotLabel(s.title)}
						onclick={() => hero.go(i)}
					>
						<span class="track"
							><span
								class="fill"
								class:run={hero.fills(i)}
								class:ticking={hero.rotating}
							></span></span
						>
					</button>
				{/each}
			</div>
		{/if}
	</section>
{/if}

<style>
.hero {
	position: relative;
	overflow: hidden;
	color: var(--player-ink);
}

.frame {
	position: absolute;
	inset: 0;
	opacity: 0;
	transition: opacity 1100ms var(--ease);
}

.frame.on {
	opacity: 1;
}

/* A paused animation keeps its frame: the backdrop stands still at the scale it had reached. */
.frame.zoom {
	animation: zoom var(--zoom-ms) linear forwards paused;
}

/* A layer of its own while it zooms, so the scrims and the text above it are not drawn again on every frame. */
.frame.zooming {
	will-change: transform;
	animation-play-state: running;
}

.reduced .frame {
	transition: none;
}

@keyframes zoom {
	to {
		transform: scale(1.08);
	}
}

.side {
	position: absolute;
	inset: 0;
	background: linear-gradient(
		90deg,
		var(--hero-scrim) 0%,
		color-mix(in srgb, var(--bg-deep) 62%, transparent) 34%,
		color-mix(in srgb, var(--bg-deep) 5%, transparent) 68%
	);
}

.fade {
	position: absolute;
	inset: 0;
	/* The second layer darkens the side the text sits on: a bright backdrop drowned the meta line and the overview. */
	background:
		linear-gradient(
			0deg,
			var(--bg-deep) 0%,
			color-mix(in srgb, var(--bg-deep) 60%, transparent) 22%,
			transparent 48%
		),
		linear-gradient(
			90deg,
			color-mix(in srgb, var(--bg-deep) 82%, transparent) 0%,
			color-mix(in srgb, var(--bg-deep) 58%, transparent) 34%,
			transparent 64%
		);
}

.body {
	position: absolute;
	bottom: 150px;
	width: min(600px, 52%);
	display: flex;
	flex-direction: column;
	gap: 14px;
	color: var(--player-ink);
	text-shadow: 0 1px 12px rgba(0, 0, 0, 0.4);
}

.eyebrow {
	display: flex;
	align-items: center;
	gap: 8px;
	font: 500 11px / 1 var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--player-accent-text);
	white-space: nowrap;
}

.eyebrow::before {
	content: "";
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--player-accent);
}

h1 {
	margin: 0;
	font-size: 58px;
	line-height: 1.02;
	font-weight: 700;
	letter-spacing: -0.03em;
	text-wrap: balance;
	/* The body is anchored to the bottom: an unclamped long title grows upward under the app bar. */
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	font: 400 12.5px var(--font-mono);
	color: var(--player-ink-muted);
}

p {
	margin: 0;
	max-width: 540px;
	font-size: 15px;
	line-height: 1.55;
	color: var(--player-ink-muted);
	text-wrap: pretty;
	display: -webkit-box;
	-webkit-line-clamp: 3;
	line-clamp: 3;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.actions {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-top: 6px;
	text-shadow: none;
}

.cta {
	display: inline-flex;
	align-items: center;
	gap: 10px;
	height: 46px;
	padding: 0 22px 0 18px;
	border: 0;
	border-radius: var(--radius-md);
	background: var(--player-accent);
	color: var(--fg-on-accent);
	font-size: 15px;
	font-weight: 600;
	cursor: pointer;
	transition:
		background 150ms,
		box-shadow 150ms,
		transform 150ms;
}

.cta:hover {
	background: var(--accent-hover);
	box-shadow: 0 0 24px color-mix(in srgb, var(--accent) 35%, transparent);
}

.cta:active {
	transform: scale(0.97);
}

.glass {
	display: inline-flex;
	align-items: center;
	gap: 9px;
	flex: none;
	white-space: nowrap;
	height: 46px;
	padding: 0 18px;
	border: 1px solid rgba(255, 255, 255, 0.16);
	border-radius: var(--radius-md);
	background: var(--player-chip);
	backdrop-filter: blur(12px);
	-webkit-backdrop-filter: blur(12px);
	color: var(--player-ink);
	font-size: 15px;
	font-weight: 500;
	cursor: pointer;
}

.glass:hover {
	background: rgba(255, 255, 255, 0.14);
}

.chip {
	padding: 2px 8px;
	border: 1px solid rgba(255, 255, 255, 0.28);
	border-radius: 6px;
	font: 400 11.5px var(--font-mono);
	color: var(--fg);
	white-space: nowrap;
}

.glass :global(.sl-ico) {
	stroke-width: 1.75;
}

.resume {
	display: flex;
	flex-direction: column;
	gap: 6px;
	width: max-content;
	min-width: 140px;
	margin-left: 10px;
	white-space: nowrap;
	font: 400 11.5px var(--font-mono);
	color: var(--player-ink-muted);
}

.resume > i {
	display: block;
	height: 3px;
	border-radius: 2px;
	background: rgba(255, 255, 255, 0.18);
	overflow: hidden;
}

.resume > i > b {
	display: block;
	height: 100%;
	background: var(--player-ink);
}

.dots {
	position: absolute;
	bottom: 156px;
	display: flex;
	gap: 6px;
}

.dot {
	height: 24px;
	padding: 0;
	border: 0;
	background: transparent;
	cursor: pointer;
	display: flex;
	align-items: center;
	transition: width 400ms var(--ease);
}

.track {
	position: relative;
	display: block;
	width: 100%;
	height: 4px;
	border-radius: 2px;
	background: color-mix(in srgb, var(--fg) 30%, transparent);
	overflow: hidden;
}

.fill {
	position: absolute;
	inset: 0;
	/* A width here lays the page out on every frame; a transform stays on the compositor. */
	transform: scaleX(0);
	transform-origin: left;
	background: var(--player-ink);
}

.fill.run {
	animation: fill var(--hero-ms) linear forwards paused;
}

.fill.run.ticking {
	animation-play-state: running;
}

/* Drawn on the CPU, every step of the bar is a whole window composed again: one a second. */
.coarse .fill.run {
	animation-timing-function: steps(8, end);
}

@keyframes fill {
	to {
		transform: scaleX(1);
	}
}
</style>
