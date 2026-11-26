import { readFileSync } from "node:fs";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defaultClientConditions, defineConfig } from "vite";

// `cargo tauri android|ios dev` sets this to the host's LAN address: the app on
// the device loads the dev server over the network, not from localhost.
const host = process.env.TAURI_DEV_HOST;

// The target is fixed at build time: Tauri sets TAURI_ENV_PLATFORM, a plain Vite build leaves it unset.
// package.json's `#platform` import resolves to native.ts under the "native" condition, web.ts otherwise.
const native = !!process.env.TAURI_ENV_PLATFORM;

const csp: NonNullable<Parameters<typeof sveltekit>[0]>["csp"] = !native
	? {
			mode: "hash",
			directives: {
				"default-src": ["self"],
				// libass, which draws styled subtitles, is WebAssembly.
				"script-src": ["self", "wasm-unsafe-eval"],
				"worker-src": ["self"],
				"style-src": ["self", "unsafe-inline"],
				"img-src": ["self", "https:", "http:", "data:", "blob:"],
				"media-src": ["self", "https:", "http:", "blob:"],
				"connect-src": ["self", "https:", "http:"],
				"font-src": ["self", "data:"],
				"object-src": ["none"],
				"base-uri": ["self"],
				"form-action": ["self"],
			},
		}
	: undefined;

// Each client releases on its own version line (.taskfiles/release.yaml). The
// Tauri CLI sets TAURI_ENV_PLATFORM for the build it runs; a web build has none.
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const tauriPlatform = process.env.TAURI_ENV_PLATFORM;
const version =
	tauriPlatform === undefined
		? readJson("package.json").version
		: tauriPlatform === "android"
			? readJson("src-tauri/tauri.android.conf.json").version
			: /^version = "(.+)"$/m.exec(readFileSync("src-tauri/Cargo.toml", "utf8"))?.[1];

export default defineConfig({
	define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(version) },
	envPrefix: ["VITE_", "TAURI_ENV_"],
	plugins: [
		// Same strategy as `pnpm check` and as Streamline: the Settings choice, else the TV's language.
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/lib/paraglide",
			strategy: ["localStorage", "preferredLanguage", "baseLocale"],
			isServer: "false",
		}),
		sveltekit({
			// Tauri serves files, not a Node server: an SPA with one fallback page.
			adapter: adapter({ fallback: "index.html" }),
			paths: { base: (process.env.BASE_PATH ?? "") as "" | `/${string}` },
			csp,
		}),
	],
	resolve: { conditions: native ? ["native", ...defaultClientConditions] : undefined },
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
		watch: { ignored: ["**/src-tauri/**", "**/engine/**"] },
	},
});
