// Checks, inside the emulator, the two instruction families patch-qemu.py fixes.
// Build: $NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/clang --target=x86_64-linux-android29
//        -O0 -o check-cpu dev/android-tcg/check-cpu.c
// Run:   adb push check-cpu /data/local/tmp/ && adb shell /data/local/tmp/check-cpu
// Prints each failure and exits 1; an unpatched emulator fails all of them.
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static int bad;

static void expect(const char* what, const void* got, const void* want, size_t n) {
  if (memcmp(got, want, n)) {
    printf("FAIL %s\n", what);
    bad++;
  }
}

// Each runs `op %xmm6, %xmm6`: source and destination are the same register.
#define SAME(op)                                                                       \
  static void same_##op(void* v) {                                                     \
    __asm__ volatile("movdqu (%0), %%xmm6\n " #op " %%xmm6, %%xmm6\n movdqu %%xmm6, (%0)" \
                     ::"r"(v) : "xmm6", "memory");                                     \
  }
SAME(phaddw) SAME(phaddd) SAME(phaddsw) SAME(phsubw) SAME(phsubd) SAME(phsubsw)

static int16_t sat16(int32_t x) { return x > 32767 ? 32767 : x < -32768 ? -32768 : (int16_t)x; }

int main(void) {
  int32_t d[4] = {1, 2, 3, 4}, dw[4] = {3, 7, 3, 7}, ds[4] = {-1, -1, -1, -1};
  int32_t v[4];
  memcpy(v, d, 16); same_phaddd(v); expect("phaddd x,x", v, dw, 16);
  memcpy(v, d, 16); same_phsubd(v); expect("phsubd x,x", v, ds, 16);

  int16_t w[8] = {30000, 10000, -5, 7, 32767, 1, -32768, -1}, r[8], e[8];
  for (int i = 0; i < 4; i++) e[i] = e[i + 4] = (int16_t)(w[2 * i] + w[2 * i + 1]);
  memcpy(r, w, 16); same_phaddw(r); expect("phaddw x,x", r, e, 16);
  for (int i = 0; i < 4; i++) e[i] = e[i + 4] = sat16(w[2 * i] + w[2 * i + 1]);
  memcpy(r, w, 16); same_phaddsw(r); expect("phaddsw x,x", r, e, 16);
  for (int i = 0; i < 4; i++) e[i] = e[i + 4] = (int16_t)(w[2 * i] - w[2 * i + 1]);
  memcpy(r, w, 16); same_phsubw(r); expect("phsubw x,x", r, e, 16);
  for (int i = 0; i < 4; i++) e[i] = e[i + 4] = sat16(w[2 * i] - w[2 * i + 1]);
  memcpy(r, w, 16); same_phsubsw(r); expect("phsubsw x,x", r, e, 16);

  // x86 returns the "integer indefinite" (INT_MIN) for NaN, infinities and overflow.
  double in[] = {NAN, INFINITY, 3e9, 1e19};
  for (int i = 0; i < 4; i++) {
    int32_t a, b;
    int64_t c;
    double x = in[i];
    __asm__("cvttsd2si %1, %0" : "=r"(a) : "x"(x));
    __asm__("cvtsd2si %1, %0" : "=r"(b) : "x"(x));
    __asm__("cvttsd2si %1, %0" : "=r"(c) : "x"(x));
    int32_t m32 = INT32_MIN;
    int64_t m64 = i == 2 ? 3000000000LL : INT64_MIN;
    char name[48];
    snprintf(name, sizeof name, "cvttsd2si(%g) 32-bit", x); expect(name, &a, &m32, 4);
    snprintf(name, sizeof name, "cvtsd2si(%g) 32-bit", x); expect(name, &b, &m32, 4);
    snprintf(name, sizeof name, "cvttsd2si(%g) 64-bit", x); expect(name, &c, &m64, 8);
  }
  puts(bad ? "CPU checks failed: run dev/android-tcg/patch-qemu.py" : "CPU checks passed");
  return bad != 0;
}
