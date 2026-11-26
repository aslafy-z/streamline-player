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

Drafts written from reading the source; a label is only worth what its measurements say
(`dev/bench/RESULTS.md`).

| label | from | what it changes |
|---|---|---|
| `damage` | `stock` | composition limited to the damaged region by default, as in 2.54, and a frame without damage no longer resets every buffer's record |
| `damage-readback` | `damage` | the shared-memory path reads back the damaged region only |
| `damage-readback-redraw` | `damage-readback` | the GTK 3 widget redraws the damaged region only |
| `fallback` | `stock` | no accelerated compositing when OpenGL is a software rasterizer |
