<script lang="ts">
import Icon from "#lib/ui/Icon.svelte";
import { cardSrcset } from "#lib/ui/img.ts";

let {
	src,
	small,
	ratio,
	kind = "backdrop",
	position,
	fallback,
}: {
	src?: string;
	/** A card-sized `src`, see `cardSrcset`. */
	small?: string;
	ratio?: string;
	kind?: "poster" | "backdrop";
	position?: string;
	/** Shown blurred when `src` cannot load: a title with no backdrop still gets its poster's colours. */
	fallback?: string;
} = $props();

let failed = $state(false);
// Offline, a downloaded title has only its full poster.
let smallFailed = $state(false);
let softReady = $state(false);
let loaded = $state(false);
let img = $state<HTMLImageElement>();

$effect(() => {
	src;
	failed = false;
	smallFailed = false;
	loaded = false;
	softReady = false;
});
// A cached image can finish before the handlers are attached. `complete` alone is no verdict:
// WebKit also says it of an image it has put off loading, with no size yet, which is left to the
// handlers. Not `decode()`: on a screen of cached posters it decoded them all before the first
// frame, a second of freeze; shown undecoded, each decodes off the main thread.
$effect(() => {
	src;
	if (img?.complete && img.naturalWidth > 0) loaded = true;
});
</script>

<span class="art" class:sized={!!ratio} style:aspect-ratio={ratio}>
	{#if kind === "poster"}
		<span class="ph"><Icon name="film" /></span>
	{:else}
		<span class="frame" aria-hidden="true"></span>
	{/if}
	{#if src && !failed}
		<img
			bind:this={img}
			{src}
			srcset={smallFailed ? undefined : cardSrcset(small, src)}
			alt=""
			draggable="false"
			loading="lazy"
			decoding="async"
			class:loaded
			style:object-position={position}
			onload={() => (loaded = true)}
			onerror={() => {
				if (small && !smallFailed) smallFailed = true;
				else failed = true;
			}}
		>
	{:else if fallback && failed}
		<img
			src={fallback}
			alt=""
			draggable="false"
			class="soft"
			class:loaded={softReady}
			onload={() => (softReady = true)}
		>
	{/if}
</span>

<style>
/* One layer for the whole stack: the placeholder and the picture share a grid cell instead of
   each being positioned, and nothing is overflow: hidden. WebKit walks every layer on each frame
   it draws, and a screen holds hundreds of these. */
.art {
	position: absolute;
	inset: 0;
	display: grid;
	overflow: clip;
}

.art > :global(*) {
	grid-area: 1 / 1;
	min-width: 0;
	min-height: 0;
}

.art.sized {
	position: relative;
	inset: auto;
	width: 100%;
}

/* Two soft glows, as gradients: drawn as blurred shapes (filter: blur) they cost a filter layer
   each per picture, and a season of episodes froze the page for seconds. */
.frame {
	background:
		radial-gradient(
			ellipse 70% 62% at 76% 42%,
			color-mix(in srgb, var(--accent) 11%, transparent),
			transparent
		),
		radial-gradient(
			ellipse 75% 66% at 28% 92%,
			color-mix(in srgb, var(--status-wanted) 8%, transparent),
			transparent
		),
		var(--bg-stage);
}

.ph {
	display: grid;
	place-items: center;
	font-size: 40px;
	color: var(--fg-faint);
}

img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
	/* Not opacity: 0, which gives the image a layer until it loads. Each picture arriving then
	   changed the layer tree, and WebKit recomputed it for the whole page. */
	visibility: hidden;
	/* Android WebView turns a held image into its own drag or save menu and cancels the pointer. */
	pointer-events: none;
	-webkit-touch-callout: none;
}

img.loaded {
	visibility: visible;
}

img.soft {
	filter: blur(36px) saturate(1.3);
	transform: scale(1.25);
}
</style>
