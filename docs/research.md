# Retro Runner - tech research

Status: recommendation, researched 2026-10-26.
Versions below were read from the npm registry on that date (`npm view <pkg> version`).
Owner of this file: tech researcher. Game rules and content live in `docs/design.md`.

## Decision table

| Area | Choice | Exact version | Why (one line) |
| --- | --- | --- | --- |
| Engine | Phaser | `phaser@4.2.1` | Mature scene manager, `pixelArt` render preset, `MAX_ZOOM` integer scaling, built-in filters for optional CRT, first-class TS types, very active. |
| Language | TypeScript | `typescript@6.0.3` | Version the official Vite template pins; TS 7.0.2 is out but `typescript-eslint` still requires `<6.1.0`. |
| Bundler / dev server | Vite (vanilla-ts template) | `vite@8.3.5`, `create-vite@9.3.1` | Zero-config TS, fast HMR, static `dist/` that runs anywhere; supports Node 22.12+. |
| Unit tests | Vitest (Node environment) | `vitest@5.0.5` | Shares Vite config; pure game logic tests run headless with no DOM or WebGL. |
| E2E tests | Playwright Test | `@playwright/test@1.64.1` | Real Chromium/WebKit, `keyboard.down/up` with correct `repeat` semantics, `page.evaluate` to read game state. |
| Lint | ESLint flat config + typescript-eslint | `eslint@10.13.0`, `typescript-eslint@8.72.0` | Type-aware lint; also enforces "no Phaser import in `src/core`" via `no-restricted-imports`. |
| Format | Prettier | `prettier@3.9.10` | One formatter for four parallel agents avoids diff noise. |
| Art pipeline | Palette-indexed pixel maps in TS, baked to textures at boot | in-repo code | Agents cannot draw; code-defined sprites guarantee one palette and auto-generated uniform outlines, and are diffable and unit-testable. |
| Post effect | Optional CRT via Phaser camera filters (Barrel + Vignette + small custom scanline shader) | `phaser@4.2.1` | WebGL-only, off by default, toggled from settings, zero cost when off. |
| Pixel font | Press Start 2P (headings) + Pixel Operator 8 or m5x7 (body), pre-rasterised to a RetroFont/BitmapText sheet | Press Start 2P OFL-1.1; Pixel Operator CC0; m5x7 CC0 | Bitmap text is pixel-exact under integer zoom; web-font text blurs. |
| SFX | ZzFX synth (parameter arrays authored in the ZzFX designer) | `zzfx@1.4.0` (MIT), vendored | Tiny, chiptune-native, sounds defined as code; same synth powers the music. |
| Music | ZzFXM song format + tracker | ZzFXM (MIT, not on npm, vendored) | Songs are small data arrays rendered to buffers at boot; authorable in its web tracker or converted from MOD. |
| Persistence | `localStorage`, versioned JSON, behind a `RecordsStore` port | Web platform | A few hundred bytes of best times; synchronous, universally available; IndexedDB adds async complexity for no gain. |
| Timing | Fixed-timestep simulation (120 Hz) driven by input-event `timeStamp`; race time = sim time with sub-tick finish interpolation, reported in integer ms | in-repo code | Frame-rate independent, fair, and fully deterministic so tests can assert exact times. |
| RNG | Seeded PRNG (mulberry32) in `src/core` | in-repo code | Deterministic opponent behaviour per race seed. |
| Runtime | Node 22 (installed: 22.23.4) | - | Satisfies Vite (`^20.19 \|\| >=22.12`), Vitest (`^22.12`) and Playwright (`>=20`). |

## 1. Engine / framework

### Candidates

