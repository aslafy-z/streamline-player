<script lang="ts">
import "#lib/design/fonts.css";
import "#lib/design/colors.css";
import "#lib/design/elevation.css";
import "#lib/design/motion.css";
import "#lib/design/shape.css";
import "#lib/design/typography.css";
import { page } from "$app/state";
import { appPath, goto } from "#lib/ui/nav.ts";
import { toast } from "#lib/core/toast.svelte.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { formFactor, isPhone } from "#lib/platform/form-factor.svelte.ts";
import { FORM_FACTOR, IS_WEB } from "#lib/platform/target.ts";
import DesktopShell from "#lib/shells/desktop/Shell.svelte";
import Mark from "#lib/ui/Mark.svelte";
import PhoneShell from "#lib/shells/phone/Shell.svelte";
import TabletShell from "#lib/shells/tablet/Shell.svelte";
import TvShell from "#lib/shells/tv/Shell.svelte";
import { authState, init, onSignedOut } from "#platform";
import { onMount } from "svelte";

let { children } = $props();
let ready = $state(false);

const titles: Record<string, () => string> = {
	"/admin": () => i18n.server_open(),
	"/settings": () => i18n.nav_settings(),
	"/search": () => i18n.nav_search(),
	"/library/[kind]": () => (page.params.kind === "movies" ? i18n.nav_movies() : i18n.nav_shows()),
};
const title = $derived(titles[page.route.id ?? ""]?.() ?? "Streamline");

const onSignIn = () => appPath().startsWith("/signin");

const toSignIn = () => {
	const next = `${appPath()}${location.search}`;
	return goto(`/signin?next=${encodeURIComponent(next)}`, { replace: true });
};

onMount(() => {
	// A revoked key or browser session is dropped on the first 401, and said so here.
	const signedOut = onSignedOut(() => {
		if (!IS_WEB) return goto("/welcome", { replace: true });
		toast(i18n.shell_signed_out());
		return goto("/signin", { replace: true });
	});
	init()
		.then(authState)
		.then(async (s) => {
			if (s.paired) return;
			if (IS_WEB) {
				if (!onSignIn()) await toSignIn();
			} else if (appPath() !== "/welcome") await goto("/welcome", { replace: true });
		})
		.finally(() => (ready = true));
	return () => {
		signedOut.then((off) => off());
	};
});
</script>

<svelte:head><title>{title}</title></svelte:head>

{#snippet content()}
	{#if ready}
		{@render children()}
	{:else if isPhone()}
		<div class="splash"><Mark size={56} radius={14} ring={false} /></div>
	{/if}
{/snippet}

{#if FORM_FACTOR === "tv"}
	<TvShell>{@render content()}</TvShell>
{:else if isPhone()}
	<PhoneShell>{@render content()}</PhoneShell>
{:else if formFactor() === "tablet"}
	<TabletShell web={IS_WEB}>{@render content()}</TabletShell>
{:else}
	<DesktopShell web={IS_WEB}>{@render content()}</DesktopShell>
{/if}

<style>
.splash {
	position: absolute;
	inset: 0;
	display: grid;
	place-items: center;
}

:global(*),
:global(*::before),
:global(*::after) {
	box-sizing: border-box;
}

:global(html),
:global(body) {
	margin: 0;
	height: 100%;
	overflow: hidden;
	background: transparent;
	color: var(--player-ink);
	font-family: var(--font-sans);
	font-size: 14px;
	line-height: 1.5;
	-webkit-font-smoothing: antialiased;
	/* Android's webview otherwise flashes a blue box over whatever is tapped. */
	-webkit-tap-highlight-color: transparent;
}

:global(button) {
	font: inherit;
	color: inherit;
}
</style>
