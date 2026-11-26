<script lang="ts">
import { isPhone, isTablet } from "#lib/platform/form-factor.svelte.ts";
import { SignInError, type SignInErrorCode } from "#lib/core/auth.ts";
import type { AuthMethods } from "#lib/core/types.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { IS_WEB } from "#lib/platform/target.ts";
import PhoneOnboarding from "#lib/screens/phone/Onboarding.svelte";
import Icon from "#lib/ui/Icon.svelte";
import Mark from "#lib/ui/Mark.svelte";
import { authMethods, serverHost, startSignIn } from "#platform";
import { onMount } from "svelte";

let {
	next,
	failed = null,
	done,
	change,
}: {
	next: string;
	failed?: string | null;
	done: (signedIn?: { name: string }) => void;
	/** An app's way back to the server step; the web player has no other server. */
	change?: () => void;
} = $props();

let methods = $state<AuthMethods | null>(null);
let host = $state("");
let busy = $state(false);
let code = $state<SignInErrorCode | null>(null);

const COPY: Record<SignInErrorCode, () => string> = {
	denied: () => i18n.signin_error_denied(),
	state: () => i18n.signin_error_expired(),
	invalid_grant: () => i18n.signin_error_expired(),
	network: () => i18n.signin_error_network({ host }),
};
const KNOWN = Object.keys(COPY) as SignInErrorCode[];
const known = (c: unknown): c is SignInErrorCode => (KNOWN as unknown[]).includes(c);

const error = $derived(code ? COPY[code]() : "");
const phone = $derived(isPhone());

async function signIn() {
	// An app may click again while its browser tab waits: the newer round trip replaces the older.
	if (busy && IS_WEB) return;
	busy = true;
	code = null;
	try {
		const signedIn = await startSignIn(next);
		busy = false;
		done(signedIn ?? undefined);
	} catch (e) {
		const c = e instanceof SignInError ? e.code : String(e);
		if (c === "replaced") return;
		busy = false;
		code = known(c) ? c : "network";
	}
}

onMount(() => {
	if (known(failed)) code = failed;
	serverHost().then((h) => (host = h));
	authMethods()
		.then((v) => (methods = v))
		.catch(() => {
			methods = { register_url: null };
			code = "network";
		});
});
</script>

{#if phone}
	{#if methods}
		<PhoneOnboarding
			kind="signin"
			{host}
			step={!IS_WEB}
			lead={IS_WEB ? i18n.signin_lead({ host }) : i18n.signin_phone_lead()}
			note={IS_WEB ? i18n.signin_note() : i18n.signin_note_app()}
			{error}
			{busy}
			busyLabel={IS_WEB ? i18n.signin_continue_busy() : i18n.welcome_finish_in_browser()}
			onsignin={signIn}
			onchange={change}
			register={methods.register_url ? { url: methods.register_url } : undefined}
		/>
	{/if}
{:else}
	<div class="page" style:padding-top="{isTablet() ? 24 : 36}px">
		<div class="glow"></div>
		{#if methods}
			<div class="col">
				<div class="card">
					<header>
						<Mark size={48} />
						<span class="brand">{IS_WEB ? "Streamline" : i18n.welcome_step_2()}</span>
						<h1>{i18n.signin_title()}</h1>
						<p class="lead">{i18n.signin_lead({ host })}</p>
					</header>
					{#if error}
						<p class="error" role="alert">{error}</p>
					{/if}
					<button type="button" class="primary sso" onclick={signIn}>
						{#if busy}
							<span class="spin"></span>
						{:else}
							<Icon name="key-round" size={18} stroke={1.9} />
						{/if}
						{busy
							? IS_WEB
								? i18n.signin_continue_busy()
								: i18n.welcome_finish_in_browser()
							: i18n.signin_continue()}
					</button>
					<p class="note">{IS_WEB ? i18n.signin_note() : i18n.signin_note_app()}</p>
					{#if change}
						<span class="where">
							<Icon name="server" size={13} stroke={2} />{host}
							<button type="button" class="link" onclick={change}>{i18n.welcome_change()}</button>
						</span>
					{/if}
				</div>
				{#if methods.register_url}
					<p class="register">
						{i18n.signin_no_account()}<a href={methods.register_url}>{i18n.signin_create()}</a>
					</p>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
.page {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 36px 24px 24px;
	overflow: hidden;
	background: var(--bg-deep);
	color: var(--fg);
}

.glow {
	position: absolute;
	left: 50%;
	top: -180px;
	width: 900px;
	height: 900px;
	margin-left: -450px;
	border-radius: 50%;
	background: radial-gradient(
		closest-side,
		color-mix(in srgb, var(--accent) 22%, transparent),
		color-mix(in srgb, var(--accent) 6%, transparent) 55%,
		transparent 100%
	);
	pointer-events: none;
}

.col {
	position: relative;
	width: 420px;
	display: flex;
	flex-direction: column;
	gap: 20px;
	animation: sl-rise var(--dur-slow) var(--ease);
}

.card {
	display: flex;
	flex-direction: column;
	padding: 34px 34px 30px;
	border-radius: var(--radius-xl);
	background: color-mix(in srgb, var(--bg-elevated) 95%, transparent);
	border: 1px solid var(--border);
	box-shadow: var(--shadow-4);
}

header {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 12px;
	margin-bottom: 24px;
	text-align: center;
}

.brand {
	font: 500 10px var(--font-mono);
	letter-spacing: 0.18em;
	text-transform: uppercase;
	color: var(--fg-faint);
}

h1 {
	margin: 0;
	font-size: 21px;
	font-weight: 600;
	letter-spacing: -0.02em;
}

.lead {
	margin: -4px 0 0;
	font-size: 14px;
	color: var(--fg-muted);
}

.error {
	margin: -8px 0 16px;
	text-align: center;
	font-size: 13px;
	color: var(--status-failed);
}

button {
	height: 44px;
	display: flex;
	align-items: center;
	justify-content: center;
	border: 0;
	cursor: pointer;
}

.primary {
	gap: 10px;
	border-radius: var(--radius-md);
	background: var(--accent);
	color: var(--fg-on-accent);
	font-size: 14px;
	font-weight: 600;
}

.primary:hover {
	background: var(--accent-hover);
}

.sso {
	width: 100%;
}

.spin {
	width: 15px;
	height: 15px;
	border-radius: 50%;
	border: 2px solid color-mix(in srgb, var(--bg-deep) 30%, transparent);
	border-top-color: var(--bg-deep);
	animation: spin 700ms linear infinite;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}

.note {
	margin: 16px 0 0;
	font-size: 13px;
	line-height: 1.55;
	color: var(--fg-subtle);
	text-align: center;
}

.where {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	margin-top: 18px;
	padding-top: 16px;
	border-top: 1px solid var(--border);
	font: 400 12px var(--font-mono);
	color: var(--fg-subtle);
}

.link {
	height: 24px;
	padding: 0 6px;
	border-radius: var(--radius-sm);
	background: transparent;
	color: var(--accent-text);
	font: 500 12px var(--font-sans);
}

.link:hover {
	background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.register {
	margin: 0;
	display: flex;
	justify-content: center;
	gap: 6px;
	font-size: 13.5px;
	color: var(--fg-subtle);
}

.register a {
	color: var(--accent-text);
	font-weight: 500;
	text-decoration: none;
}

.register a:hover {
	color: var(--fg);
}
</style>
