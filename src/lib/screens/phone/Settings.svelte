<script lang="ts">
import { otherDevices } from "#lib/core/devices.ts";
import { ask } from "#lib/core/ask.svelte.ts";
import { type FieldError, PICTURE_TYPES, pictureProblem, refusal } from "#lib/core/account.ts";
import { type Caps, chips } from "#lib/core/capabilities.ts";
import { seen } from "#lib/core/devices.ts";
import { dl, refreshStorage } from "#lib/core/downloads.svelte.ts";
import { storageView } from "#lib/core/downloads-view.ts";
import { lib, loadLibrary } from "#lib/core/library.svelte.ts";
import { account, setMe } from "#lib/core/me.svelte.ts";
import { picture as profilePicture } from "#lib/core/picture.svelte.ts";
import { type ChoiceKey, prefs, setPref, type ToggleKey } from "#lib/core/prefs.svelte.ts";
import { languageName, QUALITIES, shown, subtitleLanguageName } from "#lib/core/prefs-labels.ts";
import { pendingPairs } from "#lib/core/admin.svelte.ts";
import { toast } from "#lib/core/toast.svelte.ts";
import type { Device, DeviceInfo } from "#lib/core/types.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { IS_WEB } from "#lib/platform/target.ts";
import { downloadsPort } from "#lib/screens/downloads-port.ts";
import PhoneRow from "#lib/screens/phone/SettingsRow.svelte";
import ScopeMenu from "#lib/shells/phone/ScopeMenu.svelte";
import Segmented from "#lib/shells/phone/Segmented.svelte";
import Art from "#lib/ui/Art.svelte";
import Avatar from "#lib/ui/Avatar.svelte";
import Button from "#lib/ui/Button.svelte";
import { downloadWords } from "#lib/ui/download-words.ts";
import Icon, { type IconName } from "#lib/ui/Icon.svelte";
import { goto } from "#lib/ui/nav.ts";
import StorageMeter from "#lib/ui/StorageMeter.svelte";
import Switch from "#lib/ui/Switch.svelte";
import {
	artwork,
	authState,
	canDownload,
	deviceInfo,
	devices as listDevices,
	home,
	library,
	me as whoAmI,
	openExternal,
	playerCapabilities,
	removePicture,
	revokeDevice,
	serverHost,
	setPicture,
	signOut as signOutNow,
	title as fetchTitle,
	watchState,
} from "#platform";
import { onMount } from "svelte";

const PING_MS = 2000;
const CUE_SIZE = { S: 15, M: 19, L: 23, XL: 28 };
const PHONE_CUE_SCALE = 0.85;

const me = $derived(account.me);
const admin = $derived(me?.role === "Admin");

let devices = $state.raw<Device[]>([]);
let host = $state("");
let keystore = $state("");
let info = $state.raw<DeviceInfo | null>(null);
let caps = $state.raw<Caps | null>(null);
let ping = $state(0);
let beat = $state(0);
let error = $state<FieldError | null>(null);
let picker = $state<HTMLInputElement>();

const wording = (e: FieldError) =>
	({
		too_large: i18n.settings_err_picture_large(),
		unsupported_type: i18n.settings_err_picture_type(),
		unknown: i18n.settings_err_unknown(),
	})[e.message] ?? e.message;

async function choosePicture(file: File | undefined) {
	if (!file) return;
	const problem = pictureProblem(file);
	if (problem) {
		error = { field: "picture", message: problem };
		return;
	}
	try {
		await setPicture(file);
		setMe(await whoAmI(), true);
		error = null;
		toast(i18n.settings_saved());
	} catch (e) {
		error = refusal(String(e));
	}
}

async function dropPicture() {
	try {
		await removePicture();
		setMe(await whoAmI(), true);
		error = null;
	} catch (e) {
		error = refusal(String(e));
	}
}

function askSignOut(d: Device) {
	ask({
		title: i18n.settings_sign_out_title({ name: d.name }),
		body: i18n.settings_sign_out_body(),
		confirm: i18n.settings_sign_out_value(),
		onconfirm: async () => {
			try {
				await revokeDevice(d.id);
				devices = devices.filter((x) => x.id !== d.id);
				toast(i18n.settings_signed_out_device({ name: d.name }));
			} catch {
				toast(i18n.settings_err_unknown(), { icon: "wifi", warning: true });
			}
		},
	});
}

