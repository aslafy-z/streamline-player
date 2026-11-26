<script lang="ts">
import { audioLanguages, subtitleLanguages } from "#lib/core/playback/choice.ts";
import { languageLabel } from "#lib/core/playback/names.ts";
import { language } from "#lib/core/playback/rules.ts";
import { m as i18n } from "#lib/paraglide/messages.js";
import LanguagePopover from "#lib/ui/LanguagePopover.svelte";
import { presence } from "#lib/ui/presence.svelte.ts";
import { applyCardLang, cardLang, type LangOpen } from "#lib/screens/title-card.svelte.ts";

let { barHeight }: { barHeight: number } = $props();

const W = 264;
const H = 330;
const GAP = 8;
const EDGE = 12;

const popover = presence(() => cardLang.open !== null, 190);
let last = $state.raw<LangOpen | null>(null);
$effect(() => {
	if (cardLang.open) last = cardLang.open;
});
const shown = $derived(cardLang.open ?? last);

const at = $derived.by(() => {
	const a = shown?.anchor;
	if (!a) return { x: 0, y: 0, up: false };
	const x = Math.max(EDGE, Math.min(innerWidth - W - EDGE, a.right - W + GAP));
	const up = a.bottom + GAP + H > innerHeight && a.top - GAP - H >= barHeight + GAP;
	return { x, y: up ? a.top - GAP : a.bottom + GAP, up };
});

const named = (name: string, from: { language: string }[]) => {
	const hit = from.find((x) => language(x.language) === name);
	return hit ? languageLabel(hit.language) : name;
};
const audio = $derived(audioLanguages(shown?.tracks?.audio ?? []));

$effect(() => {
	if (!cardLang.open) return;
	const close = () => {
		cardLang.open = null;
	};
	const onPress = (e: PointerEvent) => {
		const el = e.target as Element | null;
		if (el?.closest('[role="dialog"]') || el?.closest("[data-lang-trigger]")) return;
		close();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape") return;
		e.stopPropagation();
		close();
	};
	// Anchored to where the button was: once the page moves under it, it points at nothing.
	const onScroll = (e: Event) => {
		if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return;
		close();
	};
	document.addEventListener("pointerdown", onPress, true);
	window.addEventListener("keydown", onKey, true);
	window.addEventListener("scroll", onScroll, { capture: true, passive: true });
	return () => {
		document.removeEventListener("pointerdown", onPress, true);
		window.removeEventListener("keydown", onKey, true);
		window.removeEventListener("scroll", onScroll, { capture: true });
	};
});
</script>

{#if popover.mounted && shown}
	<div class="layer">
		<LanguagePopover
			title={i18n.card_lang_title_for({ title: shown.t.title })}
			audioLabel={i18n.player_audio()}
			subsLabel={i18n.player_subtitles()}
			audio={audio.map((name) => ({ value: name, label: named(name, shown.tracks?.audio ?? []) }))}
			subs={[
				{ value: "off", label: i18n.player_subtitles_off() },
				{ value: "forced", label: i18n.detail_forced_only() },
				...subtitleLanguages(shown.tracks?.subtitles ?? []).map((name) => ({
					value: name,
					label: named(name, shown.tracks?.subtitles ?? []),
				})),
			]}
			draft={shown.draft}
			hint={shown.kind === "movies"
				? i18n.card_lang_hint_movie({ title: shown.t.title })
				: i18n.card_lang_hint_series({ title: shown.t.title })}
			applyLabel={i18n.detail_apply()}
			unavailable={audio.length ? undefined : i18n.detail_lang_unavailable()}
			x={at.x}
			y={at.y}
			up={at.up}
			shown={popover.shown && cardLang.open !== null}
			onpick={(patch) => {
				if (cardLang.open) cardLang.open.draft = { ...cardLang.open.draft, ...patch };
			}}
			onapply={applyCardLang}
		/>
	</div>
{/if}

<style>
.layer {
	position: fixed;
	inset: 0;
	z-index: 40;
	pointer-events: none;
}
</style>
