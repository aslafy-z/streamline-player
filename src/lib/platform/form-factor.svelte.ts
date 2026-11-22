import { createSubscriber } from "svelte/reactivity";
import { isPhoneSize } from "#lib/platform/form-factor.ts";
import { keyboardWatch, typesText } from "#lib/platform/keyboard.ts";
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

// The keyboard shrinks the window (the app pads above it, the web resizes the content), and a
// tablet less its keyboard can stand under a phone's short side: the size read leaves it out, or
// focusing a field would swap the shell, unmount the field and close the keyboard again.
const steady = keyboardWatch();

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
	const width = window.innerWidth;
	const { height } = steady(width, window.innerHeight, typesText(document.activeElement));
	return isPhoneSize(width, height) ? "phone" : "tablet";
}

export const isTablet = () => formFactor() === "tablet";
export const isPhone = () => formFactor() === "phone";