async function leave() {
	await signOutNow();
	toast(IS_WEB ? i18n.shell_signed_out() : i18n.shell_signed_out_key_removed());
	await goto(IS_WEB ? "/signin" : "/welcome", { replace: true });
}

const pingOnce = async () => {
	const t = Date.now();
	try {
		await whoAmI();
		ping = Math.max(1, Date.now() - t);
		beat++;
	} catch {}
};

const choice = (key: ChoiceKey, vals: string[]) =>
	vals.map((v) => ({
		value: v,
		// A third of a phone's width has no room for the full phrase.
		label: v === "Original language" ? i18n.value_original_short() : shown(key, v),
	}));
const toggle = (key: ToggleKey) => (on: boolean) => setPref(key, on);

const selfDevice = $derived(devices.find((d) => d.current));
const others = $derived(otherDevices(devices));
const pairPage = $derived(me?.player_url ? `${me.player_url.replace(/\/+$/, "")}/pair` : null);
const deviceIcon = (d: Device): IconName =>
	/browser/i.test(d.platform)
		? "globe"
		: /tv/i.test(d.platform)
			? "tv"
			: /ipad|tablet/i.test(d.platform)
				? "tablet"
				: /android|ios|iphone/i.test(d.platform)
					? "smartphone"
					: "monitor";

const chipList = $derived(caps ? chips(caps) : []);
const groups = $derived(
	(["video", "audio", "subs"] as const)
		.map((g) => ({
			key: g,
			items: chipList.filter((c) => c.group === g),
		}))
		.filter((g) => g.items.length),
);
const capNames = $derived(groups.flatMap((g) => g.items));

const preview = $derived(
	lib.shows[0]
		? { kind: "series" as const, id: lib.shows[0].id }
		: lib.movies[0]
			? { kind: "movies" as const, id: lib.movies[0].id }
			: null,
);
const cueColor = $derived(
	prefs.subColor === "Yellow"
		? "color-mix(in srgb, var(--status-wanted) 40%, var(--fg))"
		: "var(--fg)",
);
const cueShadow = $derived(
	prefs.subBg === "Shadow"
		? "0 2px 4px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.6)"
		: prefs.subBg === "None"
			? "0 0 2px rgba(0,0,0,0.9)"
			: "none",
);

const storage = $derived.by(() => {
	if (!dl.storage) return null;
	const v = storageView(dl.storage, downloadWords());
	const gb = (n: number) => `${(n / 1e9).toFixed(1)} GB`;
	return {
		...v,
		labels: [
			i18n.dl_meter_used({ size: gb(dl.storage.used) }),
			i18n.dl_meter_free({ size: gb(dl.storage.free) }),
		] as [string, string],
	};
});
const offlineItems = $derived(dl.items.filter((e) => e.state === "done").length);

onMount(() => {
	if (canDownload) refreshStorage(downloadsPort);
	if (!account.me)
		whoAmI().then(
			(v) => setMe(v),
			() => {},
		);
	listDevices().then(
		(d) => (devices = d),
		() => {},
	);
	serverHost().then((h) => (host = h));
	authState().then((a) => {
		keystore = a.store_error ? i18n.common_key_not_stored({ error: a.store_error }) : a.keystore;
	});
	deviceInfo().then(
		(i) => (info = i),
		() => {},
	);
	playerCapabilities().then(
		(c) => (caps = c as Caps),
		() => {},
	);
	loadLibrary({ library, watchState, home, title: fetchTitle });
	pingOnce();
	const timer = setInterval(pingOnce, PING_MS);
	return () => clearInterval(timer);
});
</script>

