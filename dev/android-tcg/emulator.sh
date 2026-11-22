#!/usr/bin/env bash
# Runs the streamline-tv AVD with software emulation (no KVM) and the player on it.
#   dev/android-tcg/emulator.sh boot                 start the emulator, wait for the launcher
#   dev/android-tcg/emulator.sh app PORT [PORT...]   route the stack's ports, launch the player,
#                                                     forward its DevTools to :9222
#   dev/android-tcg/emulator.sh stop
# Logs go to $LOG_DIR (default /tmp/android-tcg).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
export ANDROID_HOME=${ANDROID_HOME:-$HOME/android-sdk}
export ANDROID_AVD_HOME=${ANDROID_AVD_HOME:-$HOME/.android/avd}
adb=$ANDROID_HOME/platform-tools/adb
logs=${LOG_DIR:-/tmp/android-tcg}
pkg=com.datahearth.streamline_player.debug
mkdir -p "$logs"
[ -x "$adb" ] || { echo "no SDK at ANDROID_HOME=$ANDROID_HOME (README, step 2)" >&2; exit 1; }

booted() { [ "$(timeout 15 "$adb" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; }

case ${1:-} in
boot)
	if ! "$adb" get-state >/dev/null 2>&1; then
		rm -f "$ANDROID_AVD_HOME"/streamline-tv.avd/*.lock
		# The emulator refuses TCG unless asked twice. Multi-threaded TCG (-qemu -accel
		# tcg,thread=multi) is slower here: the framework's watchdog restarts it in a loop.
		ANDROID_I_WANT_MY_TCG=yes nohup "$ANDROID_HOME/emulator/emulator" -avd streamline-tv \
			-no-window -no-audio -no-boot-anim -no-snapshot -accel off -cores 4 \
			>"$logs/emulator.log" 2>&1 &
	fi
	echo "booting (first boot about 12 min, later ones about 4)…"
	sleep 20
	until booted; do sleep 15; done
	# boot_completed comes minutes before the launcher (or the player, on a rerun) has a window.
	# Not grep -q: under pipefail, its early exit fails dumpsys with SIGPIPE and the loop never ends.
	until timeout 15 "$adb" shell dumpsys window 2>/dev/null | grep "mCurrentFocus=Window" >/dev/null; do
		sleep 10
	done
	# Background apps a TV image starts and the player never needs: each one competes for the
	# single emulated CPU thread. Some refuse to be disabled; that is fine.
	for p in com.android.vending com.google.android.play.games com.google.android.tvrecommendations \
		com.google.android.healthconnect.controller com.google.android.backdrop \
		com.google.android.apps.mediashell com.google.android.syncadapters.calendar; do
		"$adb" shell pm disable-user --user 0 "$p" >/dev/null 2>&1 || true
	done
	echo "booted"
	;;
app)
	shift
	[ $# -gt 0 ] || { echo "usage: $0 app PORT [PORT...]" >&2; exit 2; }
	# 127.0.0.1 inside the emulator is the emulator: reverse each port the app reaches (Streamline
	# and the engine, whose public URL the harness sets to 127.0.0.1:<port>).
	for port in "$@"; do "$adb" reverse "tcp:$port" "tcp:$port" >/dev/null; done
	if ! pgrep -f "android-tcg/anr-wait.py" >/dev/null; then
		nohup python3 -u "$here/anr-wait.py" >"$logs/anr-wait.log" 2>&1 &
	fi
	timeout 120 "$adb" shell am start -n "$pkg/com.datahearth.streamline_player.MainActivity" >/dev/null
	socket=
	until [ -n "$socket" ]; do
		sleep 5
		socket=$(timeout 15 "$adb" shell cat /proc/net/unix | grep -o "webview_devtools_remote_[0-9]*" | head -1 || true)
	done
	"$adb" forward --remove-all
	"$adb" forward tcp:9222 "localabstract:$socket" >/dev/null
	echo "player started; DevTools on http://127.0.0.1:9222 (first paint takes about 3 min)"
	;;
stop)
	pkill -f "android-tcg/anr-wait.py" || true
	timeout 30 "$adb" emu kill || true
	;;
*)
	sed -n 2,7p "$0" | sed 's/^# \{0,1\}//'
	exit 2
	;;
esac
