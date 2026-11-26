<script lang="ts" module>
export { skeleton };
</script>

<script lang="ts">
import "#lib/ui/card.css";
import type { WatchInfo } from "#lib/core/watch-info.ts";
import Art from "#lib/ui/Art.svelte";
import DownloadButton from "#lib/ui/DownloadButton.svelte";
import { hold } from "#lib/ui/hold.svelte.ts";
import Icon from "#lib/ui/Icon.svelte";
import Tip from "#lib/ui/Tip.svelte";
import WatchGlyph from "#lib/ui/WatchGlyph.svelte";
import WatchMarks from "#lib/ui/WatchMarks.svelte";

type Download = {
	look: {
		icon: "arrow-down-to-line" | "circle-arrow-down" | null;
		tone: "muted" | "accent" | "progress";
		pct: number;
	};
	label: string;
	onclick: (e: MouseEvent) => void;
};
type Action = { label: string; onclick: () => void };
type Mark = Action & { on: boolean };
type Lang = { own: boolean; label: string; onclick: (trigger: HTMLElement) => void };
type Tv = { fid: string; isDefault?: boolean; onfocus?: () => void };

let {
	title,
	sub,
	note,
	src,
	small,
	badge,
	info,
	leftLabel,
	size = "desktop",
	bare = false,
	full = false,
	width,
	playLabel,
	onplay,
	reset,
	mark,
	lang,
	download,
	tv,
	nav = false,
	onclick,
}: {
	title: string;
	sub?: string;
	/** A role, between the title and the sub line. */
	note?: string;
	src?: string;
	small?: string;
	/** "New", or "2 new" for a series' new episodes. */
	badge?: string;
	/** The watch markers: bookmark, episode count, resume bar. */
	info?: WatchInfo;
	/** What the episode count reads out: "3 unwatched episodes". */
	leftLabel?: string;
	size?: "desktop" | "tv" | "phone";
	/** TV rails: the art alone, no title. */
	bare?: boolean;
	/** TV: the note and the sub line under the title too. */
	full?: boolean;
	/** A fixed width in a row; omitted, the card fills its grid cell. */
	width?: number;
	playLabel?: string;
	onplay?: () => void;
	/** Shown only while there is progress to reset. */
	reset?: Action;
	mark?: Mark;
	lang?: Lang;
	download?: Download;
	tv?: Tv;
	/** One of the items a screen's arrow keys move between (Search). */
	nav?: boolean;
	onclick: () => void;
} = $props();

const unread = $derived(!!info?.unread);
const stop = (e: Event, then: () => void) => {
	e.stopPropagation();
	then();
};
const open = (e: KeyboardEvent) => {
	if (e.key === "Enter" && e.target === e.currentTarget) onclick();
};

const has = $derived(!!(onplay || reset || mark || lang));
// Desktop draws the hover actions once the pointer or the focus first reaches the card: they are
// a third of a card's elements, and a grid holds hundreds of cards never hovered.
let woken = $state(false);
const wake = () => {
	woken = true;
};
let box = $state<HTMLElement>();
const h = hold(
	() => box,
	() => has,
);
</script>

