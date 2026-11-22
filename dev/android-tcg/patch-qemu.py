"""Patches the Android emulator's QEMU so an Android WebView runs under TCG (no KVM).

Usage: python3 dev/android-tcg/patch-qemu.py [path to qemu-system-x86_64-headless]

Assembles qemu-fixes.s with the host's cc and writes each function over the helper it
replaces. It refuses any binary but emulator 37.3.10's (build 16970787): the offsets below
were read off that build's disassembly. It keeps the original next to it as `.orig` and
patches from that copy, so running it twice is harmless.
"""

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.join(
    os.environ.get("ANDROID_HOME", os.path.expanduser("~/android-sdk")),
    "emulator/qemu/linux-x86_64/qemu-system-x86_64-headless",
)
ORIGINAL_SHA256 = "b7b911bbecea4303624eab82de262550f4d29d389f5f7411de3f586ce0f2f596"
PATCHED_SHA256 = "d4a068f5cf88c548949fe8ea038c955d6aba648c26719bd39dcc85ed20a26a25"

# Executable LOAD segment of that build: file offset = vaddr - TEXT_VADDR + TEXT_OFFSET.
TEXT_VADDR, TEXT_OFFSET = 0x7F0640, 0x7EF640

# name in qemu-fixes.s -> (vaddr, size of the original function up to and including its ret)
SLOTS = {
    # target/i386/ops_sse.h, xmm variants, in source order.
    "phaddw": (0x90CE90, 0x5F),
    "phaddd": (0x90CEF0, 0x28),
    "phaddsw": (0x90CF20, 0xB3),
    "phsubw": (0x90D1A0, 0x5F),
    "phsubd": (0x90D200, 0x28),
    "phsubsw": (0x90D230, 0xB2),
    # fpu/softfloat.c FLOAT_TO_INT(32|64, 32|64), each with round_to_int_and_pack inlined.
    "f32_i32_rnd": (0x825520, 0x200),
    "f32_i32_rtz": (0x825720, 0x200),
    "f32_i64_rnd": (0x825920, 0x210),
    "f32_i64_rtz": (0x825B30, 0x210),
    "f64_i32_rnd": (0x826160, 0x210),
    "f64_i32_rtz": (0x826370, 0x210),
    "f64_i64_rnd": (0x826580, 0x220),
    "f64_i64_rtz": (0x8267A0, 0x200),
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def assemble() -> dict[str, bytes]:
    with tempfile.TemporaryDirectory() as tmp:
        obj = os.path.join(tmp, "fixes.o")
        subprocess.run(["cc", "-c", os.path.join(HERE, "qemu-fixes.s"), "-o", obj], check=True)
        syms = {}
        nm = subprocess.run(["nm", "-n", obj], capture_output=True, text=True, check=True)
        for line in nm.stdout.splitlines():
            parts = line.split()
            if len(parts) == 3:
                syms[parts[2]] = int(parts[0], 16)
        text = subprocess.run(
            ["objcopy", "-O", "binary", "--only-section=.text", obj, "/dev/stdout"],
            capture_output=True,
            check=True,
        ).stdout
    return {name: text[syms[name] : syms[name + "_end"]] for name in SLOTS}


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    orig = path + ".orig"
    if not os.path.exists(orig):
        shutil.copy2(path, orig)
    with open(orig, "rb") as f:
        data = bytearray(f.read())
    if sha256(data) != ORIGINAL_SHA256:
        sys.exit(f"{orig} is not emulator 37.3.10's QEMU (sha256 {sha256(data)}); not patching")
    for name, code in assemble().items():
        vaddr, size = SLOTS[name]
        off = vaddr - TEXT_VADDR + TEXT_OFFSET
        if len(code) > size:
            sys.exit(f"{name}: {len(code)} bytes do not fit the {size}-byte slot")
        if name.startswith("ph"):
            # The whole old body goes; int3 fills what the new one leaves.
            assert data[off + size - 1] == 0xC3, f"{name}: slot does not end with ret"
            data[off : off + size] = code + b"\xcc" * (size - len(code))
        else:
            # push %rbp; push %rbx opens each softfloat function; the new body returns early.
            assert data[off : off + 2] == b"\x55\x53", f"{name}: unexpected prologue"
            data[off : off + len(code)] = code
        print(f"{name:12} {len(code):3} bytes at {vaddr:#x}")
    if sha256(data) != PATCHED_SHA256:
        sys.exit(f"patched sha256 {sha256(data)} differs from the validated one; not writing")
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    shutil.copymode(orig, tmp)
    os.replace(tmp, path)
    print(f"patched {path} (original kept as {orig})")


if __name__ == "__main__":
    main()
