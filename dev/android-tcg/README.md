# The TV app in an Android TV emulator without KVM

How to run the player on the `streamline-tv` Android TV emulator inside a container that has no
`/dev/kvm` (a Claude Code cloud session, most CI runners), against a throwaway Streamline with
the `player` extension and the engine, and drive it with D-pad key events.

Everything runs under QEMU's software CPU (TCG). It is slow (first boot about 12 minutes, the
app's first paint about 3, a few seconds per key press, video at a few frames per second) but it
is the real APK, the real WebView, ExoPlayer and the Android Keystore. With KVM, use
`task dev:android` instead.

Out of the box it does not work: the emulator's QEMU (2.12-based) mistranslates two families of
x86 instructions, and the Android WebView cannot run on it. `patch-qemu.py` fixes them; the
[troubleshooting](#what-goes-wrong-and-why) section says how they show up.

## Files

| File | What it is |
| --- | --- |
| `patch-qemu.py`, `qemu-fixes.s` | Patches the emulator's QEMU binary (emulator 37.3.10 only, checked by SHA-256) |
| `check-cpu.c` | Run in the emulator: checks the patched instructions |
| `emulator.sh` | Boots the AVD under TCG; launches the player with its ports and DevTools forwarded |
| `anr-wait.py` | Answers Android's ANR prompts with "wait" for the player, so the system does not kill it |
| `remote.ts` | D-pad driver: key events over adb, focus read over CDP, types on the welcome keyboard |
| `approve-pairing.py` | Approves the TV's pairing code as the stack's admin (what `/pair` does from a phone) |
| `ffmpeg-svtav1/` | ffmpeg wrapper for Ubuntu 24.04's ffmpeg, whose SVT-AV1 refuses the engine's AV1 rate cap |

Paths below assume the three repositories side by side, as `../streamline` and
`../streamline-player-ext` from this one, and the SDK in `~/android-sdk`.

## 1. Check the machine

```sh
ls /dev/kvm   # absent: this guide; present: use task dev:android
nproc; free -g; df -h ~
```

4 CPUs, 16 GB of RAM and about 15 GB of disk are enough. The emulator uses one host thread for
the guest CPU (see "multi-threaded TCG" below), so more cores mostly speed up the builds.

The network needs `dl.google.com` (SDK, Gradle's Maven), `services.gradle.org`, the npm, crates
and Go module proxies. `nix develop .#android` is not an option in a cloud session: its flake
inputs come from GitHub tarballs, which the session's proxy refuses for repositories outside its
scope. Everything is installed by hand instead.

## 2. Android SDK, emulator and AVD

```sh
export ANDROID_HOME=~/android-sdk ANDROID_SDK_ROOT=~/android-sdk ANDROID_AVD_HOME=~/.android/avd
mkdir -p $ANDROID_HOME && cd $ANDROID_HOME
curl -sSLO https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip
unzip -q commandlinetools-linux-16111833_latest.zip
mkdir -p cmdline-tools/latest && mv cmdline-tools/{bin,lib,NOTICE.txt,source.properties} cmdline-tools/latest/
sdk=cmdline-tools/latest/bin/sdkmanager
yes | $sdk --sdk_root=$ANDROID_HOME --licenses >/dev/null
yes | $sdk --sdk_root=$ANDROID_HOME emulator platform-tools "system-images;android-36;android-tv;x86_64" \
  "platforms;android-36" "platforms;android-37.0" "build-tools;36.0.0" "build-tools;37.0.0" "ndk;29.0.14206865"
```

The same packages as the flake's `android` devshell. The patch needs emulator **37.3.10**
(build 16970787). If `emulator/emulator -version` names another one, install that build:

```sh
cd $ANDROID_HOME && curl -sSLO https://dl.google.com/android/repository/emulator-linux_x64-16970787.zip
echo "5f7314368fc6c05c937f6991bb4106214dc389e7  emulator-linux_x64-16970787.zip" | sha1sum -c
rm -rf emulator && unzip -q emulator-linux_x64-16970787.zip
```

The AVD, the name `task dev:android` uses too:

```sh
echo no | $ANDROID_HOME/cmdline-tools/latest/bin/avdmanager create avd -n streamline-tv \
  -k "system-images;android-36;android-tv;x86_64" -d tv_1080p
cat >> $ANDROID_AVD_HOME/streamline-tv.avd/config.ini <<'EOF'
hw.ramSize=4096
hw.cpu.ncore=4
hw.gpu.enabled=yes
hw.gpu.mode=auto
EOF
```

## 3. Patch the emulator

```sh
python3 dev/android-tcg/patch-qemu.py   # needs cc, nm and objcopy (binutils)
```

It keeps the original as `qemu-system-x86_64-headless.orig`, patches from that copy, and checks
both the original's and the result's SHA-256, so it refuses any other build and can run twice.
Stop the emulator first: a running binary cannot be rewritten.

## 4. Build

Streamline needs Go 1.27, which `GOTOOLCHAIN=auto` downloads; `task` comes from `go install`.

```sh
export GOTOOLCHAIN=auto PATH=$HOME/go/bin:$PATH
go install github.com/go-task/task/v3/cmd/task@latest
(cd ../streamline && pnpm install --frozen-lockfile && task build:js build:css \
  && go build -o /tmp/streamline-player-ext/streamline ./cmd)
(cd ../streamline-player-ext && GOOS=wasip1 GOARCH=wasm go build -trimpath -buildmode=c-shared -o player.wasm .)
cargo build -p engine
```

The APK, x86_64 only (the emulator's ABI). JDK 21 works; the Tauri CLI takes about 6 minutes to
compile:

```sh
cargo install tauri-cli --version "^2" --locked
pnpm install --frozen-lockfile
export NDK_HOME=$ANDROID_HOME/ndk/29.0.14206865 JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
cargo tauri android build --debug --apk --target x86_64
```

The debug library is about 190 MB, which takes minutes to install under TCG. Strip it and sign
the APK again with the debug key:

```sh
apk=src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
bt=$ANDROID_HOME/build-tools/37.0.0; w=$(mktemp -d)
cp $apk $w/in.apk && (cd $w && unzip -q in.apk lib/x86_64/libstreamline_player_lib.so \
  && $NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip --strip-unneeded lib/x86_64/libstreamline_player_lib.so \
  && { zip -q -d in.apk 'META-INF/*' || true; } && zip -q -0 in.apk lib/x86_64/libstreamline_player_lib.so \
  && $bt/zipalign -f -p 4 in.apk aligned.apk \
  && $bt/apksigner sign --ks ~/.android/debug.keystore --ks-pass pass:android --key-pass pass:android \
       --out /tmp/streamline-tv.apk aligned.apk)
```

## 5. Boot the stack

The e2e harness seeds the demo library (`dev/mock-library.json`, ffmpeg-made 8-second clips),
creates an admin and connects the engine. Put the ffmpeg wrapper first on `PATH`: the harness
gives both Streamline and the engine the directory it finds `ffmpeg` in.

```sh
cd ../streamline-player-ext
PATH=$OLDPWD/dev/android-tcg/ffmpeg-svtav1:$PATH \
STREAMLINE_BIN=/tmp/streamline-player-ext/streamline ENGINE_BIN=$OLDPWD/target/debug/engine \
  go run ./e2e/cmd/stack --library $OLDPWD/dev/mock-library.json --port 8081
```

It prints one JSON line: Streamline on `:8081`, the engine on a free port (`"engine"`), and the
admin's login. Keep both ports; the app reaches each at `127.0.0.1`.

## 6. Boot the emulator and install the app

```sh
dev/android-tcg/emulator.sh boot
NDK_CLANG=$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/clang
$NDK_CLANG --target=x86_64-linux-android29 -O0 -o /tmp/check-cpu dev/android-tcg/check-cpu.c
adb=$ANDROID_HOME/platform-tools/adb
$adb push /tmp/check-cpu /data/local/tmp/ && $adb shell /data/local/tmp/check-cpu   # CPU checks passed
$adb push /tmp/streamline-tv.apk /data/local/tmp/app.apk && $adb shell pm install -r -t /data/local/tmp/app.apk
```

Install with `push` then `pm install`, not `adb install`: under TCG the streamed install outlives
adb's timeout, reports a failure, carries on in the device and later kills the running app as it
replaces it.

## 7. Launch and drive the player

```sh
dev/android-tcg/emulator.sh app 8081 <engine port>
```

It reverses both ports into the emulator, starts `anr-wait.py`, opens the player and forwards its
WebView's DevTools to `127.0.0.1:9222` (a debug build is inspectable; Chrome's
`chrome://inspect` works too, through the same forward).

Then, with the remote:

```sh
node dev/android-tcg/remote.ts type "http://127.0.0.1:8081"   # the address, on the on-screen keyboard
node dev/android-tcg/remote.ts keys LEFT LEFT LEFT             # until the focus is on Continue
node dev/android-tcg/remote.ts keys CENTER
python3 dev/android-tcg/approve-pairing.py                     # approves the code the TV shows
node dev/android-tcg/remote.ts keys CENTER                     # Start watching
```

`remote.ts focus` prints the focused element, `remote.ts eval "<js>"` evaluates in the page, and
`keys` takes `UP DOWN LEFT RIGHT CENTER BACK PLAY_PAUSE` (or any Android key code). Screenshots:

```sh
$adb exec-out screencap -p > screen.png
```

`dev/android-tcg/emulator.sh stop` stops the emulator; the AVD keeps the app, its pairing and the
disabled packages, and the next boot takes about 4 minutes.

## What goes wrong, and why

**The app shows a black screen, then the system's launcher.** The WebView renderer dies about
100 s after it starts (`signal 5 (SIGTRAP)` in `CrRendererMain`, then `Render process's crash
wasn't handled by all associated webviews`). On Android, V8 verifies its startup snapshot's
checksum once per process, unconditionally (`snapshot-external.cc`, no flag turns it off), with
zlib's SSSE3 Adler-32, which ends in `phaddd %xmm6,%xmm6`. The emulator's QEMU writes the low
half of the destination before reading the source, so with one register as both it returns
`3 7 10 14` for `[1 2 3 4]` instead of `3 7 3 7`; the checksum does not match and V8 aborts.
`phaddw`, `phaddsw`, `phsubw`, `phsubd` and `phsubsw` share the bug. Patch 1.

**The page renders its background, then throws `Illegal invocation` and `e.getAttribute is not a
function`.** QEMU's softfloat saturates NaN, +∞ and positive overflow to `INT_MAX` in every
float-to-int conversion, where x86 returns the "integer indefinite" `INT_MIN`. V8's JIT converts
with `cvttsd2si` and leaves its fast path on `INT_MIN`, so NaN became 2147483647 and DOM code went
wrong. Patch 2 does those conversions with the host's own instructions.

`check-cpu.c` covers both. A wider comparison of about 150 SSE, SSSE3, SSE4 and bit-manipulation
forms against the host found nothing else, apart from `rcpps`/`rsqrtps`, which are approximations
on real hardware and exact in QEMU.

**The app disappears after a few minutes.** An input event waited more than 5 s: ANR, and with no
dialog to show, the system kills the app. `anr-wait.py` answers "wait". It answers "continue" to
every other process on purpose: a controller that leaves another process's prompt unanswered
blocks the activity manager, and the framework's watchdog then restarts the whole system.

**Multi-threaded TCG** (`-qemu -accel tcg,thread=multi`) uses more host cores but never finishes
booting: the framework's watchdog kills `system_server` in a loop. Single-threaded TCG boots.

**`adb install` fails, and the app dies later.** See step 6.

**Playback stops with `ERROR_CODE_IO_BAD_HTTP_STATUS` (503 `ffmpeg_failed`).** The emulator's
software AV1 decoder makes the server choose AV1, and the engine caps the bitrate with
`-maxrate`/`-bufsize`, which the SVT-AV1 in Ubuntu 24.04's ffmpeg 6.1 rejects ("Nothing was
written into output file"). The wrapper in `ffmpeg-svtav1/` drops both for `libsvtav1`.

**No posters.** The harness copies art only with `--art <dir>`, and the repository ships none.

**`/data/local/tmp/webview-command-line` changes nothing.** On this user build the WebView did not
read it, even with the player set as the debug app, and the snapshot check is not behind a flag
anyway.
