import { createSubscriber } from "svelte/reactivity";
import { isPhoneSize } from "#lib/platform/form-factor.ts";
import { pageSize } from "#lib/platform/keyboard.svelte.ts";
import { FORM_FACTOR, type FormFactor, IS_WEB, TARGET } from "#lib/platform/target.ts";

export { isPhoneSize };

const OVERRIDES: FormFactor[] = ["phone", "tablet", "desktop"];

const override = (): FormFactor | null => {
	if (!import.meta.env.DEV) return null;
	try {
		const asked =
			new URLSearchParams(location.search).get("form") ?? localStorage.getItem("slp.form");
		return OVERRIDES.find((f) => f === asked) ?? null;
	} catch {
		return null;
	}
};
// Read once: a client-side navigation drops the query, the module outlives it.
const forced = override();

const subscribe = createSubscriber((update) => {
	const coarse = matchMedia("(pointer: coarse)");
	window.addEventListener("resize", update);
	window.addEventListener("orientationchange", update);
	coarse.addEventListener("change", update);
	return () => {
		window.removeEventListener("resize", update);
		window.removeEventListener("orientationchange", update);
		coarse.removeEventListener("change", update);
	};
});

export function formFactor(): FormFactor {
	if (FORM_FACTOR === "tv") return "tv";
	if (TARGET === "darwin" || TARGET === "linux" || TARGET === "windows") return "desktop";
	subscribe();
	if (forced) return forced;
	const touch = !IS_WEB || matchMedia("(pointer: coarse)").matches;
	if (!touch) return "desktop";
	// The size without the keyboard: on a landscape tablet the keyboard leaves less than a phone's
	// short side, and the phone layout would take the field being typed into away, and the
	// keyboard with it. A split screen or a smaller window does change it.
	const { width, height } = pageSize();
	return isPhoneSize(width, height) ? "phone" : "tablet";
}

export const isTablet = () => formFactor() === "tablet";
export const isPhone = () => formFactor() === "phone";
