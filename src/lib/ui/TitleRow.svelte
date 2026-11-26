<script lang="ts" module>
export { skeleton };
</script>

<script lang="ts">
import "#lib/ui/card.css";
import type { WatchInfo } from "#lib/core/watch-info.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import DownloadButton from "#lib/ui/DownloadButton.svelte";
import Icon from "#lib/ui/Icon.svelte";
import { cardSrcset, orFull } from "#lib/ui/img.ts";
import Tip from "#lib/ui/Tip.svelte";
import WatchGlyph from "#lib/ui/WatchGlyph.svelte";
import type { ComponentProps } from "svelte";

type Action = { label: string; onclick: () => void };

let {
	title,
	poster,
	small,
	info,
	leftLabel,
	year,
	res,
	hdr,
	hdrOn,
	audio,
	size,
	added,
	playLabel,
	reset,
	mark,
	lang,
	download,
	onplay,
	onclick,
}: {
	title: string;
	poster?: string;
	small?: string;
	info: WatchInfo;
	leftLabel?: string;
	year: string;
	res: string;
	hdr: string;
	hdrOn: boolean;
	audio: string;
	size: string;
	added: string;
	playLabel?: string;
	reset?: Action;
	mark?: Action & { on: boolean };
	lang?: { own: boolean; label: string; onclick: (trigger: HTMLElement) => void };
	download?: Pick<ComponentProps<typeof DownloadButton>, "look" | "label" | "onclick">;
	onplay?: () => void;
	onclick: () => void;
} = $props();

let broken = $state(false);

const line = $derived(
	info.watched
		? { icon: "check-check" as const, tone: "watched", text: i18n.library_watched() }
		: info.pct
			? {
					icon: "circle-play" as const,
					tone: "progress",
					text: i18n.row_state_progress({ pct: info.pct }),
				}
			: {
					icon: "eye" as const,
					tone: "",
					text: info.unread ? i18n.row_state_unread() : i18n.row_state_started(),
				},
);
</script>

