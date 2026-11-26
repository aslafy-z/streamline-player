<script lang="ts">
import { dl } from "#lib/core/downloads.svelte.ts";
import { type Halt, haltFor } from "#lib/core/playback/halt.ts";
import type { HaltViewModel } from "#lib/core/player-panels.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { isPhone } from "#lib/platform/form-factor.svelte.ts";
import HaltOverlay from "#lib/ui/HaltOverlay.svelte";
import { goto } from "#lib/ui/nav.ts";
import { canDownload, PLAYER_NAME, serverHost } from "#platform";
import { onMount } from "svelte";

/** A screen that could not load its data: the player's error screen in its place, retrying by itself. */
let {
	error,
	retry,
	title = i18n.home_error_title(),
}: { error: string; retry: () => unknown; title?: string } = $props();

let halt = $state.raw<Halt | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;

onMount(() => {
	serverHost().then((host) => {
		// svelte-ignore state_referenced_locally
		const { halt: h, retryIn } = haltFor(error, { host }, PLAYER_NAME);
		halt = retryIn ? { ...h, left: retryIn, total: retryIn } : h;
		if (!retryIn) return;
		timer = setInterval(() => {
			if (!halt?.left) return;
			if (halt.left <= 1) retry();
			else halt = { ...halt, left: halt.left - 1 };
		}, 1000);
	});
	return () => clearInterval(timer);
});

const view = $derived.by<HaltViewModel | null>(() => {
	if (!halt) return null;
	// The server answered with a refusal: its own words are for a log, not for the viewer.
	const refused = halt.kind === "error";
	return {
		kind: halt.kind,
		failed: halt.failed,
		icon: halt.icon,
		eyebrow: refused ? i18n.halt_unreachable_eyebrow() : halt.eyebrow,
		title: refused ? title : halt.title,
		body: refused ? i18n.home_error_server() : halt.body,
		wait: halt.wait,
		countdown:
			halt.count && halt.left && halt.total
				? { text: halt.count(halt.left), fraction: halt.left / halt.total }
				: undefined,
		actions: [
			{ id: "retry", label: halt.retryLabel ?? i18n.halt_try_now(), primary: true },
			...(canDownload && dl.items.some((e) => e.state === "done")
				? [{ id: "downloads", label: i18n.dl_watch() }]
				: []),
			...(history.length > 1 ? [{ id: "back", label: i18n.common_back() }] : []),
		],
	};
});

function act(id: string) {
	if (id === "retry") retry();
	else if (id === "downloads") goto("/downloads");
	else history.back();
}
</script>

{#if view}
	<div class="failed" class:phone={isPhone()}>
		<HaltOverlay {view} onaction={act} onalt={() => {}} />
	</div>
{/if}

<style>
.failed {
	position: fixed;
	inset: 0;
	z-index: 40;
}

.failed.phone :global(.zoom) {
	zoom: 0.85;
	padding: 0 70px;
}
</style>