{#snippet select(label: string, key: ChoiceKey, vals: string[], desc?: string)}
	<PhoneRow {label} {desc}>
		{#snippet below()}
			<select
				class="sl-input field"
				aria-label={label}
				value={prefs[key]}
				onchange={(e) => setPref(key, e.currentTarget.value)}
			>
				{#each choice(key, vals) as o (o.value)}
					<option value={o.value}>{o.label}</option>
				{/each}
			</select>
		{/snippet}
	</PhoneRow>
{/snippet}

{#snippet segmented(label: string, key: ChoiceKey, vals: string[], desc?: string)}
	<PhoneRow {label} {desc}>
		{#snippet below()}
			<Segmented
				{label}
				options={choice(key, vals)}
				value={prefs[key]}
				onchange={(v) => setPref(key, v)}
			/>
		{/snippet}
	</PhoneRow>
{/snippet}

{#snippet flag(label: string, key: ToggleKey, desc?: string)}
	<PhoneRow {label} {desc}>
		{#snippet control()}
			<Switch {label} checked={prefs[key]} onchange={toggle(key)} />
		{/snippet}
	</PhoneRow>
{/snippet}

{#snippet fact(label: string, value: string | undefined, desc?: string)}
	<PhoneRow {label} {desc}>
		{#snippet control()}
			<span class="info" title={value}>{value}</span>
		{/snippet}
	</PhoneRow>
{/snippet}

<div class="page">
	<div class="top">
		<button
			type="button"
			class="back"
			aria-label={i18n.common_back()}
			onclick={() => history.back()}
		>
			<Icon name="chevron-left" size={22} stroke={2} />
		</button>
	</div>
	{#if admin}
		<div class="heading"><ScopeMenu here="settings" title={i18n.settings_title()} {host} /></div>
	{:else}
		<h1>{i18n.settings_title()}</h1>
	{/if}

	<div class="profile">
		<Avatar
			name={me?.name}
			email={me?.email}
			initials={me ? me.initials : ""}
			size={48}
			color="var(--kind-album)"
			picture={me?.picture ? profilePicture.url : undefined}
		/>
		<span class="who">
			<span class="name">{me?.name}</span>
			<span class="host">{ping ? i18n.settings_ping({ host, ms: ping }) : host}</span>
		</span>
		{#key beat}
			<span class="beat" class:on={beat > 0}></span>
		{/key}
	</div>

	<section>
		<h2>{i18n.settings_profile()}</h2>
		<div class="card">
			<PhoneRow label={i18n.settings_picture()} desc={i18n.settings_picture_desc()}>
				{#snippet control()}
					<span class="picture">
						<Avatar
							name={me?.name}
							email={me?.email}
							initials={me ? me.initials : ""}
							size={40}
							color="var(--kind-album)"
							picture={me?.picture ? profilePicture.url : undefined}
						/>
						<input
							bind:this={picker}
							type="file"
							hidden
							accept={PICTURE_TYPES.join(",")}
							onchange={(e) => {
								choosePicture(e.currentTarget.files?.[0]);
								e.currentTarget.value = "";
							}}
						>
						<span class="tall">
							<Button variant="secondary" onclick={() => picker?.click()}>
								{i18n.settings_picture_choose()}
							</Button>
						</span>
					</span>
				{/snippet}
				{#snippet below()}
					{#if me?.picture}
						<span class="remove">
							<Button variant="ghost" size="sm" onclick={dropPicture}>
								{i18n.settings_picture_remove()}
							</Button>
						</span>
					{/if}
					{#if error?.field === "picture"}
						<span class="error" role="alert">{wording(error)}</span>
					{/if}
				{/snippet}
			</PhoneRow>
			{@render fact(i18n.settings_name(), me?.name, i18n.settings_name_desc())}
			{@render fact(i18n.settings_email(), me?.email, i18n.settings_email_desc())}
			<PhoneRow
				label={i18n.settings_account_link()}
				desc={i18n.settings_account_link_desc({ host })}
			>
				{#snippet control()}
					<span class="tall">
						<Button
							variant="secondary"
							disabled={!me}
							onclick={() => me && void openExternal(`${me.streamline_url}/account`)}
						>
							{i18n.settings_account_edit()}
						</Button>
					</span>
				{/snippet}
			</PhoneRow>
			{@render fact(
				i18n.settings_role(),
				me?.role,
				me?.role === "Admin" ? i18n.settings_role_desc_admin() : undefined,
			)}
		</div>
	</section>

	<section>
		<h2>{i18n.settings_playback()}</h2>
		<div class="card">
			{@render select(
				i18n.settings_quality_home(),
				"qHome",
				QUALITIES,
				i18n.settings_quality_home_desc({ host }),
			)}
			{@render select(
				i18n.settings_quality_away(),
				"qAway",
				QUALITIES,
				i18n.settings_quality_away_desc(),
			)}
			{@render segmented(
				i18n.settings_cellular(),
				"cellular",
				["4 Mbit/s", "8 Mbit/s", "No limit"],
				i18n.settings_cellular_desc(),
			)}
			{@render flag(i18n.settings_autoplay(), "autoplay")}
			{@render flag(i18n.settings_auto_skip(), "autoSkip", i18n.settings_auto_skip_desc())}
		</div>
	</section>

	<section>
		<h2>{i18n.settings_audio_subs()}</h2>
		<div class="card">
			{@render segmented(i18n.settings_audio_language(), "audioLang", [
				"Original language",
				"English",
				"French",
			])}
			{@render segmented(i18n.settings_subtitle_language(), "subsLang", [
				"App language",
				"English",
				"French",
			])}
			{@render segmented(
				i18n.settings_subtitles(),
				"subsMode",
				["Auto", "Always", "Off"],
				i18n.settings_subtitles_desc(),
			)}
			{@render flag(
				i18n.settings_anime(),
				"animeRule",
				i18n.settings_anime_desc({ language: subtitleLanguageName() }),
			)}
			{@render segmented(i18n.settings_size(), "subSize", ["S", "M", "L", "XL"])}
			{@render segmented(i18n.settings_background(), "subBg", ["None", "Shadow", "Box"])}
			{@render segmented(i18n.settings_color(), "subColor", ["White", "Yellow"])}
			<PhoneRow label={i18n.settings_preview()}>
				{#snippet below()}
					<div class="preview">
						{#if preview}
							<Art src={artwork(preview.kind, preview.id, "backdrop")} />
						{/if}
						<div class="cue-line">
							<span
								class="cue"
								data-preview
								style:font-size="{Math.round(
									(CUE_SIZE[prefs.subSize as keyof typeof CUE_SIZE] ?? 19) * PHONE_CUE_SCALE,
								)}px"
								style:color={cueColor}
								style:text-shadow={cueShadow}
								style:background={prefs.subBg === "Box" ? "rgba(0,0,0,0.72)" : "transparent"}
								style:padding={prefs.subBg === "Box" ? "3px 10px" : "0"}
								>{i18n.settings_preview_cue()}</span
							>
						</div>
					</div>
				{/snippet}
			</PhoneRow>
		</div>
	</section>

	{#if canDownload}
		<section>
			<h2>{i18n.shell_downloads()}</h2>
			<div class="card">
				{@render segmented(
					i18n.dl_quality_label(),
					"dlQuality",
					["Original", "1080p", "720p"],
					i18n.dl_settings_quality_desc(),
				)}
				{@render flag(i18n.dl_settings_pick(), "dlPick", i18n.dl_settings_pick_desc())}
				{@render flag(i18n.dl_settings_wifi_only(), "wifiOnly")}
				<PhoneRow
					label={i18n.dl_settings_storage()}
					desc={offlineItems === 1
						? i18n.dl_settings_items_one()
						: i18n.dl_settings_items({ n: offlineItems })}
				>
					{#snippet below()}
						{#if storage}
							<StorageMeter
								plain
								usedPct={storage.usedPct}
								otherPct={storage.otherPct}
								labels={storage.labels}
							/>
						{/if}
					{/snippet}
				</PhoneRow>
			</div>
		</section>
	{/if}

	<section>
		<h2>{i18n.settings_display()}</h2>
		<div class="card">
			{@render flag(i18n.settings_tech_details(), "techDetails", i18n.settings_tech_details_desc())}
		</div>
	</section>

	<section>
		<h2>{i18n.settings_language()}</h2>
		<div class="card">
			{@render segmented(
				i18n.settings_app_language(),
				"language",
				["English", "Français"],
				i18n.settings_app_language_desc_emails(),
			)}
			{@render fact(
				i18n.settings_titles_synopses(),
				languageName(me?.library_language),
				i18n.settings_titles_synopses_desc(),
			)}
		</div>
	</section>

	<section>
		<h2>{i18n.settings_signed_in_devices()}</h2>
		<div class="card">
			{#if selfDevice}
				<PhoneRow
					label={selfDevice.name}
					desc="{selfDevice.platform} · {i18n.settings_this_device_lower()}"
					icon={deviceIcon(selfDevice)}
				>
					{#snippet control()}
						<span class="tag"
							>{IS_WEB ? i18n.settings_this_browser() : i18n.settings_this_device()}</span
						>
					{/snippet}
				</PhoneRow>
			{/if}
			{#each others as d (d.id)}
				<PhoneRow label={d.name} desc="{d.platform} · {seen(d)}" icon={deviceIcon(d)}>
					{#snippet control()}
						<span class="tall">
							<Button variant="danger-outline" onclick={() => askSignOut(d)}>
								{i18n.shell_sign_out()}
							</Button>
						</span>
					{/snippet}
				</PhoneRow>
			{/each}
			{#if IS_WEB}
				<PhoneRow label={i18n.settings_pair_tv()} desc={i18n.settings_pair_tv_desc_web()}>
					{#snippet control()}
						<span class="tall">
							<Button variant="secondary" onclick={() => goto("/pair")}>
								{i18n.settings_pair_tv_enter()}
							</Button>
						</span>
					{/snippet}
				</PhoneRow>
			{:else if pairPage}
				<PhoneRow
					label={i18n.settings_pair_tv()}
					desc={i18n.settings_pair_tv_desc_app({ address: pairPage.replace(/^[a-z]+:\/\//, "") })}
				>
					{#snippet control()}
						<span class="tall">
							<Button variant="secondary" onclick={() => void openExternal(pairPage)}>
								{i18n.settings_pair_tv_open()}
							</Button>
						</span>
					{/snippet}
				</PhoneRow>
			{/if}
		</div>
	</section>

	<section>
		<h2>{IS_WEB ? i18n.settings_this_browser() : i18n.settings_this_device()}</h2>
		<div class="card">
			{#if IS_WEB}
				{@render fact(i18n.settings_browser(), info?.name ?? "—")}
				{@render fact(
					i18n.settings_session(),
					i18n.settings_session_value(),
					i18n.settings_session_desc(),
				)}
			{:else}
				{@render fact(i18n.settings_name(), info?.name ?? "—")}
				{@render fact(i18n.settings_platform(), info?.platform ?? "—")}
			{/if}
			{@render fact(i18n.settings_video_player(), info?.player ?? "—")}
			{#if !IS_WEB}
				{@render fact(i18n.settings_device_key(), keystore, i18n.settings_device_key_desc())}
			{/if}
			<PhoneRow
				label={IS_WEB ? i18n.settings_can_play_browser() : i18n.settings_can_play()}
				desc={i18n.settings_can_play_desc({
					player: info?.player.split(" ")[0] ?? i18n.settings_the_player(),
				})}
			>
				{#snippet below()}
					<div class="caps">
						{#each capNames as c (c.name)}
							<span class="cap" class:yes={c.ok}>
								<Icon name={c.ok ? "tick" : "x"} size={11} stroke={2.5} />{c.name}
							</span>
						{/each}
					</div>
				{/snippet}
			</PhoneRow>
		</div>
	</section>

	<section>
		<h2>{i18n.settings_account()}</h2>
		<div class="card">
			{@render fact(i18n.settings_signed_in_as(), me?.email)}
			{@render fact(i18n.settings_server(), host)}
			<PhoneRow
				label={IS_WEB ? i18n.shell_sign_out() : i18n.settings_sign_out()}
				desc={IS_WEB ? i18n.settings_sign_out_browser_desc() : i18n.settings_sign_out_desc()}
			>
				{#snippet control()}
					<span class="tall">
						<Button variant="danger-outline" onclick={leave}>
							{i18n.settings_sign_out_value()}
						</Button>
					</span>
				{/snippet}
			</PhoneRow>
		</div>
	</section>

	{#if admin}
		<section>
			<h2>{i18n.settings_admin()}</h2>
			<button type="button" class="admin" onclick={() => goto("/admin")}>
				<Icon name="server" size={19} stroke={1.75} />
				<span class="text">
					<span class="label">{i18n.server_open()}</span>
					<span class="host">{host}</span>
				</span>
				{#if pendingPairs.n}
					<span class="badge">{pendingPairs.n}</span>
				{/if}
				<Icon name="chevron-right" size={16} stroke={2} />
			</button>
		</section>
	{/if}
</div>

<style>
.page {
	box-sizing: border-box;
	min-height: 100%;
	padding: 0 0 24px;
	background: var(--bg-deep);
	color: var(--fg);
}

.top {
	position: sticky;
	top: 0;
	z-index: 2;
	display: flex;
	align-items: center;
	gap: 4px;
	padding: calc(env(safe-area-inset-top) + 6px) 12px 0;
	background: color-mix(in srgb, var(--bg-deep) 92%, transparent);
	backdrop-filter: blur(16px);
	-webkit-backdrop-filter: blur(16px);
}

.back {
	width: 44px;
	height: 44px;
	display: grid;
	place-items: center;
	border: 0;
	border-radius: 50%;
	background: transparent;
	color: var(--accent-text);
	cursor: pointer;
}

h1 {
	margin: 0;
	padding: 0 20px 14px;
	font-size: 30px;
	font-weight: 700;
	letter-spacing: -0.025em;
}

.heading {
	display: flex;
	padding: 0 20px 14px;
}

.profile {
	margin: 0 16px 18px;
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 14px 16px;
	border-radius: 14px;
	background: var(--bg-elevated);
	border: 1px solid var(--border);
}

.who {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.name {
	font-size: 16px;
	font-weight: 600;
}

.host {
	font: 400 11px var(--font-mono);
	color: var(--fg-subtle);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.beat {
	flex: none;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--status-available);
}

.beat.on {
	animation: beat 900ms var(--ease);
}

@keyframes beat {
	from {
		box-shadow: 0 0 0 0 color-mix(in srgb, var(--status-available) 60%, transparent);
	}
	to {
		box-shadow: 0 0 0 7px transparent;
	}
}

section {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-bottom: 22px;
}

h2 {
	margin: 0;
	padding: 0 32px;
	font: 500 10.5px var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--fg-faint);
}

.card {
	margin: 0 16px;
	border-radius: 14px;
	background: var(--bg-elevated);
	border: 1px solid var(--border);
	overflow: hidden;
}

.field {
	height: 44px;
	font-size: 16px;
	cursor: pointer;
	color-scheme: dark;
}

.info {
	flex: 0 1 auto;
	min-width: 0;
	max-width: 66%;
	overflow: hidden;
	font: 400 12px var(--font-mono);
	color: var(--fg-subtle);
	text-align: right;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.tag {
	flex: none;
	height: 24px;
	display: inline-flex;
	align-items: center;
	padding: 0 8px;
	border-radius: var(--radius-sm);
	background: color-mix(in srgb, var(--accent) 12%, transparent);
	color: var(--accent-text);
	font: 500 11px var(--font-mono);
}

.picture {
	flex: none;
	display: flex;
	align-items: center;
	gap: 8px;
}

.tall {
	flex: none;
	display: inline-flex;
}

.tall :global(.sl-btn) {
	height: 44px;
}

.remove {
	align-self: flex-start;
}

.error {
	font-size: 12px;
	color: var(--status-failed);
}

.preview {
	position: relative;
	height: 120px;
	border-radius: var(--radius-md);
	overflow: hidden;
	background: #000;
}

.preview :global(img) {
	opacity: 0.85;
}

.cue-line {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 12px;
	display: flex;
	justify-content: center;
	padding: 0 12px;
}

.cue {
	font-weight: 500;
	text-align: center;
	border-radius: 5px;
}

.caps {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.cap {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	height: 26px;
	padding: 0 8px;
	border-radius: 7px;
	border: 1px solid var(--border);
	background: rgba(255, 255, 255, 0.03);
	font: 500 11px var(--font-mono);
	color: var(--fg-subtle);
}

.cap.yes {
	color: var(--status-available);
	background: color-mix(in srgb, var(--status-available) 8%, transparent);
	border-color: color-mix(in srgb, var(--status-available) 25%, transparent);
}

.admin {
	margin: 0 16px;
	min-height: 58px;
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 8px 12px 8px 16px;
	border-radius: 14px;
	background: var(--bg-elevated);
	border: 1px solid var(--border);
	color: var(--fg);
	text-align: left;
	cursor: pointer;
}

.admin > :global(.sl-ico:first-child) {
	color: var(--accent-text);
}

.admin > :global(.sl-ico:last-child) {
	color: var(--fg-faint);
}

.admin .text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 1px;
}

.admin .label {
	font-size: 15px;
}

.admin .host {
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
}

.badge {
	flex: none;
	min-width: 20px;
	height: 20px;
	padding: 0 6px;
	display: grid;
	place-items: center;
	border-radius: var(--radius-full);
	background: var(--accent);
	color: var(--fg-on-accent);
	font: 500 11px var(--font-mono);
}
</style>