<!-- A row's stand-in while a long list mounts: its size, from the same rules, and its title as text the browser's find can match. -->
{#snippet skeleton(title: string)}
	<div class="row skeleton">
		<span class="thumb slp-art slp-mk--thumb flat"></span>
		<span class="main">
			<span class="title">{title}</span>
		</span>
	</div>
{/snippet}

<div class="row">
	<button type="button" class="hit" aria-label={title} {onclick}></button>
	<span class="thumb slp-art slp-mk--thumb">
		{#if poster && !broken}
			<img
				src={poster}
				srcset={cardSrcset(small, poster)}
				alt=""
				loading="lazy"
				decoding="async"
				onerror={orFull(() => (broken = true))}
			>
		{/if}
		{#if info.unread}
			<span class="slp-unread" aria-hidden="true"></span>
		{/if}
	</span>
	<span class="main">
		<span class="title">{title}</span>
		<span class="state {line.tone}">
			<Icon name={line.icon} size={12} stroke={2.2} />{line.text}
			{#if info.left > 0}
				<span class="slp-count slp-count--inline" role="img" aria-label={leftLabel}
					>{info.left}</span
				>
			{/if}
			{#if info.inProgress}
				<span class="slp-track"><b style:width="{info.pct}%"></b></span>
			{/if}
		</span>
	</span>
	<span class="cell muted">{year}</span>
	<span class="cell">{res}</span>
	<span class="cell" class:faint={!hdrOn}>{hdr}</span>
	<span class="cell muted clip">{audio}</span>
	<span class="cell muted end">{size}</span>
	<span class="cell subtle end">{added}</span>
	<span class="tools">
		{#if onplay}
			<button type="button" class="tool play" aria-label={playLabel} onclick={onplay}>
				<Tip text={playLabel} />
				<Icon name="play" filled size={15} />
			</button>
		{/if}
		{#if reset}
			<button type="button" class="tool" aria-label={reset.label} onclick={reset.onclick}>
				<Tip text={reset.label} />
				<Icon name="rotate-ccw" size={15} stroke={1.8} />
			</button>
		{/if}
		{#if mark}
			<button
				type="button"
				class="tool mark"
				class:on={mark.on}
				aria-label={mark.label}
				onclick={mark.onclick}
			>
				<Tip text={mark.label} />
				<WatchGlyph on={mark.on} size={15} stroke={1.8} />
			</button>
		{/if}
		{#if lang}
			<button
				type="button"
				class="tool"
				class:own={lang.own}
				data-lang-trigger="lib"
				aria-label={lang.label}
				onclick={(e) => lang.onclick(e.currentTarget)}
			>
				<Tip text={lang.label} />
				<Icon name="languages" size={15} stroke={1.8} />
			</button>
		{/if}
		{#if download}
			<DownloadButton
				variant="row"
				look={download.look}
				label={download.label}
				onclick={download.onclick}
			/>
		{/if}
	</span>
</div>

<style>
.row {
	position: relative;
	display: grid;
	grid-template-columns: var(--cols);
	gap: 16px;
	align-items: center;
	min-height: 62px;
	padding: 8px 12px;
	border: 0;
	border-bottom: 1px solid var(--border);
	border-radius: 0;
	background: transparent;
	color: var(--fg);
	text-align: left;
}

.row:hover {
	background: var(--surface);
}

/* The whole row opens the title; the tools sit above it and keep their own clicks. */
.hit {
	position: absolute;
	inset: 0;
	padding: 0;
	border: 0;
	background: transparent;
	cursor: pointer;
}

.hit:focus-visible {
	outline: 2px solid var(--accent-ring);
	outline-offset: -2px;
}

.row > span {
	pointer-events: none;
}

.tools {
	position: relative;
	display: flex;
	justify-content: flex-end;
	align-items: center;
	gap: 2px;
}

.tools > :global(*) {
	pointer-events: auto;
}

.tool {
	flex: none;
	width: 32px;
	height: 32px;
	display: grid;
	place-items: center;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: transparent;
	color: var(--fg-subtle);
	cursor: pointer;
}

.tool:hover {
	background: var(--surface-2);
	color: var(--fg);
}

.tool.play {
	color: var(--fg);
}

.tool.play :global(.sl-ico) {
	margin-left: 2px;
}

/* The watch glyph's ring is placed against its button; the other tools need no layer. */
.tool.mark {
	position: relative;
	transition: color 180ms;
}

.tool.mark:hover {
	color: var(--fg-subtle);
}

.tool.on,
.tool.on:hover {
	color: var(--status-available);
}

.tool.own {
	color: var(--accent);
}

.thumb {
	width: 32px;
}

.main {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
}

.title {
	font-size: 14px;
	font-weight: 500;
	white-space: nowrap;
	overflow: clip;
	text-overflow: ellipsis;
}

.state {
	display: flex;
	align-items: center;
	gap: 8px;
	font: 400 11px var(--font-mono);
	color: var(--fg-subtle);
	white-space: nowrap;
}

.state.watched {
	color: var(--status-available);
}

.state.progress {
	color: var(--accent-text);
}

.cell {
	font: 400 12px var(--font-mono);
	color: var(--fg);
	white-space: nowrap;
}

.muted {
	color: var(--fg-muted);
}

.subtle {
	color: var(--fg-subtle);
}

.faint {
	color: var(--fg-faint);
}

.clip {
	overflow: clip;
	text-overflow: ellipsis;
}

.end {
	text-align: right;
}

/* No layer at all in a skeleton: a long list is mostly skeletons, and WebKit walks every layer
   on each frame it draws. */
.row.skeleton,
.flat {
	position: static;
}

.flat {
	overflow: visible;
}

.row.skeleton:hover {
	background: transparent;
}

/* Transparent, not hidden: find-in-page skips text under visibility: hidden or display: none. */
.skeleton .title {
	color: transparent;
	background: linear-gradient(var(--surface-2), var(--surface-2)) left center / 100% 9px no-repeat;
}
</style>