| Criterion | Phaser 4.2.1 | Excalibur 0.32.0 | Kaplay 3001.0.19 | PixiJS 8.22.0 + custom loop | Godot 4 web export |
| --- | --- | --- | --- | --- | --- |
| Pixel-perfect | `render.pixelArt: true` sets `antialias`/`antialiasGL` false and `roundPixels` true; `scale.zoom: Phaser.Scale.MAX_ZOOM` picks the largest integer zoom | `pixelArt: true` preset since 0.29, optional `snapToPixel`, docs warn of shimmer when rotating | `crisp`/`letterbox` options, less documented control | Full control (`roundPixels`, `scaleMode: 'nearest'`), but integer scaling is DIY | Excellent (viewport stretch + integer scale, snap 2D transforms) |
| Keyboard | `KeyboardPlugin`, `JustDown`, `Key.emitOnRepeat` (default false), `timeDown`; raw DOM events also easy | Keyboard events with `wasPressed` | `onKeyPress` | DIY | Good, but events cross the WASM boundary |
| Scenes | Mature scene manager (parallel scenes for HUD/overlay) | Scenes + transitions | Scenes | DIY | Excellent |
| TypeScript | Ships `types/phaser.d.ts` | Written in TS | TS types | Written in TS | GDScript/C#, not TS |
| Size (min / gzip) | 1.38 MB / 353 KB (`phaser.esm.min.js`) | 0.57 MB min | ~0.5 MB | ~0.4-0.6 MB depending on imports | Several MB of WASM |
| Maintenance | 4.0.0 Apr 2026, 4.1.0 Apr, 4.2.0 Jun, 4.2.1 Jul 2026 | 0.32.0 published 2026-10-24, still 0.x | Last stable May 2026; v4000 still alpha | Very active (8.22.0 today) | Very active |
| Headless testability | Logic kept in plain TS is engine-free; Phaser also has a HEADLESS renderer | Same pattern | Same pattern | Same pattern | Needs Godot binary, not installed |
| Easy to run/share | `npm run build` gives static files | same | same | same | Needs Godot install; threaded builds need COOP/COEP headers |

### Pick: Phaser 4.2.1

- It is the only JS option that gives a production-grade scene manager, camera, tweens, bitmap text, sound manager and post-filters in one maintained package, which shortens UI work (title, menu, ladder, results, records).
- Pixel-art support is explicit and documented for v4: use `render: { pixelArt: true }` and keep game objects at integer positions and scales.
- Integer scaling is built in: `scale: { mode: Phaser.Scale.NONE, zoom: Phaser.Scale.MAX_ZOOM }` with a fixed low internal resolution (recommend 320x180, which scales exactly to 1280x720 at 4x and 1920x1080 at 6x), plus CSS `image-rendering: pixelated` on the canvas.
- Phaser 4 ships agent-oriented docs inside the package at `node_modules/phaser/skills/*/SKILL.md` (scenes, input, scale, filters, text-and-bitmaptext, v3-to-v4-migration); implementation agents should read those rather than Phaser 3 tutorials, because v4 changed rendering APIs (filters replace FX/pipelines, `textures.generate` is gone).
- Bundle cost (353 KB gzip) is the main downside and is acceptable for a locally run or statically hosted game.
- Excalibur is a strong runner-up (TS-native, smaller), but it is still pre-1.0 with breaking changes between minors.
- Kaplay's stable line has been quiet since May 2026 while v4000 sits in alpha.
- PixiJS is a renderer, not an engine; scenes, input, audio and text layout would all be hand-built.
- Godot is excluded: not installed, not TS, and harder to share and to test from Node.

### Pixel-perfect rules for all agents

- Internal resolution 320x180, all sprite positions and camera scroll rounded to integers before render (the sim works in floats; views round).
- Never scale or rotate sprites by non-integer factors; animate by frame swaps, not by smooth scaling.
- Sprite origins at `(0, 0)` or on whole pixels; avoid `0.5` origin on odd-sized frames, which the v4 guide lists as a blur cause.
- Parallax layers scroll at rational speeds and round their final x, so layers move in whole-pixel steps without shimmer.

### Input fidelity

- Do not rely on frame-polled `isDown` for mashing, because two presses inside one frame would be lost.
- `src/core/input` defines a pure `PressEvent { key: 'L' | 'R'; t: number }` type and the sim consumes an ordered queue of them.
- A thin DOM adapter listens to `window` `keydown` with `{ capture: true }`, ignores `event.repeat === true`, matches on `event.code` (`ArrowLeft` / `ArrowRight`, layout-independent), calls `preventDefault()` to stop page scrolling, and records `event.timeStamp`.
- `event.timeStamp` is a `DOMHighResTimeStamp` on the same time origin as `performance.now()`, so presses can be placed exactly on the race timeline regardless of when the frame callback runs.
- Browsers coarsen these timers (about 0.1 ms in Chrome, 1 ms in Firefox and Safari), which is fine for ms race times.
- Pause or void the race on `visibilitychange` / `blur`, because hidden tabs throttle `requestAnimationFrame`.
- Phaser's own keyboard plugin stays in use for menus (`JustDown`, `addCapture('LEFT,RIGHT,UP,DOWN,SPACE,ENTER')`).

