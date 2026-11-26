<script lang="ts">
import { ask } from "#lib/core/ask.svelte.ts";
import { openPopover, removeKeys } from "#lib/core/download-ask.svelte.ts";
import { dl, retry } from "#lib/core/downloads.svelte.ts";
import { type Card, type Group, pageView, storageView } from "#lib/core/downloads-view.ts";
import { localUrl } from "#lib/core/download-launch.ts";
import { sizeText, stillPos } from "#lib/core/format.ts";
import { lib } from "#lib/core/library.svelte.ts";
import { net } from "#lib/core/online.svelte.ts";
import { toast } from "#lib/core/toast.svelte.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { isPhone, isTablet } from "#lib/platform/form-factor.svelte.ts";
import PhoneDownloads, { type PhoneGroup } from "#lib/screens/phone/Downloads.svelte";
import { downloadsPort } from "#lib/screens/downloads-port.ts";
import Banner from "#lib/ui/Banner.svelte";
import Button from "#lib/ui/Button.svelte";
import { downloadWords } from "#lib/ui/download-words.ts";
import EmptyState from "#lib/ui/EmptyState.svelte";
import Icon from "#lib/ui/Icon.svelte";
import { goto } from "#lib/ui/nav.ts";
import Art from "#lib/ui/Art.svelte";
import StorageMeter from "#lib/ui/StorageMeter.svelte";
import TriPick from "#lib/ui/TriPick.svelte";
import { prefs } from "#lib/core/prefs.svelte.ts";
import { TARGET } from "#lib/platform/target.ts";
import { artworkAt } from "#platform";

const touch = TARGET === "android";

const PAD_X = $derived(isTablet() ? 44 : 56);
const ICON_HIT = $derived(isTablet() ? 44 : undefined);
const TOP = 92;
const BOTTOM = 32;

const words = $derived(downloadWords());
const view = $derived(pageView(dl.items, dl.rate, words, lib.watch));
const meter = $derived(dl.storage ? storageView(dl.storage, words, isPhone()) : null);
const byKey = (key: string) => dl.items.find((e) => e.key === key);

const stillOf = (key: string) => artworkAt(byKey(key)?.meta.still ?? "");
const posOf = (key: string) => {
	const m = byKey(key)?.meta;
	return m?.season != null && m.episode != null ? stillPos(m.episode, m.season) : "50% 40%";
};

function cancel(key: string) {
	removeKeys(downloadsPort, [key]);
	toast(i18n.dl_toast_cancelled());
}

function removeOne(c: Card) {
	ask({
		title: i18n.dl_ask_title({ title: c.fullTitle }),
		body: i18n.dl_ask_one_body({ size: sizeText(byKey(c.key)?.size) }),
		confirm: i18n.dl_remove_one(),
		onconfirm: () => {
			removeKeys(downloadsPort, [c.key]);
			toast(i18n.dl_toast_removed());
		},
	});
}

let selecting = $state(false);
let picked = $state<Set<string>>(new Set());
const doneKeys = $derived(view.groups.flatMap((g) => g.keys));
const pickedKeys = $derived(doneKeys.filter((k) => picked.has(k)));
const allPicked = $derived(doneKeys.length > 0 && pickedKeys.length === doneKeys.length);
const pickedSize = $derived(sizeText(pickedKeys.reduce((n, k) => n + (byKey(k)?.size ?? 0), 0)));

function toggleSelecting() {
	selecting = !selecting;
	picked = new Set();
}

function pick(key: string) {
	const next = new Set(picked);
	if (!next.delete(key)) next.add(key);
	picked = next;
}

type PickState = "true" | "mixed" | "false";
const stateOf = (keys: string[]): PickState => {
	const n = keys.filter((k) => picked.has(k)).length;
	return n === 0 ? "false" : n === keys.length ? "true" : "mixed";
};
function toggleAll(keys: string[]) {
	const next = new Set(picked);
	if (stateOf(keys) === "true") for (const k of keys) next.delete(k);
	else for (const k of keys) next.add(k);
	picked = next;
}

function removePicked() {
	const keys = pickedKeys;
	const n = keys.length;
	ask({
		title: (n === 1 ? i18n.dl_ask_many_title_one : i18n.dl_ask_many_title_other)({ count: n }),
		body: i18n.dl_ask_many_body({ size: pickedSize }),
		confirm: i18n.dl_remove_one(),
		onconfirm: () => {
			removeKeys(downloadsPort, keys);
			toast(
				(n === 1 ? i18n.dl_toast_removed_many_one : i18n.dl_toast_removed_many_other)({ count: n }),
			);
			selecting = false;
			picked = new Set();
		},
	});
}

