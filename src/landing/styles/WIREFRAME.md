# Landing page wireframe

Layouts for `/welcome/` at phone width (360 px) and desktop (1280 px), with the classes to use.
Tokens live in `tokens.css`, components in `retro.css`, and `preview.html` shows every one of them.

## Page rules

- Import `src/landing/styles/index.css` once from the entry.
- Every section is `section.rr-section > .rr-container`, which gives a 16 px gutter and a 1152 px maximum content width.
- At 360 px nothing may scroll sideways: `body` clips horizontal overflow, so wide decoration is cut off, never scrolled to.
- Each section has one primary PLAY CTA at most, and it is always `.rr-btn.rr-btn--lg`.
  Secondary actions use `.rr-btn--secondary` or a text link.
- Put `<a class="rr-skip-link" href="#story">` first in `body`, so keyboard users can skip the mini-race.
- Put `<div class="rr-crt" aria-hidden="true"></div>` last in `body`.
- Join sections with `<div class="rr-track" aria-hidden="true"></div>`, and use `.rr-track.rr-track--finish` before the final CTA.
- Headings use `h1` to `h3` (Press Start 2P on the 8 px grid), and sentences use plain `p` (Pixelify Sans, 18 px).
- Leave at least 8 px below every button for its side.

## Breakpoints

| Name    | Width        | Changes                                                                        |
| ------- | ------------ | ------------------------------------------------------------------------------ |
| Phone   | below 768 px | One column, h1 32 px, rival grid 2 columns, floodlight towers half off screen. |
| Tablet  | 768 px       | h1 48 px, cartridges 3 columns, rival grid 4 columns.                          |
| Desktop | 1024 px      | h1 64 px, section padding 96 px, marquee extrusion 4 px, rival names 16 px.    |

## Pinned HUD

```
360                                   1280
+--------------------------------+    +-------------------------------------------------------+
| 1UP 004200 [||||    ] [b][b][ ] |    | 1UP 004200 [||||||||||||                 ] [b][b][b][ ] |
+--------------------------------+    +-------------------------------------------------------+
```

- Markup: `header.rr-hud > .rr-container.rr-hud__inner`, holding `.rr-hud__score`, `.rr-meter` and `ul.rr-hud__badges`.
- The score is `.rr-hud__label` (1UP) plus `.rr-hud__value`, six digits, so it never changes width.
- The meter is `.rr-meter[role=progressbar]` with `style="--rr-meter-value: 0.4"` and a `.rr-meter__fill` child.
- Badges are `li.rr-badge`, with `.rr-badge--earned` once earned.
- At 360 px the score takes 160 px, so keep the badge row to 3 slots or show a count instead.
- Badge pops go in `.rr-toast-stack` (fixed under the HUD) as `.rr-toast`, and the text is also written to a separate `aria-live="polite"` region.
- Add `.is-leaving` to a toast to play its exit, then remove it.
- The HUD has no PLAY button: it would compete with each section's CTA.

## 1. Hero: the 60 m dash

```
360                           1280
+----------------------------+  +-----------------------------------------------------------+
| [tower]            [tower] |  | [tower]                                          [tower]  |
| RETRO                      |  |  RETRO RUNNER                 +------------------------+ |
| RUNNER                     |  |  One-line pitch               |                        | |
| One-line pitch             |  |  [ PLAY / INSERT COIN ]       |   60 m dash canvas     | |
| +------------------------+ |  |  Tap or mash A D to try       |                        | |
| |   60 m dash canvas     | |  |                               +------------------------+ |
| +------------------------+ |  +-----------------------------------------------------------+
| [ LEFT PAD ] [ RIGHT PAD ] |
| [ PLAY / INSERT COIN ]     |
+----------------------------+
```

