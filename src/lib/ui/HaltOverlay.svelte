<script lang="ts">
import {
	AudioLines,
	Ban,
	ChevronRight,
	CircleAlert,
	Cpu,
	Folder,
	Play,
	RotateCw,
	Server,
	WifiOff,
} from "@lucide/svelte";
import type { Component } from "svelte";
import type { HaltIcon } from "#lib/core/playback/halt.ts";
import type { HaltViewModel } from "#lib/core/player-panels.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import { orPoster } from "#lib/ui/img.ts";

let {
	view,
	frame = "",
	poster = "",
	framePos = "",
	leaving = false,
	onaction,
	onalt,
}: {
	view: HaltViewModel;
	frame?: string;
	poster?: string;
	framePos?: string;
	leaving?: boolean;
	onaction: (id: string) => void;
	onalt: (id: string) => void;
} = $props();

const ICONS: Record<HaltIcon, Component<{ size?: number; strokeWidth?: number }>> = {
	"audio-lines": AudioLines,
	ban: Ban,
	alert: CircleAlert,
	cpu: Cpu,
	folder: Folder,
	play: Play,
	retry: RotateCw,
	server: Server,
	"wifi-off": WifiOff,
};
const Icon = $derived(ICONS[view.icon]);

const initials = (name: string) => {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	return (
		(parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")
	).toUpperCase();
};
const hue = (name: string) =>
	[...name].reduce((h, ch) => (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0, 0) % 360;
</script>

<div class="halt" class:leaving role="alertdialog" aria-label={view.eyebrow}>
	{#if frame}
		<img
			class="frame"
			src={frame}
			alt=""
			style:object-position={framePos}
			onerror={orPoster(poster)}
		>
	{/if}
	<div class="scrim"></div>
	<div class="zoom">
		<div class="col">
			<span
				class="eyebrow"
				style:color={view.failed ? "var(--status-failed)" : "var(--status-warning)"}
			>
				<Icon size={14} strokeWidth={2} />
				{view.eyebrow}
			</span>
			<span class="title">{view.title}</span>
			{#if view.body}
				<span class="body">{view.body}</span>
			{/if}
			{#if view.mono}
				<span class="mono">{view.mono}</span>
			{/if}
			{#if view.message?.text}
				<div class="msg">
					<span
						class="avatar"
						style:background="oklch(0.36 0.06 {hue(view.message.by)})"
						style:color="oklch(0.92 0.04 {hue(view.message.by)})"
						>{initials(view.message.by)}</span
					>
					<span class="msg-text">
						<span class="msg-by"><b>{view.message.by}</b> · {i18n.halt_admin_just_now()}</span>
						<span class="msg-body">{view.message.text}</span>
					</span>
				</div>
			{:else if view.message}
				<span class="no-msg">{i18n.halt_no_reason()}</span>
			{/if}
			{#if view.countdown}
				<div class="count">
					<div class="track">
						<div
							class="fill"
							style:width="{view.countdown.fraction * 100}%"
							style:background={view.failed ? "var(--player-ink-muted)" : "var(--status-warning)"}
						></div>
					</div>
					<span class="count-text">{view.countdown.text}</span>
				</div>
			{/if}
			{#if view.wait}
				<span class="wait"><span class="wait-dot"></span>{view.wait}</span>
			{/if}
			{#if view.alternatives?.length}
				<div class="alts">
					<span class="alts-title">{i18n.halt_alts_title()}</span>
					{#each view.alternatives as alt (alt.id)}
						{@const AltIcon = ICONS[alt.icon]}
						<button type="button" class="alt" onclick={() => onalt(alt.id)}>
							<AltIcon size={20} strokeWidth={1.75} />
							<span class="alt-text"
								><span class="alt-label">{alt.label}</span
								><span class="alt-sub">{alt.sub}</span></span
							>
							<span class="alt-go"><ChevronRight size={18} strokeWidth={2} /></span>
						</button>
					{/each}
				</div>
			{/if}
			{#if view.note}
				<span class="note">{view.note}</span>
			{/if}
			<div class="actions">
				{#each view.actions as a (a.id)}
					<button
						type="button"
						class={a.primary ? "primary" : "secondary"}
						onclick={() => onaction(a.id)}
					>
						{#if a.primary}
							<RotateCw size={16} strokeWidth={2} />
						{/if}
						{a.label}
					</button>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
.halt {
	position: absolute;
	inset: 0;
	overflow: hidden;
	background: var(--bg-deep);
	animation: fade 260ms var(--ease);
	transition: opacity 240ms var(--ease);
}

.halt.leaving {
	opacity: 0;
	pointer-events: none;
}

.frame {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
	filter: blur(32px) saturate(1.2);
	transform: scale(1.15);
	opacity: 0.5;
}

.scrim {
	position: absolute;
	inset: 0;
	background: linear-gradient(
		90deg,
		var(--hero-scrim) 0%,
		color-mix(in srgb, var(--bg-deep) 74%, transparent) 55%,
		color-mix(in srgb, var(--bg-deep) 45%, transparent) 100%
	);
}

.zoom {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	justify-content: center;
	padding: 0 64px;
	transition: transform 320ms var(--ease);
}

.halt.leaving .zoom {
	transform: translateY(10px);
}

.col {
	display: flex;
	flex-direction: column;
	gap: 14px;
	max-width: 560px;
	animation: rise 320ms var(--ease);
}

.eyebrow {
	display: flex;
	align-items: center;
	gap: 8px;
	font: 500 11px var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
}

.title {
	font-size: 36px;
	line-height: 1.1;
	font-weight: 700;
	letter-spacing: -0.02em;
	text-wrap: balance;
}

.body {
	font-size: 16px;
	line-height: 1.5;
	color: var(--player-ink-muted);
	text-wrap: pretty;
}

.note {
	font-size: 14px;
	line-height: 1.5;
	color: var(--player-ink-muted);
	text-wrap: pretty;
}

.mono {
	padding: 10px 12px;
	border-radius: var(--radius-md);
	background: color-mix(in srgb, var(--bg-elevated) 72%, transparent);
	border: 1px solid var(--border);
	font: 400 12px var(--font-mono);
	line-height: 1.5;
	color: var(--player-ink-muted);
	overflow-wrap: anywhere;
}

.msg {
	display: flex;
	align-items: flex-start;
	gap: 12px;
	margin-top: 4px;
	padding: 14px 16px;
	border-radius: 14px;
	background: color-mix(in srgb, var(--bg-elevated) 82%, transparent);
	border: 1px solid var(--border-strong);
	backdrop-filter: blur(12px);
	-webkit-backdrop-filter: blur(12px);
}

.avatar {
	flex: none;
	width: 34px;
	height: 34px;
	border-radius: var(--radius-md);
	display: grid;
	place-items: center;
	font-size: 12px;
	font-weight: 600;
}

.msg-text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.msg-by {
	font-size: 12.5px;
	color: var(--fg-subtle);
}

.msg-by b {
	color: var(--player-ink);
	font-weight: 600;
}

.msg-body {
	font-size: 16px;
	line-height: 1.45;
	color: var(--player-ink);
	text-wrap: pretty;
}

.no-msg {
	font-size: 14px;
	color: var(--fg-subtle);
}

.count {
	display: flex;
	flex-direction: column;
	gap: 8px;
	max-width: 420px;
	margin-top: 4px;
}

.track {
	height: 4px;
	border-radius: var(--radius-full);
	background: var(--player-control-hover);
	overflow: hidden;
}

.fill {
	height: 100%;
	border-radius: var(--radius-full);
	transition: width 1s linear;
}

.count-text {
	font: 400 12px var(--font-mono);
	font-variant-numeric: tabular-nums;
	color: var(--player-ink-muted);
}

.wait {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-top: 2px;
	font: 400 12px var(--font-mono);
	color: var(--player-ink-muted);
}

.wait-dot {
	flex: none;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--status-warning);
	animation: pulse 1.6s ease-in-out infinite;
}

.alts {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-top: 6px;
}

.alts-title {
	font: 500 11px var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--fg-subtle);
}

.alt {
	display: flex;
	align-items: center;
	gap: 14px;
	min-height: 60px;
	padding: 10px 16px;
	border-radius: 14px;
	border: 1px solid var(--border-strong);
	background: color-mix(in srgb, var(--bg-elevated) 72%, transparent);
	backdrop-filter: blur(12px);
	-webkit-backdrop-filter: blur(12px);
	color: var(--player-ink);
	text-align: left;
	cursor: pointer;
	transition: background var(--dur-fast);
}

.alt:hover {
	background: var(--bg-hover);
}

.alt :global(svg) {
	flex: none;
}

.alt-text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 3px;
}

.alt-label {
	font-size: 15px;
	font-weight: 600;
}

.alt-sub {
	font: 400 12px var(--font-mono);
	opacity: 0.72;
}

.alt-go {
	display: grid;
	opacity: 0.6;
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	margin-top: 8px;
}

.primary {
	height: 48px;
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 0 22px 0 18px;
	border: 0;
	border-radius: var(--radius-player-controls);
	background: var(--player-ink);
	color: var(--fg-on-accent);
	font-size: 15px;
	font-weight: 600;
	cursor: pointer;
	white-space: nowrap;
}

.primary:hover {
	background: white;
}

.secondary {
	height: 48px;
	padding: 0 20px;
	border-radius: var(--radius-player-controls);
	border: 1px solid rgba(255, 255, 255, 0.18);
	background: transparent;
	color: var(--player-ink);
	font-size: 15px;
	font-weight: 500;
	cursor: pointer;
	white-space: nowrap;
}

.secondary:hover {
	background: var(--player-chip);
}

.primary:focus-visible {
	outline: none;
	box-shadow: 0 0 0 3px var(--player-accent);
}

.secondary:focus-visible {
	outline: none;
	background: var(--player-ink);
	color: var(--fg-on-accent);
}

@keyframes fade {
	from {
		opacity: 0;
	}
}

@keyframes rise {
	from {
		transform: translateY(10px);
	}
}

@keyframes pulse {
	50% {
		opacity: 0.3;
	}
}
</style>
