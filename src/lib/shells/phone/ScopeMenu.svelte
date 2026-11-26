<script lang="ts">
import { pendingPairs } from "#lib/core/admin.svelte.ts";
import { account } from "#lib/core/me.svelte.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import TitleMenu from "#lib/shells/phone/TitleMenu.svelte";
import { goto } from "#lib/ui/nav.ts";

let { here, title, host }: { here: "settings" | "admin"; title: string; host: string } = $props();
</script>

<TitleMenu
	{here}
	{title}
	label={i18n.settings_scope_label()}
	items={[
		{
			key: "settings",
			icon: "user",
			label: i18n.settings_scope_yours(),
			sub: account.me?.name ?? "",
		},
		{ key: "admin", icon: "server", label: i18n.server_open(), sub: host, badge: pendingPairs.n },
	]}
	onpick={(key) => goto(key === "admin" ? "/admin" : "/settings")}
/>