Sources:
- https://www.npmjs.com/package/phaser
- https://cdn.jsdelivr.net/npm/phaser@4.2.0/docs/Phaser%204%20Pixel%20Art%20Guide/Phaser%204%20Pixel%20Art%20Guide.md
- https://unpkg.com/phaser@4.2.1/skills/text-and-bitmaptext/SKILL.md
- https://gamedev.net/news/2759-phaser-4-released/
- https://excaliburjs.com/docs/pixel-art
- https://excaliburjs.com/api/interface/EngineOptions
- https://www.npmjs.com/package/kaplay
- https://www.npmjs.com/package/pixi.js
- https://docs.godotengine.org/en/4.5/tutorials/export/exporting_for_web.html
- https://godotengine.org/article/progress-report-web-export-in-4-3/
- https://developer.mozilla.org/en-US/docs/Web/API/Event/timeStamp
- https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/repeat

## 2. Build tooling and tests

- Scaffold with `create-vite@9.3.1`, template `vanilla-ts`, which pins `typescript ~6.0.3` and `vite ^8.3.4`.
- Stay on TypeScript 6.0.x until `typescript-eslint` widens its peer range past `<6.1.0` (it is `>=4.8.4 <6.1.0` in 8.72.0); TS 7 (native compiler) can be adopted later as a pure toolchain swap.
- `tsconfig`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- Vitest 5 runs `src/**/*.test.ts` in the default Node environment; `src/core` and `src/art/bake` tests need no DOM.
- A second Vitest project is not needed; anything that needs a browser is covered by Playwright.
- Playwright `webServer` runs `vite build && vite preview --port 4173` so E2E tests hit the production bundle.
- Playwright `keyboard.down('ArrowLeft')` dispatches `keydown` without `repeat`; a second `down` without an `up` sets `repeat: true`, which lets a test prove auto-repeat is ignored.
- Mashing helper: loop `await page.keyboard.down(k); await page.keyboard.up(k);` alternating keys, optionally with `keyboard.press(k, { delay })`.
- State read-back: in builds with `import.meta.env.VITE_TEST_HOOKS === '1'` (set only by the Playwright `webServer` env), `main.ts` exposes `window.__retroRunner = { getState(), seed(n), clearRecords() }`; it is tree-shaken out of normal builds.
- E2E assertions read state (current scene key, race phase, player speed, finish time, stored records) rather than pixels; a small number of `toHaveScreenshot` checks guard pixel crispness (CRT off, fixed seed).
- Run Playwright on `chromium` and `webkit` (Safari is a likely target on macOS).

Sources:
- https://www.npmjs.com/package/create-vite
- https://vite.dev/guide/
- https://vitest.dev/guide/
- https://playwright.dev/docs/api/class-keyboard
- https://playwright.dev/docs/test-webserver
- https://typescript-eslint.io/getting-started

## 3. Art pipeline

### Options

- (a) Procedural palette-indexed pixel maps in code.
  Each sprite frame is an array of equal-length strings where each character is a palette index (`.` = transparent).
  A pure `bake()` function turns a map plus palette into RGBA bytes, then Phaser receives them via `this.textures.addUint8Array(key, data, w, h)` or a canvas via `addCanvas`, and frames are registered with `texture.add(...)` on a packed sheet.
  Pros: no external tools, one palette enforced by type, diffable, unit-testable, agents can author and iterate.
  Cons: authoring large frames is slow; keep characters small (about 24x32 px per frame at 320x180).
- (b) Aseprite `.aseprite` files exported to PNG + JSON atlas (Phaser loads `this.load.aseprite` / atlas JSON).
  Best workflow for a human pixel artist, but Aseprite is paid, not installed, and agents cannot use it.
  Keep it as a future upgrade path: the bake step can be replaced by atlas loading without touching views.
- (c) Free CC0 packs.
  No CC0 track-and-field or stadium pack was found.
  Closest fits on OpenGameArt: "Runner character" by David Harrington (CC0, 32x32 side-view, 8-frame run), and "Running guy" (CC0).
  Kenney packs (CC0) are a clean style but not SNES-like with dark outlines.
  Mixing packs breaks palette and outline consistency, so use these only as motion reference for run-cycle timing.

