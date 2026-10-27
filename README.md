# Retro Runner

A 16-bit style 100 m sprint game for the browser, drawn like SNES / Sega Genesis sprite art.
Alternate the Left and Right arrow keys (or A and D) as fast as you can to run.
Climb the ladder from a primary school student to an alien, and every race time is recorded.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173.

| Key                                  | Action                    |
| ------------------------------------ | ------------------------- |
| Left / Right (or A / D), alternating | Run                       |
| Enter / Space                        | Confirm                   |
| Esc                                  | Back / pause              |
| R                                    | Retry on the results card |
| M                                    | Mute                      |

## Develop

| Command                      | What it does                                                       |
| ---------------------------- | ------------------------------------------------------------------ |
| `npm run check`              | Lint, format check, unit tests, typecheck and production build     |
| `npm test`                   | Vitest unit tests (headless game logic, art data, audio rendering) |
| `npm run test:e2e`           | Playwright tests in Chromium and WebKit against a production build |
| `npm run build`              | Static build in `dist/`, playable from any static host             |
| `node tools/art/sheet.ts`    | Render sprite contact sheets to `tools/art/out/`                   |
| `node tools/audio/render.ts` | Render every sound and song to WAV in `tools/audio/out/`           |

## Layout

| Path                     | Contents                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `src/core/`              | Pure TypeScript game logic: input rules, mash-to-speed model, race clock, opponent AI, records. No Phaser. |
| `src/art/`               | Palette, sprites as palette-indexed pixel maps baked at boot, stadium parallax, race view.                 |
| `src/audio/`             | Web Audio engine with vendored ZzFX / ZzFXM chiptune synths.                                               |
| `src/scenes/`, `src/ui/` | Phaser scenes, HUD, menus, bitmap fonts.                                                                   |
| `e2e/`                   | Playwright end-to-end tests.                                                                               |
| `docs/design.md`         | Game design document (gameplay numbers, art bible, UI layout).                                             |
| `docs/research.md`       | Technology choices and the reasons behind them.                                                            |

Each layer exposes its public API only through its `index.ts`; ESLint enforces the boundaries.

## Credits

- Press Start 2P font by CodeMan38, SIL Open Font License 1.1 (`public/fonts/`).
- ZzFX by Frank Force and ZzFXM by Keith Clark, MIT (`src/audio/vendor/`).