function removeAll(g: Group) {
	ask({
		title: i18n.dl_ask_title({ title: g.title }),
		body: i18n.dl_ask_body({
			episodes: words.episodes(g.keys.length),
			size: g.sub.split(" · ")[1] ?? "",
		}),
		confirm: i18n.dl_remove_all(),
		onconfirm: () => {
			removeKeys(downloadsPort, g.keys);
			toast(i18n.dl_toast_removed_title({ title: g.title }));
		},
	});
}

// Play on this screen always plays the file on disk, with no library or server call.
function play(c: Card) {
	const m = byKey(c.key)?.meta;
	if (m) goto(localUrl(m));
}

function open(c: Card) {
	const m = byKey(c.key)?.meta;
	if (!m) return;
	return goto(`/detail/${m.kind}/${m.title_id}${m.season != null ? `?s=${m.season}` : ""}`);
}

const openGroup = (g: Group) =>
	goto(`/detail/${g.titleKind}/${g.titleId}${g.firstSeason != null ? `?s=${g.firstSeason}` : ""}`);

const phone = $derived(isPhone());
const phoneGroups = $derived<PhoneGroup[]>(
	view.groups.flatMap<PhoneGroup>((g) => {
		if (g.kind === "show")
			return [
				{
					key: `${g.titleKind}:${g.titleId}`,
					title: g.title,
					sub: g.sub,
					poster: g.poster,
					open: () => openGroup(g),
					seasons: g.seasons,
				},
			];
		return g.seasons.flatMap((s) =>
			s.cards.flatMap((c) => {
				const m = byKey(c.key)?.meta;
				if (!m) return [];
				return [
					{
						key: c.key,
						title: c.fullTitle,
						sub: c.meta.split(" · ").slice(0, 2).join(" · "),
						poster: m.poster,
						open: () => void open(c),
						seasons: [{ label: null, cards: [c] }],
					},
				];
			}),
		);
	}),
);
</script>

