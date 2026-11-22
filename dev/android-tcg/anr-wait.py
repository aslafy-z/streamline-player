"""Keeps the player alive under software emulation by answering Android's ANR prompts.

Usage: python3 -u dev/android-tcg/anr-wait.py [package prefix]   (runs until adb goes away)

Under TCG the player cannot handle an input event within Android's 5 s, and the system kills
it. This registers as the activity controller (`am monitor`) and answers "wait" to the player's
ANRs and "continue" to everything else. Answering only the player matters: while a prompt is
unanswered the system blocks, and its watchdog restarts the whole framework.
"""

import os
import subprocess
import sys

ADB = os.path.join(
    os.environ.get("ANDROID_HOME", os.path.expanduser("~/android-sdk")), "platform-tools/adb"
)
PACKAGE = sys.argv[1] if len(sys.argv) > 1 else "com.datahearth.streamline_player"


def main() -> None:
    monitor = subprocess.Popen(
        [ADB, "shell", "am", "monitor"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    assert monitor.stdin and monitor.stdout
    process, waiting, options = "", False, set()
    for line in monitor.stdout:
        sys.stdout.write(line)
        text = line.strip()
        if text.startswith("processName:"):
            process = text.split(":", 1)[1].strip()
        if text.startswith("Waiting after"):
            waiting, options = True, set()
        if waiting and text.startswith("(") and ")" in text:
            options.add(text[1])
        if waiting and text.startswith("(q)uit"):
            answer = "w" if process.startswith(PACKAGE) and "w" in options else "c"
            print(f">> answering {answer} for {process}", flush=True)
            monitor.stdin.write(answer + "\n")
            monitor.stdin.flush()
            waiting, process = False, ""


if __name__ == "__main__":
    main()
