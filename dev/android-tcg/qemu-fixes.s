# Replacement helpers for the Android emulator's QEMU (2.12-based, emulator 37.3.10) under TCG.
# patch-qemu.py assembles this file and writes each function over the helper of the same name.
# Every helper is a leaf called as (env=%rdi, d=%rsi, s=%rdx) or (a=%rdi|%edi, status=%rsi).
#
# 1. SSSE3 horizontal ops (phadd*/phsub*): QEMU stored d's low half before reading s, so with
#    s == d (phaddd %xmm6,%xmm6, as zlib's adler32_simd does) the high half came out wrong and
#    V8's snapshot checksum failed: every WebView renderer died on a CHECK at startup.
#    These read both operands fully before the one store.
#
# 2. float -> int conversions (cvt[t]ss2si, cvt[t]sd2si, cvt[t]ps2dq, ...): QEMU's softfloat
#    saturated NaN, +inf and positive overflow to INT_MAX where x86 returns the "integer
#    indefinite" INT_MIN, which V8 tests to leave its fast path: JIT code turned NaN into
#    2147483647. These use the host's own instruction, under the guest's rounding mode
#    (softfloat's float_rounding_mode at 1(%rsi) shares MXCSR's RC encoding), and raise
#    softfloat's invalid flag (bit 0 of float_exception_flags at 2(%rsi)).

        .text

# phaddw: d = [d0+d1 .. d6+d7, s0+s1 .. s6+s7], 16-bit wrap.
# Sign-extend even and odd words to dwords, add, wrap back to 16 bits, pack.
        .globl phaddw
        .p2align 4
phaddw:
        movdqu (%rsi), %xmm0
        movdqu (%rdx), %xmm2
        movdqa %xmm0, %xmm1
        psrad $16, %xmm1
        pslld $16, %xmm0
        psrad $16, %xmm0
        paddd %xmm1, %xmm0
        movdqa %xmm2, %xmm3
        psrad $16, %xmm3
        pslld $16, %xmm2
        psrad $16, %xmm2
        paddd %xmm3, %xmm2
        pslld $16, %xmm0
        psrad $16, %xmm0
        pslld $16, %xmm2
        psrad $16, %xmm2
        packssdw %xmm2, %xmm0
        movdqu %xmm0, (%rsi)
        ret
phaddw_end:

# phaddd: d = [d0+d1, d2+d3, s0+s1, s2+s3].
# shufps gathers the even and odd dwords of d:s, paddd adds them.
        .globl phaddd
        .p2align 4
phaddd:
        movdqu (%rsi), %xmm0
        movdqu (%rdx), %xmm2
        movdqa %xmm0, %xmm1
        shufps $0x88, %xmm2, %xmm0
        shufps $0xdd, %xmm2, %xmm1
        paddd %xmm1, %xmm0
        movdqu %xmm0, (%rsi)
        ret
phaddd_end:

# phaddsw: as phaddw, but saturating: packssdw saturates the exact dword sums.
        .globl phaddsw
        .p2align 4
phaddsw:
        movdqu (%rsi), %xmm0
        movdqu (%rdx), %xmm2
        movdqa %xmm0, %xmm1
        psrad $16, %xmm1
        pslld $16, %xmm0
        psrad $16, %xmm0
        paddd %xmm1, %xmm0
        movdqa %xmm2, %xmm3
        psrad $16, %xmm3
        pslld $16, %xmm2
        psrad $16, %xmm2
        paddd %xmm3, %xmm2
        packssdw %xmm2, %xmm0
        movdqu %xmm0, (%rsi)
        ret
phaddsw_end:

# phsubw: d = [d0-d1 .. d6-d7, s0-s1 .. s6-s7], 16-bit wrap.
        .globl phsubw
        .p2align 4
