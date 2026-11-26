<script lang="ts">
import { m as i18n } from "#lib/paraglide/messages.js";
import Icon from "#lib/ui/Icon.svelte";
import Mark from "#lib/ui/Mark.svelte";

type Props =
	| {
			kind: "server";
			url: string;
			error: string;
			checking: boolean;
			found: boolean;
			oninput: (value: string) => void;
			onsubmit: () => void;
	  }
	| {
			kind: "signin";
			host: string;
			step: boolean;
			lead: string;
			note: string;
			error: string;
			busy: boolean;
			busyLabel: string;
			onsignin: () => void;
			onchange?: () => void;
			register?: { url: string };
	  }
	| { kind: "paired"; name: string; keystore: string; onfinish: () => void };

let props: Props = $props();
let focused = $state(false);
</script>

<div class="page">
	<div class="glow"></div>
	{#if props.kind === "server"}
		{@const p = props}
		<form
			class="col"
			onsubmit={(e) => {
				e.preventDefault();
				p.onsubmit();
			}}
		>
			<div class="main server">
				<Mark size={56} radius={14} ring={false} />
				<div class="head">
					<span class="eyebrow">{i18n.welcome_step_1()}</span>
					<h1>{i18n.welcome_title_server()}</h1>
					<p class="lead">{i18n.welcome_lead_server()}</p>
				</div>
				<label class="field">
					<span class="label">{i18n.welcome_server_label()}</span>
					<span class="box" class:focus={focused && !p.error} class:error={!!p.error}>
						{#if !p.url.includes("://")}
							<span class="scheme">https://</span>
						{/if}
						<input
							value={p.url}
							oninput={(e) => p.oninput(e.currentTarget.value)}
							onfocus={() => (focused = true)}
							onblur={() => (focused = false)}
							spellcheck="false"
							autocomplete="off"
							autocapitalize="none"
							inputmode="url"
							placeholder={i18n.welcome_server_placeholder()}
						>
					</span>
					<span class="help" class:error={!!p.error}>{p.error || i18n.welcome_server_help()}</span>
				</label>
				{#if p.found}
					<div class="found">
						<Icon name="check" size={18} stroke={2} />{i18n.welcome_found()}
					</div>
				{/if}
			</div>
			<button type="submit" class="primary" style:opacity={p.checking ? 0.75 : 1}>
				{#if p.checking}
					<span class="spin"></span>
				{/if}
				{p.checking
					? i18n.welcome_checking()
					: p.found
						? i18n.welcome_connected()
						: i18n.welcome_continue()}
			</button>
		</form>
	{:else if props.kind === "signin"}
		{@const p = props}
		<div class="col">
			<div class="main signin">
				{#if p.step}
					<span class="eyebrow">{i18n.welcome_step_2()} · {p.host}</span>
				{:else}
					<Mark size={56} radius={14} ring={false} />
				{/if}
				<h1>{i18n.signin_title()}</h1>
				<p class="lead">{p.lead}</p>
				<p class="note">{p.note}</p>
				{#if p.error}
					<p class="alert" role="alert">{p.error}</p>
				{/if}
			</div>
			<div class="actions">
				<button type="button" class="primary" onclick={p.onsignin}>
					{#if p.busy}
						<span class="spin"></span>
					{:else}
						<Icon name="key-round" size={18} stroke={1.9} />
					{/if}
					{p.busy ? p.busyLabel : i18n.signin_continue()}
				</button>
				{#if p.onchange}
					<button type="button" class="ghost" onclick={p.onchange}>
						{i18n.welcome_phone_other_server()}
					</button>
				{/if}
				{#if p.register}
					<p class="register">
						{i18n.signin_no_account()}<a href={p.register.url}>{i18n.signin_create()}</a>
					</p>
				{/if}
			</div>
		</div>
	{:else}
		{@const p = props}
		<div class="col">
			<div class="main done">
				<span class="tick"><Icon name="tick" size={32} stroke={2.25} /></span>
				<h1>{i18n.welcome_paired_title()}</h1>
				<p class="lead">
					{i18n.welcome_phone_paired_lead({ name: p.name, keystore: p.keystore })}
				</p>
			</div>
			<button type="button" class="primary" onclick={p.onfinish}>
				{i18n.welcome_start_watching()}
			</button>
		</div>
	{/if}
</div>

<style>
.page {
	position: absolute;
	inset: 0;
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
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	padding: calc(env(safe-area-inset-top) + 8px) 24px calc(env(safe-area-inset-bottom) + 18px);
}

.main {
	flex: 1;
	display: flex;
	flex-direction: column;
	overflow-y: auto;
}

.server {
	gap: 20px;
	padding-top: 40px;
}

.signin {
	gap: 18px;
	padding-top: 24px;
}

.done {
	align-items: center;
	justify-content: center;
	gap: 16px;
	text-align: center;
}

.head {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

h1 {
	margin: 0;
	font-size: 28px;
	line-height: 1.1;
	font-weight: 700;
	letter-spacing: -0.025em;
}

.lead {
	margin: 0;
	font-size: 15px;
	line-height: 1.55;
	color: var(--fg-muted);
}

.eyebrow {
	font: 500 10.5px var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--fg-faint);
}

.note {
	margin: 0;
	font-size: 13px;
	line-height: 1.55;
	color: var(--fg-subtle);
}

.alert {
	margin: 0;
	font-size: 13px;
	line-height: 1.5;
	color: var(--status-failed);
}

.field {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.label {
	font-size: 13px;
	font-weight: 500;
	color: var(--fg-muted);
}

.box {
	height: 52px;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 0 14px;
	border-radius: 12px;
	background: var(--bg-elevated);
	border: 1px solid var(--border-strong);
}

.box.focus {
	border-color: var(--accent);
	box-shadow: 0 0 0 2px var(--accent-ring);
}

.box.error {
	border-color: var(--status-failed);
}

.scheme {
	font: 400 14px var(--font-mono);
	color: var(--fg-faint);
}

input {
	flex: 1;
	min-width: 0;
	height: 100%;
	padding: 0;
	border: 0;
	outline: none;
	background: transparent;
	color: var(--fg);
	font: 400 16px var(--font-mono);
}

.help {
	font-size: 12.5px;
	color: var(--fg-subtle);
}

.help.error {
	color: var(--status-failed);
}

.found {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 12px 14px;
	border-radius: 12px;
	background: color-mix(in srgb, var(--status-available) 8%, transparent);
	border: 1px solid color-mix(in srgb, var(--status-available) 25%, transparent);
	font-size: 14px;
}

.found :global(.sl-ico) {
	color: var(--status-available);
}

.actions {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.primary {
	height: 52px;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 9px;
	border: 0;
	border-radius: 14px;
	background: var(--accent);
	color: var(--fg-on-accent);
	font-size: 16px;
	font-weight: 600;
	cursor: pointer;
}

.ghost {
	height: 44px;
	border: 0;
	background: transparent;
	color: var(--fg-muted);
	font-size: 14px;
	cursor: pointer;
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

.tick {
	width: 64px;
	height: 64px;
	display: grid;
	place-items: center;
	border-radius: 50%;
	background: color-mix(in srgb, var(--status-available) 12%, transparent);
	color: var(--status-available);
}

.spin {
	width: 16px;
	height: 16px;
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
</style>