<!-- A card's stand-in while a long list mounts: its size, from the same rules, and its title as text the browser's find can match. -->
{#snippet skeleton(title: string)}
	<div class="card skeleton">
		<span class="slp-art flat"></span>
		<span class="text">
			<span class="lines">
				<span class="title">{title}</span>
				<span class="sub">&nbsp;</span>
			</span>
		</span>
	</div>
{/snippet}

{#snippet markers()}
	{#if info}
		<WatchMarks {info} {leftLabel} />
	{/if}
	{#if badge}
		<span class="slp-new" style:left="calc({unread ? 28 : 8}px * var(--mk, 1))">{badge}</span>
	{/if}
{/snippet}

<!-- The card's own actions: over the art on hover (desktop), after a long press (phone). -->
{#snippet controls(on: boolean, play: number)}
	{#if has}
		<span class="slp-hover" class:slp-hover--on={on}>
			{#if onplay}
				<button
					type="button"
					class="slp-play"
					aria-label={playLabel}
					onclick={(e) => stop(e, onplay)}
				>
					{#if size !== "phone"}
						<Tip text={playLabel} />
					{/if}
					<Icon name="play" filled size={play} />
				</button>
			{/if}
			<span class="slp-acts">
				{#if reset}
					<button
						type="button"
						class="slp-glass"
						aria-label={reset.label}
						onclick={(e) => stop(e, reset.onclick)}
					>
						{#if size !== "phone"}
							<Tip text={reset.label} />
						{/if}
						<Icon name="rotate-ccw" />
					</button>
				{/if}
				{#if mark}
					<button
						type="button"
						class="slp-glass"
						class:on={mark.on}
						aria-label={mark.label}
						onclick={(e) => stop(e, mark.onclick)}
					>
						{#if size !== "phone"}
							<Tip text={mark.label} />
						{/if}
						<WatchGlyph on={mark.on} size={15} stroke={1.9} />
					</button>
				{/if}
				{#if lang}
					<button
						type="button"
						class="slp-glass"
						class:own={lang.own}
						data-lang-trigger="card"
						aria-label={lang.label}
						onclick={(e) => {
							e.stopPropagation();
							lang.onclick(e.currentTarget);
						}}
					>
						{#if size !== "phone"}
							<Tip text={lang.label} />
						{/if}
						<Icon name="languages" />
					</button>
				{/if}
			</span>
		</span>
	{/if}
{/snippet}

{#if size === "tv"}
	<div class="tv slp-mk--tv" style:width={width ? `${width}px` : undefined}>
		<button
			type="button"
			class="slp-art tv-art"
			data-tv="1"
			data-tv-default={tv?.isDefault ? "1" : undefined}
			data-fid={tv?.fid}
			aria-label={title}
			onfocus={tv?.onfocus}
			{onclick}
		>
			<Art {src} {small} kind="poster" />
			{@render markers()}
		</button>
		{#if !bare}
			<span class="tv-lines">
				<span class="tv-title">{title}</span>
				{#if full && note}
					<span class="tv-note">{note}</span>
				{/if}
				{#if full && sub}
					<span class="tv-sub">{sub}</span>
				{/if}
			</span>
		{/if}
	</div>
{:else if size === "phone"}
	<!-- biome-ignore lint/a11y/useSemanticElements: an <a> may not hold the card's own buttons. -->
	<div
		bind:this={box}
		class="phone slp-mk--phone"
		class:held={h.held}
		role="link"
		tabindex="0"
		style:width={width ? `${width}px` : undefined}
		aria-label={title}
		onclick={() => h.tap(onclick)}
		onkeydown={open}
		onpointerdown={h.press}
		onpointerup={h.release}
		onpointerleave={h.release}
		onpointercancel={h.cancel}
		oncontextmenu={(e) => e.preventDefault()}
	>
		<span class="slp-art">
			<Art {src} {small} kind="poster" />
			{@render controls(h.held, 16)}
			{@render markers()}
		</span>
		<span class="phone-lines">
			<span class="phone-title">{title}</span>
			{#if full && note}
				<span class="phone-note">{note}</span>
			{/if}
			{#if full && sub}
				<span class="phone-sub">{sub}</span>
			{/if}
		</span>
	</div>
{:else}
	<!-- biome-ignore lint/a11y/useSemanticElements: an <a> may not hold the card's own buttons. -->
	<div
		class="card"
		role="link"
		tabindex="0"
		data-nav={nav ? "" : undefined}
		aria-label={title}
		style:width={width ? `${width}px` : undefined}
		{onclick}
		onkeydown={open}
		onpointerenter={wake}
		onfocusin={wake}
	>
		<span class="slp-art desk-art">
			<Art {src} {small} kind="poster" />
			{#if woken}
				{@render controls(false, 20)}
			{/if}
			{@render markers()}
		</span>
		<span class="text">
			<span class="lines">
				<span class="title">{title}</span>
				{#if note}
					<span class="note">{note}</span>
				{/if}
				{#if sub}
					<span class="sub">{sub}</span>
				{/if}
			</span>
			{#if download}
				<span class="dl">
					<DownloadButton
						variant="poster"
						look={download.look}
						label={download.label}
						onclick={(e) => {
							e.stopPropagation();
							download.onclick(e);
						}}
					/>
				</span>
			{/if}
		</span>
	</div>
{/if}

<style>
.card {
	position: relative;
	flex: none;
	display: flex;
	flex-direction: column;
	gap: 9px;
	min-width: 0;
	color: var(--fg);
	text-align: left;
	cursor: pointer;
	outline: none;
	scroll-snap-align: start;
}

.desk-art {
	transition:
		box-shadow var(--dur-fast),
		transform var(--dur-fast);
}

.desk-art:hover {
	box-shadow: var(--shadow-card-hover);
	transform: scale(1.03);
}

.card:focus-visible .desk-art {
	box-shadow: 0 0 0 2px var(--accent);
}

.slp-glass {
	color: var(--fg);
}

.slp-glass.on {
	color: var(--status-available);
}

.slp-glass.own {
	color: var(--accent-text);
}

.text {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	min-width: 0;
}

.lines {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 1px;
	min-width: 0;
}

.title,
.note,
.sub {
	white-space: nowrap;
	/* clip, not hidden: WebKit gives every overflow: hidden box a layer, and walks them all on
	   each frame it draws. A grid holds hundreds of these lines. */
	overflow: clip;
	text-overflow: ellipsis;
}

.title {
	font-size: 13.5px;
	font-weight: 500;
	line-height: 1.35;
}

.note {
	font-size: 12.5px;
	line-height: 1.35;
	color: var(--fg-muted);
}

.sub {
	font: 400 11.5px / 1.4 var(--font-mono);
	color: var(--fg-subtle);
}

.dl {
	flex: none;
	margin: -4px -8px 0 0;
}

.tv {
	flex: none;
	display: flex;
	flex-direction: column;
	gap: 14px;
	min-width: 0;
}

.tv-art {
	padding: 0;
	border: 0;
	cursor: pointer;
	outline: none;
	transition:
		transform 220ms var(--ease),
		box-shadow 220ms;
}

.tv-art:focus {
	transform: translateY(-10px);
	box-shadow: var(--shadow-tv-focus);
}

.tv-lines {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
}

.tv-title,
.tv-note,
.tv-sub {
	white-space: nowrap;
	overflow: clip;
	text-overflow: ellipsis;
}

.tv-title {
	font-size: 24px;
	font-weight: 500;
}

.tv-note {
	font-size: 21px;
	color: var(--fg-muted);
}

.tv-sub {
	font: 400 19px var(--font-mono);
	color: var(--fg-subtle);
}

.phone {
	flex: none;
	display: flex;
	flex-direction: column;
	gap: 6px;
	width: 100%;
	min-width: 0;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--fg);
	text-align: left;
	cursor: pointer;
	scroll-snap-align: start;
	outline: none;
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
	-webkit-tap-highlight-color: transparent;
}

/* A long press lifts the poster first; its controls come in once it has grown. */
.phone .slp-art {
	transition:
		transform 200ms var(--ease),
		box-shadow 200ms var(--ease);
}

.phone.held .slp-art {
	z-index: 2;
	transform: scale(1.08);
	/* Not the hover shadow: its accent ring reads as a selection. */
	box-shadow: var(--shadow-2);
}

.phone-lines {
	display: flex;
	flex-direction: column;
	gap: 1px;
	min-width: 0;
}

.phone-title,
.phone-note,
.phone-sub {
	white-space: nowrap;
	overflow: clip;
	text-overflow: ellipsis;
}

.phone-title {
	font-size: 12px;
	font-weight: 500;
	line-height: 1.3;
}

.phone-note {
	font-size: 11px;
	line-height: 1.3;
	color: var(--fg-subtle);
}

.phone-sub {
	font: 400 10.5px / 1.4 var(--font-mono);
	color: var(--fg-subtle);
}

/* No layer at all in a skeleton: a long list is mostly skeletons, and WebKit walks every layer
   on each frame it draws. */
.skeleton {
	position: static;
	cursor: default;
}

.flat {
	position: static;
	overflow: visible;
}

/* Transparent, not hidden: find-in-page skips text under visibility: hidden or display: none. */
.skeleton .title,
.skeleton .sub {
	color: transparent;
	background: linear-gradient(var(--surface-2), var(--surface-2)) left center / 70% 9px no-repeat;
}

.skeleton .sub {
	background-size: 40% 7px;
}
</style>