- Section: `section.rr-section.rr-backdrop--floodlit`.
- Title: `h1.rr-marquee`.
- Canvas well: `.rr-panel.rr-panel--inset` around the `canvas`, which is pixelated by `base.css`.
- On desktop the copy and CTA take the left column and the canvas the right, in a 5 to 7 grid, both left-aligned.
- On phone the order is title, pitch, canvas, run pads, CTA, so the run pads sit under the thumb and the CTA follows the try-out.
- Run pads are two `button.rr-btn.rr-btn--secondary` side by side, each at least 64 px tall, shown on touch only.
- Primary CTA: `a.rr-btn.rr-btn--lg.rr-btn--coin` with `<span>PLAY</span><span class="rr-btn__sub">INSERT COIN</span>`, linking to `/`.

## 2. Story: the meet ladder

```
360                           1280
+----------------------------+  +-----------------------------------------------------------+
| h2                         |  | h2                                                        |
| One-line intro             |  |  [???]  ???                  +-------------------------+ |
|  [???]  ???                |  |   |                          | .rr-panel story card    | |
|   |                        |  |  [U7]   UNIT-7               | about the current meet  | |
|  [U7]   UNIT-7  Cyber...   |  |   |                          | [ PLAY ]                | |
|   |                        |  |  ...                         +-------------------------+ |
|  ...                       |  |  > [MA] MARCO  Next race                                  |
|  [PIP]  PIP  Schoolyard    |  |  [PIP]  PIP                                               |
|  [ PLAY ]                  |  +-----------------------------------------------------------+
+----------------------------+
```

- Section: `section.rr-section.rr-backdrop--space`, or plain if the hero backdrop is enough.
- Ladder: `ol.rr-ladder` with one `li.rr-ladder__node` per meet, written in race order (Pip first); the list draws them bottom to top.
- Node: `.rr-ladder__frame.rr-tier-N > img.rr-ladder__portrait.rr-sprite`, then `.rr-ladder__name` and `.rr-ladder__meta`.
- States: `.rr-ladder__node--beaten`, `--current` (blinking teal arrow) and `--locked` (the `???` node).
- A silhouette render from the art job gets `.is-silhouette` so the CSS fallback filter is skipped.
- On desktop the ladder takes the left 5 columns and a `.rr-panel` story card the right 7, sticky below the HUD.
- Primary CTA: one `a.rr-btn.rr-btn--lg` (PLAY) under the ladder on phone, inside the story card on desktop.

## 3. Mechanics: three cartridges

```
360                           1280
+----------------------------+  +-----------------------------------------------------------+
| h2                         |  | h2                                                        |
| +------------------------+ |  | +---------------+ +---------------+ +---------------+     |
| | [label: art + 100M   ] | |  | | label  100M   | | label HURDLES | | label  400M   |     |
| | Two lines of text      | |  | | text          | | text          | | text          |     |
| | [A] [D]                | |  | | [A] [D]       | | [SPACE]       | | [A] [D]       |     |
| | |||||||||||||||||||||| | |  | | ||||||||||||| | | ||||||||||||| | | ||||||||||||| |     |
| +------------------------+ |  | +---------------+ +---------------+ +---------------+     |
| (hurdles, 400M below)      |  |                 [ PLAY ]                                  |
| [ PLAY ]                   |  +-----------------------------------------------------------+
+----------------------------+
```

- Grid: `ul.rr-cart-grid`, one column on phone and three from 768 px.
- Card: `li.rr-cart.rr-cart--100m`, `.rr-cart--hurdles` or `.rr-cart--400m`.
- Inside: `.rr-cart__label > img.rr-cart__art.rr-sprite + h3.rr-cart__title`, then `p.rr-cart__text`, then `.rr-key` chips.
- Text on the shell is ink, links inside a cartridge are ink, and the focus ring turns ink there.
- Primary CTA: one `a.rr-btn.rr-btn--lg` centred under the grid.

## 4. Rival select

