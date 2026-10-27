# Performance pass (October 2026)

Status: work report for branch `claude/perf-polish-5edafe`.
Baseline is `68d06f0` on main; "after" is the head of the branch.
Measurements come from `tools/perf/measure.ts` against production builds made with `VITE_TEST_HOOKS=1`, on an Apple-silicon MacBook.
Headless Chromium renders WebGL with SwiftShader (software), so shader and GPU costs there are larger than on real hardware; `--headed` runs on the real GPU.
Cold-load rows are medians of 9 loads, baseline and branch interleaved so both saw the same machine load (another session was busy on the machine).

## Results

| Metric | Before | After |
| --- | --- | --- |
| Main JS bundle | 1,506 KB (406 KB gzip) | 832 KB (231 KB gzip) |
| Cold load to Title, Chromium headless | 458 ms | 322 ms |
| Same, Chromium with 4x CPU throttle | 1,081 ms | 490 ms |
| Same, WebKit | 450 ms | 159 ms |
| Same, Chromium on the real GPU (headed) | 380 ms | 173 ms |
| Main-thread long tasks during boot (Chromium) | 220 + 211 ms, then 110 ms of SFX synthesis on the Title | one ~215 ms task: the loading frame that links all shaders |
| Shader programs linked after boot (full Pip race) | 9 (3 on Title, 2 on Ladder, 4 during the race) | 0 |
| Dropped frames in a race, Chromium headless | 2 (78 ms at the countdown, 103-110 ms one second into the run) | 0 (worst rAF interval 19 ms) |
| Same, 4x CPU throttle | 2 (80 ms, 108 ms), plus a 474 ms stall at race start | 0 (worst step 6.2 ms) |
| Same, CRT on, real GPU (headed, 120 Hz) | 2 (96 ms at the countdown, 75 ms mid-race) | 0 |
| Phaser step CPU per race frame, Chromium p50 / p99 / max | 0.3 / 0.8 / 3.5 ms | 0.4 / 0.9 / 1.5 ms |
| Texture binds per race frame | 21.9 | 2 |
| WebGL draw calls per race frame (CRT off / on) | 11 / 17 | 11 / 17 |
| JS heap after forced GC, race + RETRY cycle 1 -> 20 | 7.80 -> 8.57 MB | 5.86 -> 6.47 MB (flat from cycle 10) |

WebKit shows no dropped frames in either build (headless WebKit paces rAF at 30 Hz, and its program linking does not block the frame the way ANGLE does).

## What changed

1. **Trimmed Phaser build** (`src/phaser-build.js`, `vite.config.ts`).
   `phaser.esm.js` is one prebuilt webpack bundle, so nothing in it could be tree-shaken.
   The `phaser` import now resolves to an entry that pulls only the modules the game uses from `phaser/src`, and a small Vite plugin resolves Phaser's build-time flags (WebGL only, no sound, no debug).
   Types still come from the `phaser` package.
   Adding a new game object type means adding its class and factory to `src/phaser-build.js`.
   `chunkSizeWarningLimit` is now 900 KB, so a regression toward the full dist file warns at build time.
2. **One art atlas** (`src/art/baked.ts`, `src/art/bake/atlas.ts`, `src/art/phaser/textures.ts`).
   Phaser 4 links one batch shader per distinct number of textures in a batch, and the ~120 separate art textures kept producing new counts mid-game; every stall in the race traces was a program link.
   All maps are now packed into one RGBA page; every texture key is still its own Phaser `Texture` with the same frames (callers and `src/art/index.ts` are unchanged) but all keys share one GL texture.
   Registering the keys skips `TextureSource`'s per-key `setFilter`, which re-uploaded the whole page each time (124 uploads, ~340 ms).
3. **One font texture and a shader warm-up** (`src/ui/fonts.ts`, `src/scenes/BootScene.ts`).
   Both bitmap fonts share one canvas, so a batch holds at most two textures.
   Boot draws one batch of each kind (tile sprite, 1 texture, 2 textures, untextured fill) under an opaque cover on the LOADING frame, which links the four programs the game needs.
4. **Art bakes in a worker** (`src/art/bake.worker.ts`, additive `prepareArt()` in `src/art/index.ts`).
   `main.ts` starts the worker before Phaser boots; `BootScene` awaits it with the font.
   `registerArt()` still bakes inline if the worker is unavailable or failed.
5. **Faster character rig** (`src/art/chars/rig.ts`): reused scratch canvas, generation marks instead of a `Set` per part, bounding-box tracking instead of two full-canvas scans.
   Output is byte-identical (sha256 of the whole `bakeArt()` result unchanged); characters bake in 24.6 ms instead of 42.6 ms warm, the whole bake cold in ~90 ms instead of ~125 ms.
   The bake is the critical path to the Title (art arrived ~100 ms after `BootScene.create`, the font after ~5 ms).
6. **SFX and the crowd loop render in the audio worker** (`src/audio/renderer.ts`, `src/audio/music/render.worker.ts`).
   They used to be synthesised synchronously on the main thread right after Boot (~110 ms).
   Without a worker they render one SFX per macrotask.

## Checked and left alone

- **GC pressure.** A race allocates ~25 KB/s of game data (timer string plus Phaser's BitmapText re-measure; the rest of the sampled ~58 KB/s is the probe itself), giving 15-16 minor GCs per race, ~20 ms in total, longest pause 3 ms.
  Skipping the timer and km/h string rebuild on unchanged frames made no measurable difference, so it was not kept.
- **Draw calls and parallax.** 11 draw calls per race frame (17 with CRT); step CPU stays under 2 ms at p99 even with 4x throttling.
- **Audio.** Songs already rendered in the worker.
  Each race creates ~123 Web Audio nodes (one-shot buffer sources for SFX, rate-limited steps, the crowd chain); every source disconnects on `ended`.
  Copying a song into an `AudioBuffer` when it starts costs ~4 ms on the main thread and stays inside the frame budget.
- **Leaks.** Across 20 race/RETRY cycles textures (130), display objects (72), scene update listeners, timers and window listeners (16) stay constant.

## Open findings

- The fullscreen corner button sits on top of the Title's mute icon when the window is exactly 16:9 (it shows for 2.5 s after load and on mouse movement).
  This predates this branch; moving either element is a layout decision.
- Headed Chromium shows one ~30 ms rAF gap two frames into every race start, in both builds.
  The main thread is idle during it (no task over 4 ms, no GC), so it is compositor-side, not game code.
- Headless Chromium with CRT on occasionally stalls ~100 ms in the compositor's `ReadPixels` of the WebGL canvas.
  That readback exists only under software compositing; it does not occur on the real GPU.

## Reproducing

```bash
VITE_TEST_HOOKS=1 npx vite build && npx vite preview --port 4173
```

```bash
node tools/perf/measure.ts boot --runs 5
```

```bash
node tools/perf/measure.ts race --alloc
```

```bash
node tools/perf/measure.ts memory --cycles 20
```

Flags: `--browser webkit`, `--throttle 4` (Chromium), `--crt`, `--headed`, `--url`.