{#if phone}
	<PhoneDownloads
		summary={view.summary}
		meter={meter
			? { usedPct: meter.usedPct, otherPct: meter.otherPct, labels: meter.labels }
			: null}
		groups={phoneGroups}
		active={view.active}
		empty={view.empty && dl.loaded}
		online={net.online}
		{selecting}
		{picked}
		pickedCount={pickedKeys.length}
		{pickedSize}
		{allPicked}
		{stillOf}
		{posOf}
		oncancel={(key) =>
			openPopover([key], view.active.find((r) => r.key === key)?.title ?? "", null, false)}
		onretry={(key) => retry(downloadsPort, key)}
		onplay={play}
		onremove={removeOne}
		onselecting={toggleSelecting}
		onpick={pick}
		onpickall={() => (picked = allPicked ? new Set() : new Set(doneKeys))}
		onremovepicked={removePicked}
		onbrowse={() => goto("/library/movies")}
	/>
{:else}
	<div class="page" style:padding="{TOP}px {PAD_X}px {BOTTOM}px">
		<div class="top">
			<div class="titles">
				<div class="title-row">
					<h1>{i18n.shell_downloads()}</h1>
				</div>
				<span class="summary">{view.summary}</span>
			</div>
			{#if meter}
				<div class="meter">
					<StorageMeter usedPct={meter.usedPct} otherPct={meter.otherPct} labels={meter.labels} />
				</div>
			{/if}
			{#if touch}
				<p class="wifi">
					<Icon name="wifi" size={15} stroke={1.75} />
					{prefs.wifiOnly ? i18n.dl_wifi_note_on() : i18n.dl_wifi_note_off()}
				</p>
			{/if}
		</div>

		{#if !net.online}
			<Banner
				status="paused"
				icon="wifi-off"
				title={i18n.dl_offline_title()}
				detail={i18n.dl_offline_detail()}
			/>
		{/if}

		{#if view.active.length > 0}
			<section class="active">
				<h2>{i18n.dl_downloading()}</h2>
				{#each view.active as r (r.key)}
					<div class="row {r.state}" data-key={r.key} data-state={r.state}>
						<span class="pic">
							<Art src={stillOf(r.key)} position={posOf(r.key)} />
						</span>
						<span class="body">
							<span class="name">{r.title}</span>
							<span class="bar"><span class="fill" style:width="{r.pct}%"></span></span>
							<span class="line">
								<span class="sub">{r.sub}</span>
								<span class="note {r.noteTone}">{r.note}</span>
							</span>
						</span>
						{#if r.canRetry}
							<Button
								variant="secondary"
								size="sm"
								icon="rotate-cw"
								title={i18n.dl_retry_download()}
								onclick={() => retry(downloadsPort, r.key)}
							>
								{i18n.dl_retry()}
							</Button>
						{/if}
						<Button
							variant="icon"
							icon="x"
							hit={ICON_HIT}
							label={i18n.dl_cancel()}
							title={i18n.dl_cancel()}
							onclick={() => cancel(r.key)}
						/>
					</div>
				{/each}
			</section>
		{/if}

		{#if view.groups.length > 0}
			<section class="done">
				<div class="done-head">
					<h2>{i18n.dl_on_device()}</h2>
					<button type="button" class="text" aria-pressed={selecting} onclick={toggleSelecting}>
						{selecting ? i18n.dl_select_done() : i18n.dl_select()}
					</button>
				</div>
				{#each view.groups as g (g.kind === "movies" ? "movies" : `${g.titleKind}:${g.titleId}`)}
					<div class="group">
						{#if g.kind === "show"}
							<div class="head">
								{#if selecting}
									{@const st = stateOf(g.keys)}
									<TriPick
										state={st}
										label={(st === "true" ? i18n.dl_unselect_all_of : i18n.dl_select_all_of)({
											name: g.title,
										})}
										margin="0 -4px"
										onclick={() => toggleAll(g.keys)}
									/>
								{/if}
								<button
									type="button"
									class="poster"
									aria-label={i18n.dl_open({ title: g.title })}
									onclick={() => openGroup(g)}
								>
									<span class="cover"><Art src={artworkAt(g.poster)} kind="poster" /></span>
								</button>
								<button type="button" class="gtitle" onclick={() => openGroup(g)}>
									<span class="gname">{g.title}</span>
									<span class="gsub">{g.sub}</span>
								</button>
								<Button variant="destructive" size="sm" icon="trash-2" onclick={() => removeAll(g)}>
									{i18n.dl_remove_all()}
								</Button>
							</div>
						{:else}
							<div class="head movies">
								{#if selecting}
									{@const st = stateOf(g.keys)}
									<TriPick
										state={st}
										label={(st === "true" ? i18n.dl_unselect_all_of : i18n.dl_select_all_of)({
											name: g.title,
										})}
										margin="0 -4px"
										onclick={() => toggleAll(g.keys)}
									/>
								{/if}
								<span class="gname">{g.title}</span>
								<span class="gsub">{g.sub}</span>
							</div>
						{/if}
						{#each g.seasons as s (s.label ?? "")}
							<div class="season">
								{#if s.label}
									<div class="slabel">
										{#if selecting}
											{@const st = stateOf(s.cards.map((c) => c.key))}
											<TriPick
												state={st}
												label={(st === "true" ? i18n.dl_unselect_all_of : i18n.dl_select_all_of)({
													name: s.label,
												})}
												margin="0 -4px"
												onclick={() => toggleAll(s.cards.map((c) => c.key))}
											/>
										{/if}
										<span class="label">{s.label}</span>
									</div>
								{/if}
								<div class="grid">
									{#each s.cards as c (c.key)}
										{@const on = picked.has(c.key)}
										<div class="card" data-key={c.key}>
											<button
												type="button"
												class="still"
												class:picked={selecting && on}
												class:dim={selecting && !on}
												aria-label={selecting
													? (on ? i18n.dl_unselect_item : i18n.dl_select_item)({
															title: c.fullTitle,
														})
													: i18n.library_play_title({ title: c.fullTitle })}
												aria-pressed={selecting ? on : undefined}
												onclick={() => (selecting ? pick(c.key) : play(c))}
											>
												<Art src={stillOf(c.key)} position={posOf(c.key)} />
												{#if selecting}
													<span class="box" class:on aria-hidden="true"
														><Icon name="tick" size={13} stroke={3} /></span
													>
												{:else}
													<span class="playdot"><Icon name="play" filled /></span>
												{/if}
											</button>
											<div class="info">
												<button type="button" class="text" onclick={() => open(c)}>
													<span class="head1">{c.head}</span>
													<span class="line1">{c.line}</span>
													<span class="mono">{c.meta}</span>
													<span class="mono clip">{c.tracks}</span>
													{#if c.offText}
														<span class="off"><Icon name="history" />{c.offText}</span>
													{/if}
												</button>
												<span class="trash">
													<Button
														variant="icon"
														icon="trash-2"
														hit={ICON_HIT}
														label={i18n.dl_remove()}
														title={i18n.dl_remove()}
														onclick={() => removeOne(c)}
													/>
												</span>
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{/each}
			</section>
		{/if}

		{#if selecting}
			<div class="selbar" role="toolbar" aria-label={i18n.dl_selection()}>
				<span class="seltext">
					<span class="selcount"
						>{pickedKeys.length
							? (pickedKeys.length === 1 ? i18n.dl_selected_one : i18n.dl_selected_other)({
									count: pickedKeys.length,
								})
							: i18n.dl_pick_what()}</span
					>
					{#if pickedKeys.length}
						<span class="selsize">{pickedSize}</span>
					{/if}
				</span>
				<button
					type="button"
					class="text"
					onclick={() => (picked = allPicked ? new Set() : new Set(doneKeys))}
				>
					{allPicked ? i18n.dl_select_clear() : i18n.dl_select_all()}
				</button>
				<Button
					variant="danger"
					icon="trash-2"
					disabled={!pickedKeys.length}
					onclick={removePicked}
				>
					{i18n.dl_remove_one()}
				</Button>
			</div>
		{/if}

		{#if view.empty && dl.loaded}
			<div class="none">
				<EmptyState icon="download" title={i18n.dl_empty_title()} text={i18n.dl_empty_text()}>
					{#snippet action()}
						<Button
							variant="primary"
							size={isTablet() ? "lg" : "md"}
							onclick={() => goto("/library/movies")}
						>
							{i18n.dl_browse()}
						</Button>
					{/snippet}
				</EmptyState>
			</div>
		{/if}
	</div>
{/if}

<style>
.page {
	position: relative;
	box-sizing: border-box;
	min-height: 100%;
	display: flex;
	flex-direction: column;
	gap: 22px;
}

.none {
	position: absolute;
	inset: 0;
	display: grid;
	place-items: center;
	pointer-events: none;
}

.none > :global(*) {
	pointer-events: auto;
}

.top {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	justify-content: space-between;
	gap: 14px 32px;
}

.titles {
	flex: 1 1 240px;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

h1 {
	margin: 0;
	font-size: 30px;
	font-weight: 700;
	letter-spacing: -0.025em;
}

.summary {
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
}

.meter {
	flex: 1 1 300px;
	max-width: 440px;
	min-width: 0;
}

section {
	display: flex;
	flex-direction: column;
}

.active {
	gap: 6px;
}

.done {
	gap: 26px;
}

h2 {
	margin: 0;
	font: 500 10.5px var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--fg-faint);
}

.active h2 {
	margin-bottom: 4px;
}

.row {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 10px 0;
}

.pic {
	position: relative;
	flex: none;
	width: 150px;
	aspect-ratio: 16 / 9;
	border-radius: 8px;
	overflow: hidden;
	background: var(--bg-card);
}

.pic :global(img.loaded) {
	opacity: 0.7;
}

.body {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 5px;
}

.name {
	font-size: 15px;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.bar {
	display: block;
	height: 3px;
	border-radius: 2px;
	background: color-mix(in srgb, var(--fg) 10%, transparent);
	overflow: hidden;
}

.fill {
	display: block;
	height: 100%;
	background: var(--status-downloading);
	transition: width 450ms linear;
}

.waiting .fill {
	background: var(--fg-subtle);
}

.failed .fill {
	background: var(--status-failed);
}

.line {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	gap: 2px 12px;
	font: 400 11.5px var(--font-mono);
}

.sub {
	color: var(--fg-subtle);
}

.note.rate {
	color: var(--accent-text);
}

.note.muted {
	color: var(--fg-subtle);
}

.note.failed {
	color: var(--status-failed);
}

.group {
	display: flex;
	flex-direction: column;
	gap: 14px;
}

.head {
	display: flex;
	align-items: center;
	gap: 14px;
	padding-bottom: 12px;
	border-bottom: 1px solid var(--border);
}

.head.movies {
	gap: 10px;
}

.poster {
	flex: none;
	padding: 0;
	border: 0;
	border-radius: var(--radius-sm);
	background: transparent;
	cursor: pointer;
}

.cover {
	position: relative;
	display: block;
	width: 40px;
	aspect-ratio: 2 / 3;
	border-radius: var(--radius-sm);
	overflow: hidden;
	box-shadow: 0 0 0 1px var(--border);
}

.gtitle {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--fg);
	text-align: left;
	cursor: pointer;
}

.gname {
	font-size: 17px;
	font-weight: 600;
	letter-spacing: -0.01em;
}

.gsub {
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
}

.season {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.label {
	font: 500 10.5px var(--font-mono);
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--fg-subtle);
}

.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
	gap: 24px 16px;
}

.card {
	display: flex;
	flex-direction: column;
	gap: 9px;
	min-width: 0;
}

.still {
	position: relative;
	display: block;
	width: 100%;
	aspect-ratio: 16 / 9;
	padding: 0;
	border: 0;
	border-radius: var(--radius-md);
	overflow: hidden;
	background: var(--bg-card);
	cursor: pointer;
	box-shadow: 0 0 0 1px var(--border);
	transition: box-shadow var(--dur-fast);
}

.still :global(img) {
	transition: opacity var(--dur-fast);
}

.still.dim :global(img.loaded) {
	opacity: 0.6;
}

.still.picked {
	box-shadow: 0 0 0 2px var(--accent);
}

.still:hover {
	box-shadow:
		0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent),
		0 16px 32px rgba(0, 0, 0, 0.45);
}

.playdot {
	position: absolute;
	left: 10px;
	bottom: 10px;
	display: grid;
	place-items: center;
	width: 30px;
	height: 30px;
	border-radius: 50%;
	background: color-mix(in srgb, var(--fg) 92%, transparent);
	color: var(--fg-on-accent);
	font-size: 12px;
}

.playdot :global(.sl-ico) {
	margin-left: 2px;
}

.info {
	display: flex;
	align-items: flex-start;
	gap: 4px;
	min-width: 0;
}

.text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--fg);
	text-align: left;
	cursor: pointer;
}

.head1 {
	font-size: 14px;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.line1 {
	font-size: 12.5px;
	color: var(--fg-muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.mono {
	font: 400 11px var(--font-mono);
	color: var(--fg-subtle);
}

.clip {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.off {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-top: 3px;
	font-size: 12px;
	line-height: 1.35;
	color: var(--fg-muted);
}

.off :global(.sl-ico) {
	flex: none;
	font-size: 13px;
	color: var(--status-wanted);
	stroke-width: 2;
}

.trash {
	flex: none;
	display: inline-flex;
	margin: -4px -6px 0 0;
}

.trash :global(.sl-btn) {
	width: 34px;
	height: 34px;
	color: var(--status-failed);
}

.title-row {
	display: flex;
	align-items: center;
	gap: 12px;
}

.done-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.text {
	flex: none;
	height: 36px;
	padding: 0 12px;
	border: 0;
	border-radius: var(--radius-md);
	background: transparent;
	color: var(--accent-text);
	font-size: 13.5px;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
}

.text:hover {
	background: var(--surface-2);
}

.done-head .text {
	height: 32px;
	margin: -8px -10px -8px 0;
	padding: 0 10px;
}

.slabel {
	display: flex;
	align-items: center;
	gap: 8px;
	min-height: 32px;
}

.selbar {
	position: sticky;
	bottom: 20px;
	z-index: 10;
	align-self: center;
	width: 100%;
	max-width: 560px;
	box-sizing: border-box;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 8px 8px 16px;
	border-radius: var(--radius-lg);
	background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
	backdrop-filter: blur(16px) saturate(150%);
	-webkit-backdrop-filter: blur(16px) saturate(150%);
	box-shadow:
		inset 0 0 0 1px var(--border-strong),
		var(--shadow-4);
	animation: rise 200ms var(--ease);
}

@keyframes rise {
	from {
		opacity: 0;
		transform: translateY(8px);
	}
}

.seltext {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 1px;
}

.selcount {
	font-size: 14px;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.selsize {
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
}
.box {
	position: absolute;
	left: 10px;
	top: 10px;
	width: 24px;
	height: 24px;
	box-sizing: border-box;
	display: grid;
	place-items: center;
	border: 2px solid rgba(255, 255, 255, 0.85);
	border-radius: 50%;
	background: rgba(10, 10, 14, 0.45);
	color: var(--fg-on-accent);
	box-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
	transition:
		background 150ms var(--ease),
		border-color 150ms var(--ease);
}

.box :global(.sl-ico) {
	opacity: 0;
}

.box.on {
	border-color: var(--accent);
	background: var(--accent);
}

.box.on :global(.sl-ico) {
	opacity: 1;
}
.wifi {
	flex: 0 0 100%;
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 0;
	font-size: 12.5px;
	color: var(--fg-subtle);
}
</style>