phsubw:
        movdqu (%rsi), %xmm0
        movdqu (%rdx), %xmm2
        movdqa %xmm0, %xmm1
        psrad $16, %xmm1
        pslld $16, %xmm0
        psrad $16, %xmm0
        psubd %xmm1, %xmm0
        movdqa %xmm2, %xmm3
        psrad $16, %xmm3
        pslld $16, %xmm2
        psrad $16, %xmm2
        psubd %xmm3, %xmm2
        pslld $16, %xmm0
        psrad $16, %xmm0
        pslld $16, %xmm2
        psrad $16, %xmm2
        packssdw %xmm2, %xmm0
        movdqu %xmm0, (%rsi)
        ret
phsubw_end:

# phsubd: d = [d0-d1, d2-d3, s0-s1, s2-s3].
        .globl phsubd
        .p2align 4
phsubd:
        movdqu (%rsi), %xmm0
        movdqu (%rdx), %xmm2
        movdqa %xmm0, %xmm1
        shufps $0x88, %xmm2, %xmm0
        shufps $0xdd, %xmm2, %xmm1
        psubd %xmm1, %xmm0
        movdqu %xmm0, (%rsi)
        ret
phsubd_end:

# phsubsw: as phsubw, but saturating.
        .globl phsubsw
        .p2align 4
phsubsw:
        movdqu (%rsi), %xmm0
        movdqu (%rdx), %xmm2
        movdqa %xmm0, %xmm1
        psrad $16, %xmm1
        pslld $16, %xmm0
        psrad $16, %xmm0
        psubd %xmm1, %xmm0
        movdqa %xmm2, %xmm3
        psrad $16, %xmm3
        pslld $16, %xmm2
        psrad $16, %xmm2
        psubd %xmm3, %xmm2
        packssdw %xmm2, %xmm0
        movdqu %xmm0, (%rsi)
        ret
phsubsw_end:

# float32_to_int32: cvtss2si under the guest rounding mode.
        .globl f32_i32_rnd
        .p2align 4
f32_i32_rnd:
        stmxcsr -8(%rsp)
        movl -8(%rsp), %ecx
        andl $0xffff9fc0, %ecx
        movzbl 1(%rsi), %edx
        andl $3, %edx
        shll $13, %edx
        orl %edx, %ecx
        movl %ecx, -4(%rsp)
        ldmxcsr -4(%rsp)
        movd %edi, %xmm0
        cvtss2si %xmm0, %eax
        stmxcsr -4(%rsp)
        testb $1, -4(%rsp)
        jz 1f
        orb $1, 2(%rsi)
1:
        ldmxcsr -8(%rsp)
        ret
f32_i32_rnd_end:

# float32_to_int32_round_to_zero: cvttss2si.
        .globl f32_i32_rtz
        .p2align 4
f32_i32_rtz:
        stmxcsr -8(%rsp)
        movl -8(%rsp), %ecx
        andl $0xffff9fc0, %ecx
        orl $0x6000, %ecx
        movl %ecx, -4(%rsp)
        ldmxcsr -4(%rsp)
        movd %edi, %xmm0
        cvttss2si %xmm0, %eax
        stmxcsr -4(%rsp)
        testb $1, -4(%rsp)
        jz 1f
        orb $1, 2(%rsi)
1:
        ldmxcsr -8(%rsp)
        ret
f32_i32_rtz_end:

# float32_to_int64: cvtss2si to 64 bits under the guest rounding mode.
        .globl f32_i64_rnd
        .p2align 4
f32_i64_rnd:
        stmxcsr -8(%rsp)
        movl -8(%rsp), %ecx
        andl $0xffff9fc0, %ecx
        movzbl 1(%rsi), %edx
        andl $3, %edx
        shll $13, %edx
        orl %edx, %ecx
        movl %ecx, -4(%rsp)
        ldmxcsr -4(%rsp)
        movd %edi, %xmm0
        cvtss2si %xmm0, %rax
        stmxcsr -4(%rsp)
        testb $1, -4(%rsp)
        jz 1f
        orb $1, 2(%rsi)
