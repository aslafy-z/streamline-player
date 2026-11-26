# WebKitGTK patches

Patches `webkit.sh build` applies to the WebKitGTK source before it compiles it, one directory per
version and label:

```
webkit-patches/<version>/<label>/NN-what-it-does.patch
```

- `<version>` is the WebKitGTK release (`2.52.6`), `<label>` the name of the build: it installs to
  `/bench/webkit/install/<version>-<label>`. The label `stock` is the unpatched build and has no
  directory.
- Every `*.patch` of the directory is applied in name order with `patch -p1` from the top of the
  source tree (paths start with `a/Source/…`, as `git diff` writes them). Number them.
- A patch that does not apply cleanly stops the build before it changes a file.
- A label starts from a copy of the `stock` work tree, source and build, so its first build
  compiles only what its patches touch. `--from <label>` copies another label's instead: the
  patches then go on top of that label's own, which is how two sets combine without a second
  copy of the files.
- The build records the name and SHA-256 of each patch. Run again with the same patches it does
  nothing; with edited, added or removed patches it reverts and applies the ones that changed
  and recompiles what they touch.

```sh
dev/bench/webkit.sh build 2.52.6 damage                  # from stock; again after editing a patch
dev/bench/webkit.sh build 2.52.6 damage-readback --from damage
```

## 2.52.6

Written from reading the source, then compiled and measured (`dev/bench/RESULTS.md`, "WebKitGTK
2.52.6 built from source"). Each is a draft for upstream, not a finished change.

| label | from | what it changes | the 44 px bar, app + X server |
|---|---|---|---|
| `stock` | | nothing: the witness, equal to Ubuntu's package | 82 % + 15 % |
| `damage` | `stock` | composition limited to the damaged region by default, as in 2.54, and a frame without damage no longer resets every buffer's record | 22 % + 18 % |
| `damage-readback` | `damage` | the shared-memory path reads back the damaged region only | 17 % + 16 % |
| `damage-readback-redraw` | `damage-readback` | the GTK 3 widget redraws the damaged region only, and paints a clip smaller than the view where it belongs | 14 % + 2 % |
| `fallback` | `stock` | no accelerated compositing when OpenGL is a software rasterizer, unless `WEBKIT_FORCE_COMPOSITING_MODE` asks for it | 15 % + 1 % |

All five compiled as written. One was wrong on screen: the redraw patch left the damaged strip
blank, because WebKitGTK's own paint of a shared-memory buffer adds the clip rectangle to the
path after flipping the y axis, which only shows once the clip is not the whole view. The patch
now carries that correction.
