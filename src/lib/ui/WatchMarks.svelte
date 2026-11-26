<script lang="ts">
import "#lib/ui/card.css";
import type { WatchInfo } from "#lib/core/watch-info.ts";
import { m as i18n } from "#lib/paraglide/messages.js";

let {
	info,
	leftLabel = i18n.card_left_label({ count: info.left }),
}: { info: WatchInfo; leftLabel?: string } = $props();
</script>

{#if info.unread}
	<span class="slp-unread" aria-hidden="true"></span>
{/if}
{#if info.left > 0}
	<span class="slp-count" role="img" aria-label={leftLabel}>{info.left}</span>
{/if}
{#if info.inProgress}
	<span class="slp-prog"
		><i><b style:width="{info.pct}%"></b></i></span
	>
{/if}