1:
        ldmxcsr -8(%rsp)
        ret
f32_i64_rnd_end:

# float32_to_int64_round_to_zero: cvttss2si to 64 bits.
        .globl f32_i64_rtz
        .p2align 4
f32_i64_rtz:
        stmxcsr -8(%rsp)
        movl -8(%rsp), %ecx
        andl $0xffff9fc0, %ecx
        orl $0x6000, %ecx
        movl %ecx, -4(%rsp)
        ldmxcsr -4(%rsp)
        movd %edi, %xmm0
        cvttss2si %xmm0, %rax
        stmxcsr -4(%rsp)
        testb $1, -4(%rsp)
        jz 1f
        orb $1, 2(%rsi)
1:
        ldmxcsr -8(%rsp)
        ret
f32_i64_rtz_end:

# float64_to_int32: cvtsd2si under the guest rounding mode.
        .globl f64_i32_rnd
        .p2align 4
f64_i32_rnd:
        stmxcsr -8(%rsp)
        movl -8(%rsp), %ecx
        andl $0xffff9fc0, %ecx
        movzbl 1(%rsi), %edx
        andl $3, %edx
        shll $13, %edx
        orl %edx, %ecx
        movl %ecx, -4(%rsp)
        ldmxcsr -4(%rsp)
        movq %rdi, %xmm0
        cvtsd2si %xmm0, %eax
        stmxcsr -4(%rsp)
        testb $1, -4(%rsp)
        jz 1f
        orb $1, 2(%rsi)
1:
        ldmxcsr -8(%rsp)
        ret
f64_i32_rnd_end:

# float64_to_int32_round_to_zero: cvttsd2si.
        .globl f64_i32_rtz
        .p2align 4
f64_i32_rtz:
        stmxcsr -8(%rsp)
        movl -8(%rsp), %ecx
        andl $0xffff9fc0, %ecx
        orl $0x6000, %ecx
        movl %ecx, -4(%rsp)
        ldmxcsr -4(%rsp)
        movq %rdi, %xmm0
        cvttsd2si %xmm0, %eax
        stmxcsr -4(%rsp)
        testb $1, -4(%rsp)
        jz 1f
        orb $1, 2(%rsi)
1:
        ldmxcsr -8(%rsp)
        ret
f64_i32_rtz_end:

# float64_to_int64: cvtsd2si to 64 bits under the guest rounding mode.
        .globl f64_i64_rnd
        .p2align 4
f64_i64_rnd:
        stmxcsr -8(%rsp)
        movl -8(%rsp), %ecx
        andl $0xffff9fc0, %ecx
        movzbl 1(%rsi), %edx
        andl $3, %edx
        shll $13, %edx
        orl %edx, %ecx
        movl %ecx, -4(%rsp)
        ldmxcsr -4(%rsp)
        movq %rdi, %xmm0
        cvtsd2si %xmm0, %rax
        stmxcsr -4(%rsp)
        testb $1, -4(%rsp)
        jz 1f
        orb $1, 2(%rsi)
1:
        ldmxcsr -8(%rsp)
        ret
f64_i64_rnd_end:

# float64_to_int64_round_to_zero: cvttsd2si to 64 bits.
        .globl f64_i64_rtz
        .p2align 4
f64_i64_rtz:
        stmxcsr -8(%rsp)
        movl -8(%rsp), %ecx
        andl $0xffff9fc0, %ecx
        orl $0x6000, %ecx
        movl %ecx, -4(%rsp)
        ldmxcsr -4(%rsp)
        movq %rdi, %xmm0
        cvttsd2si %xmm0, %rax
        stmxcsr -4(%rsp)
        testb $1, -4(%rsp)
        jz 1f
        orb $1, 2(%rsi)
1:
        ldmxcsr -8(%rsp)
        ret
f64_i64_rtz_end:
