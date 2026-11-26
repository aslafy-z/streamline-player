| variant | 2.52.6 idle | 2.52.6 scroll | 2.52.6 PSS MB | 2.54.3 idle | 2.54.3 scroll | 2.54.3 PSS MB |
|---|---|---|---|---|---|---|
| `wry`: nothing set | 279 % | 270 %, 26 fps | 582 | 224 % | 214 %, 39 fps | 646 |
| `wry-soft`: the page told it is drawn on the CPU | 69 % | 263 %, 36 fps | 586 | 49 % | 206 %, 46 fps | 646 |
| `wry-nocomp`: `WEBKIT_DISABLE_COMPOSITING_MODE=1` | 106 % | 107 %, 49 fps | 276 | 257 % | 252 %, 18 fps | 610 |
| `wry-nodmabuf`: `WEBKIT_DISABLE_DMABUF_RENDERER=1` | 106 % | 107 %, 47 fps | 262 | 106 % | 107 %, 46 fps | 402 |
| `wry-nodmabuf-soft`: the same, and the page told | 14 % | 107 %, 51 fps | 268 | 16 % | 106 %, 45 fps | 398 |
| `wry-never-reload`: policy `NEVER`, web process restarted | 106 % | 107 %, 48 fps | 278 | 106 % | 107 %, 46 fps | 410 |

| page | 2.52.6 `wry` | 2.52.6 `wry-damage` | 2.52.6 `wry-nodmabuf` | 2.54.3 `wry` | 2.54.3 `wry-nodamage` | 2.54.3 `wry-nodmabuf` |
|---|---|---|---|---|---|---|
| nothing moves | 0 % | 0 % | 0 % | 0 % | 0 % | 0 % |
| 44 px bar | 86 % | 20 % | 12 % | 23 % | 61 % | 13 % |
| full-window zoom | 144 % | 146 % | 70 % | 118 % | 121 % | 40 % |

| | plugin as it is | video layer on demand |
|---|---|---|
| home idle | 287 % (UI 62) | 288 % (UI 3) |
| home scroll | 280 %, 24 fps (UI 56) | 275 %, 27 fps (UI 3) |
| home idle, the page told | 75 % (UI 19) | 71 % (UI 1) |
| bar page, nothing played yet | 197 % (UI 126) | 84 % (UI 6) |
| bar page, the area shown (playing) | 323 % (UI 305) | 323 % (UI 304) |
| bar page, stopped after playing | 199 % (UI 127) | 148 % (UI 66) |