### Recommendation: (a)

- `src/art/palette.ts` defines one fixed palette of up to 32 colours, organised as ramps (outline, dark, mid, light, highlight) per material: skin tones, kit colours per opponent, track red, grass, crowd, sky, alien green.
- The outline colour is a single near-black (for example `#1a1020`) that `bake()` adds automatically: any transparent pixel 4-adjacent to an opaque pixel becomes outline, so every sprite gets the same 1 px bold outline without hand-drawing it.
- Shading is "simple 16-bit": one light direction (top-left), two to three shades per ramp, no anti-aliasing, no gradients.
- Opponent variety comes from palette swaps of a shared body template plus small overlays (hair, headband, alien antennae), which keeps the ladder cheap and consistent.
- Run cycles: 6 to 8 frames; animation frame rate scales with runner speed (frame index from distance travelled, not wall time).
- Parallax stadium: 4 to 5 layers (sky, far stands, near crowd with 2-frame "wave" animation, track lanes, foreground rail) built from small tiles that repeat horizontally.
- Tests: every pixel map has rectangular rows, uses only known palette indices, and frame sizes match their sheet definition.

### Optional post-effects

- Phaser 4 cameras have filters by default (`camera.filters.external`); built-ins include Barrel (curvature), Vignette, ColorMatrix, Glow, Blocky.
- CRT = Barrel (slight) + Vignette + a small custom scanline filter; WebGL only.
- Default off; a Settings toggle persisted alongside records; skip silently under the Canvas renderer.
- Apply filters only to the main camera at the final pass, so the 320x180 art stays pixel-exact underneath.

Sources:
- https://unpkg.com/phaser@4.2.1/skills/filters-and-postfx/SKILL.md
- https://unpkg.com/phaser@4.2.1/src/textures/TextureManager.js
- https://opengameart.org/content/runner-character
- https://opengameart.org/content/running-guy
- https://kenney.nl/assets
- https://lospec.com/palette-list
- https://www.aseprite.org/

## 4. Pixel fonts

| Font | Licence | Use |
| --- | --- | --- |
| Press Start 2P (CodeMan38) | SIL OFL 1.1 (`@fontsource/press-start-2p@5.3.0` reports `OFL-1.1`) | 8x8 titles, big countdown, times |
| Pixel Operator 8 (Jayvee Enaguas) | CC0 1.0 | Body text, menus, records table (more readable than Press Start 2P at length) |
| m5x7 (Daniel Linssen) | CC0 1.0, attribution appreciated | Alternative compact body font (use at 16 px multiples) |

- Render with bitmap text, not web fonts: at boot, rasterise each font once at its native pixel size into a fixed-grid sheet (or ship a pre-made PNG grid) and register it with `Phaser.GameObjects.RetroFont.Parse` + `this.cache.bitmapFont.add`, then draw with `BitmapText`.
- Keep text origin at 0 and positions at integers, as the v4 pixel-art guide advises.
- Web-font `Text` objects are rasterised with smoothing and blur under zoom, so use them nowhere in game.
- Ship the OFL licence text in `public/fonts/` next to Press Start 2P; list CC0 fonts in a credits screen anyway.

Sources:
- https://fonts.google.com/specimen/Press+Start+2P
- https://fontlibrary.org/en/font/press-start-2p
- https://www.dafont.com/pixel-operator.font
- https://managore.itch.io/m5x7
- https://docs.phaser.io/phaser/concepts/gameobjects/bitmap-text

## 5. Audio

- SFX: ZzFX (Frank Force, MIT).
  Each sound is a short parameter array designed in the ZzFX web designer and pasted into `src/audio/sfx.ts` (footstep tick, mash blip, countdown beeps, "GO" horn, finish, win jingle, lose sting, menu move/select).
- Caveat found in the package source: `zzfx@1.4.0`'s `ZZFX` object constructs `new AudioContext` at module load and ships no type declarations.
  That breaks Node unit tests and bypasses our own context management, so vendor the MIT synth core (`buildSamples`) into `src/audio/vendor/zzfx.ts` with its licence header and typed signatures, and own a single `AudioContext` in `src/audio/engine.ts` that is created or resumed on the first key press (autoplay policy).
