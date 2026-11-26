<script lang="ts">
let {
	usedPct,
	otherPct,
	labels,
	plain = false,
}: {
	usedPct: number;
	otherPct: number;
	/** Streamline, other apps, free; a narrow screen leaves the middle one out. */
	labels: [string, string, string] | [string, string];
	/** Without the card around it, for a settings row. */
	plain?: boolean;
} = $props();
</script>

<div class="card" class:plain>
	<div class="meter" role="img" aria-label={labels.join(", ")}>
		<b class="used" style:width="{usedPct}%"></b>
		<b class="other" style:width="{otherPct}%"></b>
	</div>
	<div class="legend">
		<span class="me">{labels[0]}</span>
		{#if labels.length === 3}
			<span>{labels[1]}</span>
		{/if}
		<span class="free">{labels.at(-1)}</span>
	</div>
</div>

<style>
.card {
	box-sizing: border-box;
	max-width: 440px;
	padding: 14px 16px;
	border: 1px solid var(--border);
	border-radius: var(--radius-lg);
	background: var(--bg-elevated);
}

.card.plain {
	max-width: none;
	padding: 0;
	border: 0;
	border-radius: 0;
	background: transparent;
}

.meter {
	display: flex;
	height: 8px;
	overflow: hidden;
	border-radius: 4px;
	background: var(--progress-track);
}

b {
	display: block;
	height: 100%;
}

.used {
	background: var(--player-accent);
}

.other {
	background: color-mix(in srgb, var(--fg) 22%, transparent);
}

.legend {
	display: flex;
	gap: 16px;
	margin-top: 8px;
	font: 400 11.5px var(--font-mono);
	color: var(--fg-subtle);
}

.plain .legend {
	margin-top: 0;
}

.plain .meter {
	margin-bottom: 8px;
}

.me {
	color: var(--accent-text);
}

.free {
	margin-left: auto;
}
</style>
