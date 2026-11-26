#!/usr/bin/env bash
# The page side of the bench: dev/bench/stack.sh prepare|front|up|down
#   prepare  release engine, fixtures (art and a clip), then front
#   front    the desktop build with __TAURI_ renamed, from this checkout or from BENCH_FRONT
#            (another checkout: a branch's pages on this harness); kept per commit under
#            $BENCH_OUT/fronts, so going back to one does not build it again. Run up after it.
#   up       engine :8097, mock :8081, contract proxy :8098, bridge :8099, build on :1440
#   down     stops them
# Everything lands under BENCH_OUT (default /tmp/streamline-bench).
set -eu
cd "$(dirname "$0")/../.."
out=${BENCH_OUT:-/tmp/streamline-bench}
media=$out/media
logs=$out/logs
mkdir -p "$logs" "$media"

down() {
	pkill -f dev/mock-streamline.py || true
	pkill -f "target/release/engine --config $out" || true
	pkill -f dev/contract/proxy.ts || true
	pkill -f dev/compare/bridge.py || true
	pkill -f dev/compare/serve.mjs || true
}

fixtures() {
	# Textured JPEGs, so decoding and scaling cost what real artwork does, and an H.264 clip.
	mkdir -p "$media/art/p" "$media/art/b" "$media/art/c"
	local slugs people i=0 j=0
	slugs=$(python3 -c "import json;d=json.load(open('dev/mock-library.json'));print(' '.join([m['slug'] for m in d['movies']]+[s['slug'] for s in d['series']]))")
	people=$(python3 -c "import json;d=json.load(open('dev/mock-library.json'));print(' '.join(d['people']))")
	for s in $slugs; do
		i=$((i + 1))
		ffmpeg -y -v error -f lavfi -i "mandelbrot=s=780x1170:start_scale=$((i % 7 + 1)):inner=convergence,hue=h=$((i * 37))" -frames:v 1 -q:v 3 "$media/art/p/$s.jpg"
		ffmpeg -y -v error -i "$media/art/p/$s.jpg" -vf scale=342:-2 -q:v 3 "$media/art/p/$s-w342.jpg"
		ffmpeg -y -v error -f lavfi -i "cellauto=s=1920x1080:rule=$((i * 13 % 255)),scale=1920:1080,gblur=sigma=2,hue=h=$((i * 53)):s=3" -frames:v 1 -q:v 3 "$media/art/b/$s.jpg"
	done
	for p in $people; do
		j=$((j + 1))
		ffmpeg -y -v error -f lavfi -i "gradients=s=300x450:seed=$j" -frames:v 1 -q:v 4 "$media/art/c/$p.jpg"
	done
	ffmpeg -y -v error -f lavfi -i testsrc2=d=120:s=1920x1080:r=24 -f lavfi -i sine=f=440:d=120 \
		-c:v libx264 -preset veryfast -pix_fmt yuv420p -g 48 -c:a aac "$media/h.mkv"
}

front() {
	local src rev built
	src=$(cd "${BENCH_FRONT:-.}" && pwd)
	rev=$(git -C "$src" rev-parse --short HEAD)
	# Uncommitted pages have no commit to be kept under: they are built every time.
	[ -z "$(git -C "$src" status --porcelain -- src static package.json vite.config.ts)" ] || rev=$rev-dirty
	built=$out/fronts/$rev
	if [ ! -d "$built" ] || [[ $rev == *-dirty ]]; then
		(cd "$src" && pnpm install --frozen-lockfile && TAURI_ENV_PLATFORM=linux pnpm build)
		rm -rf "$built"
		mkdir -p "$out/fronts"
		cp -r "$src/build" "$built"
	fi
	# The pages' own shim: it answers the commands those pages send.
	cp "$src/dev/compare/shim.js" "$built.shim.js"
	rm -rf "$out/desktop-build"
	cp -r "$built" "$out/desktop-build"
	# The single-animation pages, served beside the build: runner.mjs --url …/_bench/anim.html
	cp -r dev/bench/pages "$out/desktop-build/_bench"
	# Tauri's __TAURI_INTERNALS__ is frozen: the page must look for the shim's under another name.
	grep -rl "__TAURI_" "$out/desktop-build" | xargs -r sed -i 's/__TAURI_/__BENCHT_/g'
	# After the rename, which the runner does itself on the shim.
	[ ! -f "$built.shim.js" ] || cp "$built.shim.js" "$out/desktop-build/_bench/shim.js"
	echo "$rev" >"$out/desktop-build/_bench/front"
	echo "front: $rev ($src)"
}

prepare() {
	cargo build --release -p engine
	[ -f "$media/h.mkv" ] || fixtures
	sed "s|/tmp/streamline-player|$media|g" dev/engine.yaml >"$out/engine.yaml"
	mkdir -p "$media/live" "$media/jobs"
	front
}

up() {
	down
	[ -d "$out/desktop-build" ] || {
		echo "run: dev/bench/stack.sh prepare" >&2
		exit 1
	}
	target/release/engine --config "$out/engine.yaml" >"$logs/engine.log" 2>&1 &
	python3 dev/mock-streamline.py --listen 127.0.0.1:8081 --secret dev-secret-0123456789abcdef --now 1794225600 \
		--art "$media/art" --demo-progress --demo-markers --clip "$media/h.mkv" >"$logs/mock.log" 2>&1 &
	node dev/contract/proxy.ts --listen 127.0.0.1:8098 --upstream http://127.0.0.1:8081 \
		--spec docs/contract/player.openapi.yaml --report "$logs/contract.jsonl" >"$logs/proxy.log" 2>&1 &
	python3 dev/compare/bridge.py >"$logs/bridge.log" 2>&1 &
	node dev/compare/serve.mjs "$out/desktop-build" "" 1440 >"$logs/serve.log" 2>&1 &
	for _ in $(seq 1 60); do
		curl -sf -o /dev/null http://127.0.0.1:8099/extensions/player/home && curl -sf -o /dev/null http://127.0.0.1:1440/ && break
		sleep 0.5
	done
	for u in 127.0.0.1:8099/extensions/player/home 127.0.0.1:1440/; do
		printf '%s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' "http://$u")"
	done
}

"${1:-up}"