- Music: ZzFXM (Keith Clark, MIT), a tracker format whose instruments are ZzFX parameter arrays.
  Songs (`[instruments, patterns, sequence, bpm]`) are rendered to stereo buffers at boot and looped with an `AudioBufferSourceNode`.
  Author in the ZzFXM web tracker, or in MilkyTracker and convert `.mod` with its CLI.
  Not published on npm, so vendor `zzfxm` into `src/audio/vendor/zzfxm.ts` with the MIT notice.
- Alternative considered: jsfxr (Unlicense) has named presets (`pickupCoin`, `laserShoot`, `explosion`, `powerUp`, `hitHurt`, `jump`, `blipSelect`, `synth`, `tone`, `click`, `random`) and `sfxr.toWave(sound).dataURI`, but it does not share a synth with a music tracker; ZzFX + ZzFXM gives one consistent chip voice.
- Mixer: separate music and SFX gain nodes; volumes and mute persisted in settings.
- Testable: sound and song data are plain arrays; a unit test renders each with the vendored synth and asserts non-empty, non-clipping output.

Sources:
- https://github.com/KilledByAPixel/ZzFX
- https://killedbyapixel.github.io/ZzFX/
- https://github.com/keithclark/ZzFXM
- https://keithclark.github.io/ZzFXM/tracker/
- https://github.com/chr15m/jsfxr
- https://developer.chrome.com/blog/autoplay

## 6. Persistence

- Use `localStorage` under one key, `retro-runner:save:v1`, holding `{ version: 1, records: { [opponentId]: { bestMs, achievedAt } }, ladderProgress, settings }`.
- The data is tiny and read once at boot; synchronous access keeps scene code simple.
- IndexedDB (or `idb-keyval@6.3.0`) is only worth it for large or binary data such as replays or ghost runs; revisit if the design adds ghosts.
- `src/core/records` exposes a pure `RecordsStore` that takes a `KeyValueStorage` port (`get/set`), with an in-memory adapter for tests and a `localStorage` adapter for the browser.
- Validate on load (hand-written type guards), keep a `version` field with explicit migrations, and on corrupt data back up the raw string under `...:corrupt` and start fresh rather than crash.
- Wrap every access in `try/catch`; Safari private mode and blocked storage throw, and the game must still run with in-memory records.
- Only write a record when the new time is strictly lower, and store integer ms.

Sources:
- https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
- https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- https://www.npmjs.com/package/idb-keyval

## 7. Timing

- The simulation runs at a fixed step of 1/120 s (`DT_MS = 1000 / 120`) in `src/core/clock`, advanced by an accumulator from the render loop's elapsed time, with a cap (for example 250 ms) to avoid a spiral of death.
- Race time zero is the "GO" tick; presses are mapped to sim time via `event.timeStamp - goTimestamp`, so a press is applied at the tick it physically happened in, not the frame it was noticed in; presses before GO are false starts (design decides the penalty).
- Speed, distance and opponent progress are pure functions of (seed, opponent profile, ordered press list, tick count), so the same inputs always produce the same result.
- Finish time = time of the last tick before crossing + `DT_MS * (finishDistance - prevDistance) / (distance - prevDistance)`, rounded to an integer ms; this gives ms resolution finer than the 8.33 ms tick.
- Opponents are simulated in the same loop with a seeded PRNG, so their finish times are deterministic per seed and comparable to the player's.
- Display time (HUD) may interpolate between ticks for smoothness, but the recorded time always comes from the sim.
- Tests drive `Race.step()` directly with synthetic press lists (for example "alternate every 80 ms for 10 s") and assert exact ms; Playwright E2E asserts ranges because real key timing is not exact.

Sources:
- https://gafferongames.com/post/fix_your_timestep/
- https://developer.mozilla.org/en-US/docs/Web/API/Performance/now
- https://developer.mozilla.org/en-US/docs/Web/API/DOMHighResTimeStamp

## Recommended folder structure

Ownership is by directory; no two agents write to the same directory.
Cross-team contracts are each directory's `index.ts` public API; consumers import only from `index.ts`.

