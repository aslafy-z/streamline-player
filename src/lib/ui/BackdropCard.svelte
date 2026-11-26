<script lang="ts">
import "#lib/ui/card.css";
import type { WatchInfo } from "#lib/core/watch-info.ts";
import { orPoster } from "#lib/ui/img.ts";

let {
	title,
	sub,
	eyebrow,
	backdrop,
	poster,
	posterSmall,
	info,
	leftLabel,
	size = "desktop",
	tv,
	onclick,
}: {
	title: string;
	sub?: string;
	/** "Added today", over the title. */
	eyebrow?: string;
	backdrop: string;
	/** Drawn when the title has no backdrop. */
	poster: string;
	posterSmall?: string;
	info?: WatchInfo;
	leftLabel?: string;
	size?: "desktop" | "tv" | "phone";
	tv?: { fid: string; isDefault?: boolean; onfocus?: () => void };
	onclick: () => void;
} = $props();
</script>

<div class:slp-mk--tv={size === "tv"} class:slp-mk--phone={size === "phone"}>
	<button
		type="button"
		class="slp-bd"
		class:slp-bd--tv={size === "tv"}
		data-tv={size === "tv" ? "1" : undefined}
		data-tv-default={tv?.isDefault ? "1" : undefined}
		data-fid={tv?.fid}
		aria-label={title}
		onfocus={tv?.onfocus}
		{onclick}
	>
		<span class="slp-art slp-art--wide">
			<img
				src={backdrop}
				alt=""
				loading="lazy"
				decoding="async"
				onerror={orPoster(poster, undefined, posterSmall)}
			>
			<span class="slp-bd__shade" aria-hidden="true"></span>
			{#if info?.unread}
				<span class="slp-unread" aria-hidden="true"></span>
			{/if}
			{#if info && info.left > 0}
				<span class="slp-count" role="img" aria-label={leftLabel}>{info.left}</span>
			{/if}
			{#if info?.inProgress}
				<span class="slp-prog"
					><i><b style:width="{info.pct}%"></b></i></span
				>
			{/if}
			<span class="slp-bd__txt" style:bottom="calc({info?.inProgress ? 22 : 16}px * var(--mk, 1))">
				{#if eyebrow}
					<span class="slp-bd__eyebrow">{eyebrow}</span>
				{/if}
				<span class="slp-bd__title">{title}</span>
				{#if sub}
					<span class="slp-bd__sub">{sub}</span>
				{/if}
			</span>
		</span>
	</button>
</div>