```
360                           1280
+----------------------------+  +-----------------------------------------------------------+
| h2                         |  | h2                                                        |
| +-----------+ +----------+ |  | +--------+ +--------+ +--------+ +--------+               |
| |P1 portrait| | portrait | |  | |P1      | |        | |        | |        |               |
| | PIP       | | JESS     | |  | | PIP    | | JESS   | | MARCO  | | KOFI   |               |
| +-----------+ +----------+ |  | +--------+ +--------+ +--------+ +--------+               |
| (3 more rows of 2)         |  | | VALEN. | | UNIT-7 | | SOL    | | ???    |               |
| [ PLAY AS PIP ]            |  |              [ PLAY ]                                     |
+----------------------------+  +-----------------------------------------------------------+
```

- Grid: `ul.rr-rival-grid`, two columns on phone and four from 768 px.
- Card: `button.rr-rival.rr-tier-N` with `aria-pressed`, holding `.rr-rival__art > img.rr-rival__portrait.rr-sprite` and `.rr-rival__plate` (`.rr-rival__name`, `.rr-rival__meta`).
- The pressed card gets the yellow frame and the P1 tag.
- The locked card is `.rr-rival.rr-rival--locked` with `aria-disabled="true"` and the name `???`; never show its real name or art.
- Names are 12 px below 1024 px so VALENTINA fits a tile, and 16 px above.
- Primary CTA: one `a.rr-btn.rr-btn--lg` under the grid.

## 5. Modes and records

```
360                           1280
+----------------------------+  +-----------------------------------------------------------+
| h2                         |  | h2                                                        |
| +------------------------+ |  | +-------------------------+ +---------------------------+ |
| | window: mode 1         | |  | | window: modes list      | | .rr-panel > table         | |
| +------------------------+ |  | |                         | | .rr-scores best times     | |
| | window: mode 2         | |  | +-------------------------+ +---------------------------+ |
| +------------------------+ |  |                 [ PLAY ]                                  |
| | .rr-scores best times  | |  +-----------------------------------------------------------+
| +------------------------+ |
| [ PLAY ]                   |
+----------------------------+
```

- Modes: `.rr-panel.rr-window > .rr-window__bar + .rr-window__body`, one window per mode.
- Records: `.rr-panel > table.rr-scores` with a `caption`, `thead` and three or so rows.
- On desktop modes and records sit side by side in two equal columns, top-aligned.
- Primary CTA: one `a.rr-btn.rr-btn--lg` under the two columns.

## 6. Final CTA: CONTINUE?

```
360                           1280
+----------------------------+  +-----------------------------------------------------------+
| ==== finish line track === |  | ============ finish line track =========================  |
|        CONTINUE?           |  |                      CONTINUE?                            |
|           9                |  |                         9                                 |
|   [ PLAY / INSERT COIN ]   |  |               [ PLAY / INSERT COIN ]                      |
+----------------------------+  +-----------------------------------------------------------+
```

- Before it: `div.rr-track.rr-track--finish`.
- Section: `section.rr-section.rr-backdrop--floodlit > .rr-container.rr-countdown`, centred.
- Heading: `h2` (CONTINUE?), then `p.rr-countdown__number`, which ticks once a second and must not be announced on every tick.
- Primary CTA: `a.rr-btn.rr-btn--lg.rr-btn--coin`, the same as the hero, linking to `/`.

## Motion and accessibility

- Blinks (`.rr-blink`, `.rr-caret`, `.rr-btn--coin`, the current ladder arrow) run at 1 Hz, inside the game's flashing limits (design 6.5).
- Under `prefers-reduced-motion: reduce` every blink and pop stops in its visible state, transitions are instant and the CRT overlay is hidden.
- Focus is a 4 px teal ring 4 px outside the element; components with light fills set `--rr-color-focus` to ink.
- Do not put `clip-path` (`--rr-clip-notch`, `.rr-panel`, `.rr-cart`) on a focusable element: it would clip the focus ring.
- Every tap target is at least 48 px (`--rr-tap-min`).