```
retro-runner/
  index.html                    UI
  public/
    fonts/                      UI      (PNG font grids + OFL.txt)
  src/
    main.ts                     UI      (Phaser.Game config, scene list, test hook)
    core/                       MECHANICS - pure TS, no Phaser/DOM imports (lint-enforced)
      index.ts
      clock/                    fixed timestep, accumulator, race clock
      input/                    PressEvent type, alternation rules, DOM keyboard adapter (adapter.ts is the only DOM file)
      runner/                   mash-to-speed model, distance, stamina if designed
      opponents/                ladder data (ids, names, stats), AI press-rate model
      race/                     race state machine (countdown, running, finished), results
      records/                  RecordsStore, KeyValueStorage port, localStorage + memory adapters, migrations
      rng/                      mulberry32
      *.test.ts                 co-located Vitest tests
    art/                        ART
      index.ts                  registerArt(scene): bakes textures, registers animations
      palette.ts
      bake/                     pure pixel-map -> RGBA, auto outline (unit tested)
      sprites/                  runner + opponent pixel maps and frame tables
      backgrounds/              parallax stadium layers
      fx/                       optional CRT filter setup
      views/                    RunnerView, ParallaxView: display objects that read core state and round to whole pixels
    audio/                      AUDIO
      index.ts                  AudioEngine API: unlock(), playSfx(id), playMusic(id), setVolumes()
      engine.ts                 single AudioContext, gain buses
      sfx.ts                    ZzFX parameter arrays
      music/                    ZzFXM songs (title, race, results)
      vendor/                   zzfx.ts, zzfxm.ts with MIT headers
    scenes/                     UI
      BootScene.ts              calls art.registerArt, audio preload, records load
      TitleScene.ts, MenuScene.ts, LadderScene.ts, RaceScene.ts, ResultsScene.ts, RecordsScene.ts, SettingsScene.ts
    ui/                         UI      (bitmap-text widgets, menu list, HUD, time formatting, font registration)
  e2e/                          UI      (Playwright specs + mash helpers)
  docs/
    design.md                   game director
    research.md                 this file
  playwright.config.ts, vitest.config.ts, eslint.config.js, tsconfig.json, .prettierrc   UI (set up once at scaffold)
```

- `RaceScene` (UI) is the integration point: it feeds DOM `PressEvent`s into `core`, steps the sim, hands state to `art/views`, and calls `audio` on race events.
- `core` exports plain data types (`RaceState`, `RunnerState`, `OpponentProfile`, `RaceResult`) that art, UI and audio depend on; mechanics owns those types.
- Lint rule: `src/core/**` may not import `phaser`, `src/art`, `src/audio`, `src/ui` or `src/scenes`; `src/art` and `src/audio` may import only `src/core` types.

## Scaffold commands

```sh
cd "/Users/azscep/Development Project"
# retro-runner/ already holds docs/, and create-vite's --overwrite would delete it,
# so scaffold into a sibling temp dir and copy the template in.
npm create vite@9.3.1 retro-runner-scaffold -- --template vanilla-ts --no-interactive </dev/null
rsync -a retro-runner-scaffold/ retro-runner/
rm -rf retro-runner-scaffold
cd retro-runner
npm config set save-exact true --location=project
npm install
npm install phaser@4.2.1
npm install -D typescript@6.0.3 vite@8.3.5 vitest@5.0.5 @playwright/test@1.64.1 \
  eslint@10.13.0 typescript-eslint@8.72.0 prettier@3.9.10
npx playwright install chromium webkit
```

- The non-interactive scaffold was verified on 2026-10-26 with `create-vite@9.3.1` into an empty directory.
- Remove the template's demo files (`src/counter.ts`, `src/style.css` content, `src/assets/hero.png`, `src/assets/typescript.svg`, `src/assets/vite.svg`, `public/icons.svg`) before adding the structure above.
- `save-exact` (written to the project `.npmrc` above) pins exact versions; commit `package-lock.json`.
- Suggested scripts: `dev: vite`, `build: tsc --noEmit && vite build`, `preview: vite preview`, `test: vitest run`, `test:e2e: playwright test`, `lint: eslint .`, `format: prettier --write .`, `check: npm run lint && npm run test && npm run build`.
- Sharing: `npm run build` produces a static `dist/` (set `base: './'` in `vite.config.ts`) that can be opened via `npm run preview`, zipped, or uploaded to itch.io or GitHub Pages with no special headers.
