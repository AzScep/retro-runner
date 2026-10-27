# Retro Runner - Game Design Document

Status: v1 design, engine-agnostic.
Owner: Game Director.
All numbers in this document are the source of truth for tuning.
Section 11 collects every tunable constant in one table so implementers can put them in a single config module.

## 0. Pitch and pillars

A 16-bit side-view 100 m sprint game, a successor in spirit to Konami's Track & Field and Hyper Sports.
The player mashes Left and Right alternately to sprint against a ladder of seven rivals, from a primary school kid to an alien champion.

| Pillar | Meaning in practice |
|---|---|
| Honest mashing | Speed comes only from alternating key presses. Holding, auto-repeat and same-key spam give nothing. |
| Every hundredth counts | Every race records a time. Personal bests per rival persist and are always visible. |
| 16-bit authenticity | 320x180 internal canvas, fixed 42-colour palette, 1 px dark outlines, nearest-neighbour integer scaling. |
| Short, replayable races | A race lasts 10-20 s. Retry is one key press away. |

## 1. Core loop and screen flow

### 1.1 Loop

1. Pick an unlocked rival on the Ladder Map.
2. Countdown, race 100 m, see the result card with times and PB.
3. Win to unlock the next rival, or retry instantly to beat your time.

### 1.2 Screens

| # | Screen | Shows | Inputs | Goes to |
|---|---|---|---|---|
| S1 | Boot / Title | Logo, "PRESS ENTER", version, mute icon | Enter/Space: continue. M: mute. | S2 |
| S2 | Ladder Map | Vertical ladder of 7 rival nodes, bottom (Pip) to top (Zyx). Selected rival card: portrait, name, tier, target time, your PB. Menu row: RACE, RECORDS, OPTIONS. | Up/Down: move between rivals. Left/Right: move in menu row. Enter: confirm. Esc: back to Title. | S3, S6, S7 |
| S3 | Pre-race | Stadium for that tier, both runners walk to blocks (1.5 s), then crouch. Countdown 3-2-1-GO. | Left/Right only matter as false start detection. Esc: pause. | S4 |
| S4 | Race | Running, HUD (section 6). | Left/Right (or A/D): run. Esc: pause. | S5 |
| S5 | Results | Result card (section 6.6). | Enter: default button. Left/Right: choose button. R: retry. Esc: map. | S3 (retry), S3 next rival (next), S2 (map) |
| S6 | Records | Per-rival PB table and last results (section 4.5). | Up/Down: scroll. Esc: back. | S2 |
| S7 | Options | Volume (0-10), mute, reduced flashing, screen shake on/off, reset records. | Up/Down, Left/Right, Enter, Esc. | S2 |
| S8 | Pause (overlay) | RESUME, RESTART, QUIT TO MAP. | Up/Down, Enter. Esc: resume. | S4, S3, S2 |
| S9 | Champion | Shown once after first win vs Zyx: celebration, ladder total time, credits scroll. | Enter: skip. | S2 |

### 1.3 Unlock rules

1. Tier 1 (Pip) is unlocked on a fresh save.
2. Winning against tier N unlocks tier N+1 immediately and moves the map cursor to it.
3. Unlocks are permanent. Losing never re-locks anything.
4. Every unlocked rival can be raced any number of times, and every completed race records a time.
5. Locked rivals show a black silhouette, "???" as name and "Beat <previous name> to unlock".
6. First win against Zyx (tier 7) sets `champion: true` and shows S9 once.
7. "Ladder total" = sum of PBs against all 7 rivals, shown only when all 7 have a PB.

### 1.4 Race end rules

1. The race clock starts at GO (t = 0) and runs on the simulation clock, not wall time.
2. The player's time is the interpolated instant their position crosses 100.000 m (section 2.6).
3. If the player finishes first, the opponent's remaining run is simulated instantly off-screen to get its exact time.
   The results card appears 1.5 s after the player crosses.
4. If the opponent finishes first, the race continues until the player crosses.
5. If the player has not finished by t = 30.00 s, the race ends as DNF: loss, no time recorded, no PB.
6. Win if player ms < opponent ms.
   Equal ms is a dead heat and counts as a win, shown as "PHOTO FINISH".
7. Both runners keep running past the line into a 20 m run-out and decelerate (player: input ignored after crossing; AI: target speed 0 with its tau).

## 2. Mash-to-speed model

### 2.1 Units and world scale

| Quantity | Value |
|---|---|
| Race distance | 100 m |
| Pixels per metre | 24 px/m (an adult runner sprite ~40 px tall reads as ~1.7 m) |
| Track length in world | 2400 px start-to-finish plus 480 px run-out (20 m) plus 96 px before the start line |
| Simulation | Fixed timestep 120 Hz (dt = 1/120 s), rendering interpolated at display rate |
| Speed unit | m/s internally. HUD shows km/h = m/s x 3.6, rounded to integer. |

### 2.2 What counts as a step

A "valid step" is a keydown that satisfies all of the following.

1. The key maps to LEFT (ArrowLeft or A) or RIGHT (ArrowRight or D).
2. It is not an auto-repeat event (browser `event.repeat === true` or engine equivalent is discarded).
3. That side is not already held down (a keydown for a side with no intervening keyup is discarded).
   ArrowLeft and A are the same side, so holding A and tapping ArrowLeft gives nothing.
4. It is the opposite side of the last valid step, or it is the first step of the race.
5. At least 35 ms have passed since the last valid step (cap of ~28 steps/s, filters chorded double presses).

A keydown on the same side as the last valid step (a "same-key press") is a fumble.
It gives zero impulse, does not change `lastSide`, does not reset the idle timer, and plays the fumble feedback (prompt shake, soft thud SFX).
There is no extra penalty beyond the lost tempo.

Keyups are only used for rule 3 and are otherwise ignored.
Inputs are processed in timestamp order at the start of the next simulation step.

### 2.3 Velocity formula

State: `v` (m/s), `x` (m), `lastSide`, `lastStepTime`, `idleTime`.

On each valid step:

```
v = min(v + J, V_MAX)
```

Every simulation step (dt = 1/120 s):

```
v = v - K_DRAG * v * dt
if idleTime > IDLE_GRACE: v = max(0, v - IDLE_DECEL * dt)
x = x + v * dt
```

| Constant | Value | Meaning |
|---|---|---|
| J (STEP_IMPULSE) | 0.50 m/s | Speed added per valid alternation |
| K_DRAG | 0.50 /s | Proportional drag, time constant tau = 2.0 s |
| V_MAX | 12.5 m/s | Hard cap (45 km/h) |
| IDLE_GRACE | 0.25 s | Time since last valid step before idle braking starts |
| IDLE_DECEL | 3.0 m/s^2 | Extra braking when not mashing |
| MIN_STEP_INTERVAL | 35 ms | Faster valid alternations are discarded |

Design property: at a sustained rate of `r` valid alternations per second, the average speed settles at `r * J / K_DRAG = r` m/s.
In words, your speed in m/s equals your alternations per second, up to the 12.5 cap.

### 2.4 Expected finish times

From rest with drag time constant tau = 2.0 s, finish time is approximately `T = 100 / r + 2.0` s.

| Sustained rate r (alt/s) | Cruise speed | Approx. finish |
|---|---|---|
| 6 | 6.0 m/s | 18.7 s |
| 7 | 7.0 m/s | 16.3 s |
| 8 | 8.0 m/s | 14.5 s |
| 9 | 9.0 m/s | 13.1 s |
| 10 | 10.0 m/s | 12.0 s |
| 11 | 11.0 m/s | 11.1 s |
| 12 | 12.0 m/s | 10.3 s |
| 12.5 or more (capped) | 12.5 m/s | ~10.0 s (theoretical floor) |

A good human mashing 9-11 alternations per second finishes in 11-13 s, inside the 10-14 s target feel.

### 2.5 False start rule

Countdown timing, from the moment both runners are crouched:

| Phase | Duration | Display | SFX |
|---|---|---|---|
| "3" | 0.80 s | Big "3" | Beep low |
| "2" | 0.80 s | Big "2" | Beep low |
| "1" | 0.80 s + random 0.00-0.50 s (uniform, per attempt) | Big "1" | Beep low |
| GO | t = 0, text visible 0.60 s | "GO!" | Beep high |

1. The false start window opens when "3" appears and closes at GO.
2. Any fresh (non-auto-repeat) LEFT or RIGHT keydown inside the window is a false start.
   Auto-repeat events are never a false start, because a held key auto-repeats on real keyboards.
   Holding a key down through the countdown without a new keydown is not a false start, but that held key cannot produce a step until it is released and pressed again (rule 2.2.3).
3. First false start in a race: "FALSE START!" banner for 1.5 s, runners return to crouch, countdown restarts from "3".
4. Second false start in the same race: disqualified.
   Result card shows "DISQUALIFIED", counts as a loss, records no time and no PB, and is logged in history as `dq`.
5. Restarting via pause menu resets the false start count.
6. Inputs before GO are never buffered into speed.

### 2.6 Finish timing precision

Finish time is interpolated within the simulation step that crosses 100 m:

```
t_finish = t_prev + dt * (100 - x_prev) / (x_now - x_prev)
ms = round(t_finish * 1000)
```

The same rule applies to the AI.

## 3. Opponents

### 3.1 AI movement model

The AI does not simulate key presses.
It chases a target speed with an exponential approach:

```
before t = REACTION: v = 0
after:  v += (vTarget - v) * (dt / TAU)
vTarget = V_TOP * quirkMultiplier(x, t, state)
```

Approximate finish time is `REACTION + TAU + (effective distance) / V_TOP`.
The V_TOP values below are computed from that approximation and are starting values.
Implementers must tune V_TOP with a headless simulation (1000 seeded races per rival) until the mean finish time equals the target within +/-0.05 s.

Per-race variance: V_TOP is multiplied by a seeded uniform factor in [0.99, 1.01], and quirk trigger distances shift by a seeded uniform +/-3 m.
The race seed is stored in the history entry for reproduction.

"Required rate" is the sustained alternation rate the player needs to beat the target, from `r = 100 / (T - 2)`.

### 3.2 Roster

| Tier | Id | Name | Who | Target time | Required rate | REACTION | TAU | V_TOP (start) |
|---|---|---|---|---|---|---|---|---|
| 1 | `pip` | Pip | Primary school student | 18.00 s | 6.3 alt/s | 0.30 s | 1.5 s | 6.55 m/s |
| 2 | `jess` | Jess | High school student | 15.00 s | 7.7 alt/s | 0.25 s | 1.2 s | 7.70 m/s |
| 3 | `marco` | Marco | University student | 13.60 s | 8.6 alt/s | 0.22 s | 1.8 s | 8.77 m/s |
| 4 | `kofi` | Kofi | Club athlete | 12.60 s | 9.4 alt/s | 0.18 s | 1.4 s | 8.99 m/s |
| 5 | `valentina` | Valentina | Olympian (added tier) | 11.60 s | 10.4 alt/s | 0.14 s | 1.2 s | 9.63 m/s |
| 6 | `unit7` | UNIT-7 | Cyborg (added tier) | 11.00 s | 11.1 alt/s | 0.10 s | 2.4 s | 11.74 m/s |
| 7 | `zyx` | Zyx | Alien, final boss | 10.40 s | 11.9 alt/s | 0.05 s | 1.0 s | 10.18 m/s |

The step from tier to tier is roughly +0.8 to +1.0 alternations per second, so each rival asks for a noticeably faster hand.
Zyx needs ~12 alt/s sustained, near the practical human ceiling and close to the 12.5 m/s cap.

### 3.3 Personalities, looks and quirks

| Id | Look (palette ramps from section 5.2) | Personality | Quirks (multiplier on vTarget) |
|---|---|---|---|
| `pip` | ~30 px tall kid, oversized yellow cap, green PE shirt, red sneakers, tiny backpack. | Excited, clumsy, waves to parents. | Trip at 45 m: x0.30 for 0.6 s, plays stumble anim. Wave at 80 m: x0.85 for 1.0 s, plays wave overlay. |
| `jess` | Ponytail, blue track jacket, earbuds, white shorts. | Fast starter, bored by the end. | Fade from 60 m: x0.90 to the line. Celebrate anim blows a gum bubble. |
| `marco` | Purple uni hoodie, headphones on neck, sunglasses pushed up, scruffy hair. | Talented but lazy. | Coasts 30-50 m: x0.93 and looks at the camera. Otherwise steady. |
| `kofi` | Green and yellow club singlet, muscular build, focused eyebrows. | Disciplined, strong finisher. | Late kick from 80 m: x1.05. |
| `valentina` | Gold and blue national kit, long braid, medal glint on celebrate. | Composed champion, flawless start. | Kick from 70 m: x1.04. Flashbulb pops in crowd when she passes 70 m. |
| `unit7` | Chrome grey body (neutral ramp), teal visor glow, piston legs, exhaust puffs. | Machine, slow to boot, then relentless. | Long TAU (boot-up). Overclock 50-85 m: x1.06 with red glow. Overheat 85-92 m: x0.80 with spark overlay. 92 m on: x1.00. |
| `zyx` | Teal skin, three eyes, purple bodysuit, antenna, longer legs, 44 px tall. | Cold, playful, bends space. | Warp at 30 m and 65 m: vanish for 0.25 s (no movement, warp anim), reappear 5.0 m further ahead at the same speed. Pressure: after 50 m, if the player leads by more than 1.5 m, x1.03 until the player no longer leads. |

Quirk costs are already included in the V_TOP starting values (for example Jess: `1.45 + (60 + 40/0.90) / V = 15.0`).
The Zyx pressure rule is excluded from the 10.40 s target, so it only bites when the player is winning.

### 3.4 Player character

| Id | Name | Look |
|---|---|---|
| `rio` | Rio | Red singlet with white trim, white shorts, yellow headband, dark short hair, ~40 px tall. One hero in v1. |

## 4. Time recording

### 4.1 Precision and display

1. Stored as integer milliseconds.
2. Displayed as `SS.hh` (seconds and hundredths), for example `11.84`.
   Times of 100 s or more never occur because of the 30 s DNF cap.
3. Display rounding: round up to the next hundredth (`ceil(ms / 10) / 100`), as in fully automatic athletics timing.
4. Comparison for win/lose and PB always uses raw ms, never the displayed value.
5. Live HUD timer shows the same format and updates every rendered frame.
6. Margin is shown signed: `-0.76` (player faster) or `+0.31` (player slower).

### 4.2 What is stored

| Data | Rule |
|---|---|
| Personal best per rival | Lowest player ms in a completed race (win or loss) against that rival. DQ and DNF never count. |
| History | Last 50 races across all rivals, newest first. Includes DQ and DNF entries. |
| Unlocks | Highest unlocked tier and the set of rivals beaten at least once. |
| Champion flag | True after first win vs Zyx. |
| Settings | Volume, mute, reduced flashing, screen shake. |

### 4.3 Storage schema

Single key in browser `localStorage` (or the engine's equivalent string key-value store): `retroRunner.save.v1`.
Value: one JSON document.

```json
{
  "version": 1,
  "unlockedTier": 3,
  "beaten": ["pip", "jess"],
  "champion": false,
  "best": {
    "pip":  { "ms": 12840, "at": "2026-10-26T20:15:03.120Z" },
    "jess": { "ms": 13410, "at": "2026-10-26T20:21:44.007Z" }
  },
  "history": [
    {
      "opp": "marco",
      "result": "lose",
      "ms": 13920,
      "oppMs": 13580,
      "falseStarts": 1,
      "seed": 1849302231,
      "at": "2026-10-26T20:30:12.551Z"
    }
  ],
  "settings": { "volume": 8, "muted": false, "reducedFlashing": false, "screenShake": true }
}
```

| Field | Type and validation |
|---|---|
| `version` | Integer, must equal 1. |
| `unlockedTier` | Integer 1-7. |
| `beaten` | Array of rival ids, unique, each a known id. |
| `champion` | Boolean. |
| `best.<id>.ms` | Integer 5000-30000. Entries outside the range are dropped on load. |
| `best.<id>.at` | ISO 8601 UTC string. |
| `history[].result` | One of `win`, `lose`, `dq`, `dnf`. |
| `history[].ms`, `oppMs` | Integer ms, or `null` for `dq` and `dnf` (`oppMs` is still recorded for `dnf`). |
| `history` length | At most 50. Append to the front, truncate the tail. |
| `settings.volume` | Integer 0-10. |

Write rules:

1. Save immediately after every race result and every settings change.
2. If the stored value fails JSON parse or `version` is not 1, copy the raw string to `retroRunner.save.corrupt` and start a fresh save.
   Future versions add `retroRunner.save.v2` and migrate from v1 on first load.
3. If storage is unavailable or a write throws (private mode, quota), keep the save in memory and show "RECORDS WILL NOT BE SAVED" once on the Title screen.
4. "Reset records" in Options requires two confirmations (select RESET, then confirm "ARE YOU SURE? YES / NO", default NO) and removes the key.

### 4.4 Results feedback for times

1. If the new time beats the stored PB (or there was none), the card shows "NEW PB!" flashing and the old PB below it.
2. The Ladder Map rival card always shows target time and PB (or `--.--` if none).
3. The HUD shows the current rival's PB at the top right during the race.

### 4.5 Records screen (S6)

Table at 320x180, one row per rival, 7 rows of 16 px:

| Column | Content |
|---|---|
| Rival | 16x16 portrait and name (locked: silhouette, "???") |
| Status | Trophy icon if beaten |
| PB | `SS.hh` or `--.--` |
| Target | Rival target time |
| Last 3 | Last three player times against that rival from history (DQ shown as `DQ`, DNF as `DNF`) |

Footer: "LADDER TOTAL" (sum of 7 PBs, shown as `SSS.hh`) or "BEAT ALL 7 TO SET A LADDER TOTAL".

## 5. Art bible

### 5.1 Canvas and scaling

| Rule | Value |
|---|---|
| Internal resolution | 320 x 180 (16:9) |
| Scaling | Integer only, the largest factor that fits the window (4x = 1280x720, 6x = 1920x1080). Remaining space is letterboxed with `#0b0b14`. |
| Filtering | Nearest-neighbour everywhere. No smoothing, no sub-pixel positioning on screen: sprite and layer positions are rounded to whole internal pixels at draw time. |
| Frame rate | Target 60 fps render, 120 Hz simulation. |

### 5.2 Master palette (42 colours plus transparent)

Every sprite, tile, UI element and font colour must use only these values.
Index 0 is transparent and is never drawn.

| Idx | Group | Hex | Use |
|---|---|---|---|
| 1 | Ink | `#0b0b14` | Outline, letterbox, darkest |
| 2 | Ink | `#1d1b2e` | Deep shadow, UI panel fill |
| 3 | Ink | `#2e2a45` | Shadow on dark materials |
| 4 | Neutral | `#4a4766` | Metal shadow, dark grey |
| 5 | Neutral | `#6e6b8c` | Metal base, grey |
| 6 | Neutral | `#9b98b3` | Metal light, lane line shadow |
| 7 | Neutral | `#c9c7d9` | Light grey, chalk |
| 8 | Neutral | `#f4f2ff` | White, lane lines, text |
| 9 | Skin | `#4a2a1a` | Skin darkest / selout |
| 10 | Skin | `#7a4a2c` | Skin dark |
| 11 | Skin | `#b0774a` | Skin mid |
| 12 | Skin | `#dda67a` | Skin light |
| 13 | Skin | `#f7d3ae` | Skin lightest |
| 14 | Hair | `#2b1a12` | Dark hair shadow |
| 15 | Hair | `#5a3a22` | Brown hair |
| 16 | Red | `#6b1525` | Red shadow |
| 17 | Red | `#b02a32` | Red base |
| 18 | Red | `#e8503f` | Red light, player kit |
| 19 | Red | `#ff8f6b` | Red highlight |
| 20 | Yellow | `#a85a12` | Orange shadow |
| 21 | Yellow | `#e89a1c` | Orange base |
| 22 | Yellow | `#ffd23f` | Yellow, gold, GO text |
| 23 | Yellow | `#fff1a8` | Pale yellow highlight |
| 24 | Green | `#18402a` | Green shadow |
| 25 | Green | `#2e7a3a` | Grass base |
| 26 | Green | `#5dbb46` | Grass light, speed meter low |
| 27 | Green | `#a6e86b` | Green highlight |
| 28 | Blue | `#142a5c` | Navy, night sky |
| 29 | Blue | `#2456b8` | Blue base |
| 30 | Blue | `#4b8df0` | Sky |
| 31 | Blue | `#9cd2ff` | Sky light, highlight |
| 32 | Purple | `#3b1d5c` | Purple shadow |
| 33 | Purple | `#6e2fa0` | Purple base |
| 34 | Purple | `#b05ce0` | Purple light, neon |
| 35 | Teal | `#0f4a4a` | Teal shadow |
| 36 | Teal | `#1fa38f` | Teal base, alien skin |
| 37 | Teal | `#6ef2c2` | Teal glow |
| 38 | Tartan | `#5c2a1e` | Track shadow, runner ground shadow |
| 39 | Tartan | `#8f3f2a` | Track base |
| 40 | Tartan | `#c4613c` | Track light |
| 41 | Accent | `#ff7aa8` | Sunset pink, flashbulb |
| 42 | Accent | `#0a1430` | Space black-blue |

### 5.3 Outlines

1. Every character, prop and UI panel has a 1 px outer outline.
2. Default outline colour is index 1 `#0b0b14`.
3. Selective outline (selout) is allowed: outline pixels on the lit side (top and left edges) may use the darkest tone of the adjacent material ramp (for example skin index 9, red index 16).
   Bottom and right outlines always stay index 1.
4. Interior lines (separating limbs, clothing folds) use the material's darkest ramp tone, never index 1.
5. Outlines are 1 px wide everywhere, never doubled, and must be single-pixel-connected with no orphan pixels or jaggies on curves (clean pixel steps of 1-2-3 patterns).
6. No anti-aliasing against transparency.
   Manual in-palette anti-aliasing is allowed only inside large shapes of 16 px or more.

### 5.4 Shading

1. Light comes from the top-left at roughly 45 degrees.
2. Each material uses 3 tones: shadow, base, highlight.
   Metal (UNIT-7) and alien skin (Zyx) may add a 4th specular tone (index 8 or 37).
3. No pillow shading: shadows sit on the bottom-right of each form, not around all edges.
4. Dithering is allowed only in backgrounds (sky gradients, stands), using a 2x2 checker between two adjacent ramp tones.
   Characters use flat tones.
5. No semi-transparency anywhere.
   Runner ground shadows are a solid 20x3 px ellipse in index 38.

### 5.5 Sprites

| Item | Size | Notes |
|---|---|---|
| Character frame | 48 x 48 px | Origin (pivot) at bottom-centre, pixel (24, 47). Feet rest on row 46. |
| Adult figure height | ~40 px | Rio, Jess, Marco, Kofi, Valentina, UNIT-7. |
| Pip height | ~30 px | Same 48x48 frame. |
| Zyx height | ~44 px | Same 48x48 frame. |
| Portrait | 16 x 16 px (map, HUD) and 48 x 48 px (rival card) | Same palette rules. |
| Effects | 16 x 16 px | Dust puff, sparks, warp ring, flashbulb, sweat drop. |

Characters face right.
Never flip a sprite to fake a different direction for facial features or numbers on kits.

### 5.6 Animation list (every character)

| Anim | Frames | FPS | Loop | Notes |
|---|---|---|---|---|
| idle | 4 | 6 | yes | Breathing, small bounce. Used on map card and pre-race walk end. |
| walk | 6 | 10 | yes | Walk to the blocks in S3. |
| ready | 2 | - | held | Frame 1 "on marks" crouch, frame 2 "set" hips up (shown from "1"). |
| run | 8 | variable | yes | 8 frames = 2 strides. FPS = clamp(2 x v, 6, 25) where v is m/s. Below 0.3 m/s show ready frame 2. |
| lean | 2 | 12 | no | Dip at the finish line, triggered at 98 m, held until 102 m. |
| celebrate | 6 | 8 | yes | Win pose. |
| lose | 4 | 6 | yes | Hands on knees or slump. |
| stumble | 3 | 12 | no | Pip trip, player fumble does not use this. Also used for false start "jolt" (frames 1-2). |

Per character: 35 frames.
Total for 8 characters: 280 frames.

Character-specific extras:

| Character | Extra anim | Frames | FPS |
|---|---|---|---|
| Pip | wave (upper body overlay) | 4 | 8 |
| Jess | gum bubble (celebrate overlay) | 4 | 6 |
| UNIT-7 | spark overlay, exhaust puff | 4 each | 12 |
| Zyx | warp out / warp in | 6 each | 20 |

Dust puff effect: spawn one 16x16 puff (4 frames, 16 fps) at the back foot on every player valid step, max one per 60 ms.

### 5.7 Background layers (side view, runners move left to right)

Camera: follows the player so that Rio's pivot is at screen x = 96, clamped so the start line is visible at the start and the camera stops 64 px after the finish line run-out begins.

| Layer | Screen rows (y) | Parallax factor | Content |
|---|---|---|---|
| L0 Sky | 0-48 | 0.00 | Gradient bands with 2x2 dither, per-tier colours. Static clouds or stars. |
| L1 Far | 24-64 | 0.10 | Stadium roof, skyline, floodlight towers. 256 px wide tile. |
| L2 Far stands | 48-92 | 0.30 | Crowd tile 128 px wide, 2-frame crowd bob at 4 fps, faster (8 fps) when a runner is within 10 m of the finish. |
| L3 Near stands | 88-104 | 0.60 | Advertising boards and wall, 64 px tiles with fictional brand-free signage. |
| L4 Track | 104-160 | 1.00 | Lane 1 (rival): feet at y = 128. Lane 2 (player): feet at y = 152. 1 px lane lines index 8 at y = 108, 132, 156. Start line, checkered finish line, distance boards every 10 m. |
| L5 Foreground | 160-180 | 1.30 | Sparse props: infield grass, camera operator, hurdle stacks, cones. Max 1 prop per 160 px. Never covers runner feet. |

### 5.8 Stadium themes (one per tier)

Built from shared layer tiles plus palette-index remaps within the master palette and 1-2 unique props per tier.

| Tier | Theme | Sky (L0) | Unique props |
|---|---|---|---|
| 1 Pip | Primary schoolyard, grass track with chalk lines | Morning: 30, 31, 8 | Parents with banners, school building |
| 2 Jess | High school track, evening | Dusk: 29, 41, 21 | Wooden bleachers, scoreboard |
| 3 Marco | University stadium, daytime | Day: 30, 31 | Brick facade, purple pennants |
| 4 Kofi | City stadium under floodlights | Night: 28, 2 | Floodlight towers, big screen |
| 5 Valentina | Olympic stadium at sunset | Sunset: 41, 21, 22 | Flags, rings-free torch cauldron, flashbulbs |
| 6 UNIT-7 | Cyber arena | Dark: 32, 2 with neon lines 34 | Neon boards, drones |
| 7 Zyx | Mothership track in orbit | Space: 42, 1 with star pixels 8 and 37 | Planet on L1, teal glowing lane lines |

Note: Olympic rings and real brand logos are not used anywhere.

## 6. UI and HUD

### 6.1 Fonts

| Use | Font | Licence | Size |
|---|---|---|---|
| Titles, countdown, timer, banners | Press Start 2P (by CodeMan38) | SIL Open Font License 1.1 | 8 px grid, drawn at 1x, 2x or 4x integer scale only |
| Dense small text (records table, options help) | Kenney Pixel (Kenney Fonts pack) | CC0 1.0 | Native size only |

Ship each font's licence file alongside the font.
Render text from a pre-baked bitmap atlas or with smoothing disabled, and snap to whole internal pixels.
Text colours: index 8 on panels of index 2, with a 1 px drop shadow in index 1.

### 6.2 Race HUD layout (320 x 180)

| Element | Position (x, y, w x h) | Details |
|---|---|---|
| Rival badge | (4, 4, 80 x 16) | 16x16 portrait plus name in 8 px text. |
| Timer | (128, 4, 64 x 16) | `SS.hh` at 2x (16 px glyphs), index 8. Before GO shows `00.00`. |
| PB | (236, 4, 80 x 8) | `PB 12.84` or `PB --.--`, 8 px. |
| Progress bar | (40, 24, 240 x 8) | 240 px = 100 m (2.4 px per metre). Track in index 2 with index 1 outline. Rival marker: 6x4 px head icon above the bar. Player marker: 6x4 px red head icon below the bar. Finish flag icon at x = 280. |
| Off-screen arrow | Screen edge at the rival lane y = 112 | When the rival is off-screen: 8x8 arrow plus gap in metres, for example `> 4.2m`. |
| Speed meter | (8, 164, 84 x 12) | Label `SPD` then 10 segments of 5x8 px with 1 px gaps (6 px segments cannot fit the label and km/h in the box). Lit segments = ceil(10 x v / V_MAX). Segments 1-5 index 26, 6-8 index 22, 9-10 index 18. km/h value to the right in 8 px text. |
| Key prompt | (136, 160, 48 x 16) | Two 16x16 arrow-key icons (left at x = 136, right at x = 168). See 6.4. |
| Fumble feedback | Key prompt | On same-key press: wrong key icon shakes 2 px left-right for 4 frames, tinted index 17. |

### 6.3 Countdown

1. Centred at (160, 72), glyphs 32 px tall (Press Start 2P at 4x).
2. "3", "2", "1" in index 8 with a 1 px index 1 outline, scale pop from 1.25x to 1x over 80 ms in integer steps (draw 5x for 2 frames then 4x).
3. "GO!" in index 22 for 0.60 s.
4. "FALSE START!" in index 18 at 2x, 1.5 s.

### 6.4 Key prompt behaviour

1. Before GO: both keys shown dim (index 5).
2. From GO: the expected next side is bright (index 8 fill, index 22 border), the other is dim.
   With reduced flashing on, both keys stay bright, because the swap can alternate faster than 1 Hz.
   First step accepts either, so both are bright until the first valid step.
3. If no valid step for 0.5 s during the race: both keys pulse and "MASH!" appears above them, pulse rate 2 Hz (1 Hz when reduced flashing is on).
4. Hidden once the player crosses the finish line.

### 6.5 Flashing limits

No element flashes faster than 3 Hz.
With reduced flashing on: max 1 Hz, flashbulbs disabled, screen shake disabled.

### 6.6 Results card

Panel at (52, 28, 216 x 124) (216 px so `PHOTO FINISH` and `DISQUALIFIED` fit at 2x), fill index 2, 1 px index 8 border inside a 1 px index 1 outline.

| Row | y offset | Content |
|---|---|---|
| Title | 8 | `YOU WIN!` (index 22), `YOU LOSE` (index 17), `PHOTO FINISH` (index 22), `DISQUALIFIED` or `DID NOT FINISH` (index 17), 2x font |
| Player | 32 | Rio portrait, `RIO`, time `11.84` |
| Rival | 48 | Rival portrait, name, time |
| Margin | 64 | `MARGIN -0.76` |
| PB | 80 | `NEW PB!` flashing at 2 Hz plus `OLD 12.10`, or `PB 11.52` |
| Unlock | 96 | On first win: `<NEXT NAME> UNLOCKED!` |
| Buttons | 108 | `NEXT` (only if next tier unlocked), `RETRY`, `MAP`. Default focus: `NEXT` after a win, `RETRY` after a loss. |

The card slides in from the bottom over 0.25 s while runners play celebrate or lose animations behind it.

### 6.7 Ladder map layout

1. Ladder occupies x 16-120, 7 nodes from y = 156 (Pip) to y = 20 (Zyx), 22 px apart, joined by a 2 px rope line.
2. Node: 16x16 portrait in a 20x20 frame. Beaten: trophy pip. Locked: silhouette.
3. Rival card on the right: (136, 16, 168 x 132) with 48x48 portrait, name, tier label, `TARGET 13.60`, `PB 12.84`, one-line flavour text.
4. Menu row at y = 156: `RACE`, `RECORDS`, `OPTIONS`.

## 7. Audio

### 7.1 Music direction

Chiptune in the SNES SPC700 / Genesis FM tradition: punchy square and pulse leads, triangle or FM bass, noise-channel drums, short reverb at most.
Songs are ZzFXM tracker data synthesised at runtime in a Web Worker (see `src/audio/music/`), so no audio files ship; loop points are sample-accurate.

| Track | Tempo | Length | Notes |
|---|---|---|---|
| Title theme | 140 BPM | 45-60 s loop | Heroic, major key. |
| Ladder map | 110 BPM | 30-45 s loop | Light, anticipatory. |
| Race theme | 165 BPM | 30 s loop | Driving. One shared track, transposed up a semitone per tier (tier 7 uses its own variant with detuned "alien" lead). |
| Boss race (Zyx) | 175 BPM | 30 s loop | Minor key, arpeggio-heavy. |
| Champion / credits | 120 BPM | 60 s | Triumphant. |

Music ducks to 40% volume during the countdown and the results jingles.

### 7.2 SFX list

| SFX | Trigger | Character | Length |
|---|---|---|---|
| step_l / step_r | Every valid step | Short noise tick, right step 2 semitones higher than left. Max one per 40 ms. | 40 ms |
| fumble | Same-key press | Low dull thud | 60 ms |
| beep_count | "3", "2", "1" | Square 440 Hz | 150 ms |
| beep_go | GO | Square 880 Hz | 400 ms |
| false_start | False start | Descending two-tone buzzer | 500 ms |
| crowd_loop | During race | Filtered noise swell, volume rises in the last 20 m | loop |
| finish | Player crosses line | Whistle plus crowd roar burst | 800 ms |
| win_jingle | Results, win | Major fanfare | 2.5 s |
| lose_jingle | Results, loss, DQ, DNF | Descending minor phrase | 2.0 s |
| new_pb | NEW PB shown | Sparkle arpeggio | 600 ms |
| unlock | Next rival unlocked | Rising arpeggio | 800 ms |
| menu_move | Cursor move | Soft blip | 50 ms |
| menu_select | Confirm | Bright blip | 120 ms |
| menu_back | Back or Esc | Lower blip | 100 ms |
| warp | Zyx warp out and in | Pitch-swept zap | 300 ms |
| overheat | UNIT-7 overheat | Sizzle with sparks | 600 ms |
| flashbulb | Valentina passes 70 m (off with reduced flashing) | Camera shutter pop | 250 ms |

Audio starts only after the first user input (browser autoplay policy); the Title screen's first Enter unlocks audio.

## 8. Controls and accessibility

| Action | Primary | Alternate |
|---|---|---|
| Run, left step | ArrowLeft | A |
| Run, right step | ArrowRight | D |
| Confirm | Enter | Space |
| Back / pause | Esc | Backspace (menus only) |
| Menu navigation | Arrow keys | W/A/S/D |
| Retry (results) | R | - |
| Mute toggle | M (any screen) | - |

Rules:

1. Primary and alternate keys can be mixed freely (A then ArrowRight is a valid alternation) because they map to sides, not keys.
2. Holding any key never produces speed: auto-repeat events are discarded and a held side cannot step again until released (section 2.2).
3. During S4, Space and Enter do nothing, so a stray confirm press cannot skip anything.
4. Pause freezes the simulation and the race clock.
   On resume there is a 0.5 s frozen "GET SET" beat; held keys must be released and re-pressed to count.
5. Window blur or tab hidden auto-pauses during S3 and S4.
6. Mute and volume persist in the save.
7. Options: reduced flashing (section 6.5), screen shake on/off.
8. All information carried by colour is also carried by shape or text (WIN/LOSE text, arrow icons, numeric km/h).
9. Browser default actions for arrow keys, Space and Backspace are prevented while the game has focus, so the page never scrolls.

## 9. Scope

### 9.1 v1 (must ship)

1. Screens S1-S9.
2. Rio plus 7 rivals with all animations in section 5.6.
3. 7 stadium themes with the 6 parallax layers.
4. Mash model, false start rule, DNF and DQ exactly as specified.
5. Seeded AI with quirks, tuned to target times by the headless simulation test.
6. Time recording, PBs, 50-entry history, records screen, `retroRunner.save.v1` persistence with corruption handling.
7. Music tracks and full SFX list.
8. Keyboard controls with alternate keys, pause, mute, reduced flashing, screen shake toggle.
9. Integer-scaled 320x180 rendering at 60 fps in current desktop Chrome, Firefox and Safari.

### 9.2 Later

1. Rhythm bonus (steady step intervals within +/-20% give x1.1 impulse).
2. Ghost runner replaying the player's PB.
3. Two-player hot-seat on one keyboard (A/D vs arrows).
4. More events: 110 m hurdles, long jump, 4x100 relay.
5. Gamepad support (alternating shoulder buttons) and touch (two on-screen pads).
6. Hero customisation (kit palette swaps).
7. Online leaderboard with replay-based validation.
8. Difficulty modes and an accessibility "assist" mode with separately tracked records.

## 10. Acceptance criteria

A tester verifies each item by playing in the browser.

### Flow and unlocks

- [ ] A fresh browser profile shows only Pip unlocked; tiers 2-7 show silhouettes and "???".
- [ ] Beating Pip unlocks Jess immediately, the results card says "JESS UNLOCKED!" and NEXT starts the Jess race.
- [ ] Losing to a rival leaves unlocks unchanged and RETRY restarts the same race from the countdown.
- [ ] Beating Zyx for the first time shows the Champion screen once; later wins do not.
- [ ] Reloading the page keeps unlocks, PBs, history and settings.

### Mash model

- [ ] Holding ArrowRight for 5 s after GO leaves the runner at 0 km/h.
- [ ] Pressing only ArrowRight repeatedly leaves the runner at 0 km/h after the first step decays, and the prompt shows fumble feedback.
- [ ] Alternating Left/Right moves the runner; alternating A and ArrowRight also works.
- [ ] Stopping mashing at full speed drops the speed meter to zero within about 3 s.
- [ ] Mashing as fast as possible never shows more than 45 km/h.
- [ ] A steady, comfortable alternation (about 8 per second) finishes in roughly 14-15 s; a tester mashing hard finishes in 10-13 s.

### Countdown and false start

- [ ] Countdown shows 3, 2, 1, GO! with low beeps and a high beep on GO.
- [ ] The "1" lasts a visibly variable time across attempts.
- [ ] Pressing Left during "2" shows FALSE START! and restarts the countdown.
- [ ] A second false start in the same race shows DISQUALIFIED, no time is recorded and the history entry reads DQ.
- [ ] Holding a key through the countdown is not a false start, but produces no speed until released and re-pressed.

### Opponents

- [ ] Pip visibly trips near halfway and waves near 80 m.
- [ ] UNIT-7 glows red past halfway and sparks and slows near 85-92 m.
- [ ] Zyx disappears and reappears further ahead twice per race.
- [ ] Rival finish times vary by no more than about +/-0.2 s from their target across 5 races (for example Pip 17.8-18.2).
- [ ] A headless test (CI) asserts each rival's mean finish over 1000 seeded races is within +/-0.05 s of its target.

### Timing and records

- [ ] The HUD timer starts at 00.00 on GO and stops at the player's finish.
- [ ] Results show both times in SS.hh, the margin, and win/lose consistent with the times.
- [ ] Beating a previous best shows NEW PB! and the map card and HUD show the new PB afterwards.
- [ ] A slower time does not overwrite the PB.
- [ ] The Records screen shows PB, target and last 3 results per rival, and the ladder total once all 7 have PBs.
- [ ] In DevTools, `localStorage.getItem("retroRunner.save.v1")` returns JSON matching section 4.3.
- [ ] Replacing that value with `not json` and reloading starts a fresh save without crashing, and `retroRunner.save.corrupt` holds the old string.
- [ ] History never exceeds 50 entries.

### Visuals

- [ ] At any window size, pixels are crisp squares with no blur and no uneven pixel widths; spare space is letterboxed.
- [ ] Sampling screenshots shows no colours outside the 42-colour palette (excluding the browser outside the canvas).
- [ ] All characters have 1 px dark outlines and light from the top-left.
- [ ] Run animation speeds up and slows down with the runner's speed.
- [ ] Each of the 7 rivals races in its own stadium theme; background layers scroll at visibly different speeds.
- [ ] Nothing flashes faster than 3 times per second; with reduced flashing on, flashbulbs and screen shake are gone.

### Controls and audio

- [ ] Arrow keys, Space and Backspace never scroll the page.
- [ ] Esc during a race pauses, the timer stops, and Resume continues without a time jump.
- [ ] Switching tabs during a race auto-pauses.
- [ ] M mutes and unmutes on every screen, and the setting survives a reload.
- [ ] Every SFX in section 7.2 is audible at its trigger.

## 11. Tunables (single source)

| Name | Value | Section |
|---|---|---|
| RACE_DISTANCE_M | 100 | 2.1 |
| PX_PER_M | 24 | 2.1 |
| RUNOUT_M | 20 | 1.4 |
| SIM_HZ | 120 | 2.1 |
| STEP_IMPULSE | 0.50 m/s | 2.3 |
| K_DRAG | 0.50 /s | 2.3 |
| V_MAX | 12.5 m/s | 2.3 |
| IDLE_GRACE | 0.25 s | 2.3 |
| IDLE_DECEL | 3.0 m/s^2 | 2.3 |
| MIN_STEP_INTERVAL | 35 ms | 2.2 |
| COUNT_STEP | 0.80 s | 2.5 |
| COUNT_ONE_JITTER | 0.00-0.50 s | 2.5 |
| GO_TEXT | 0.60 s | 2.5 |
| FALSE_STARTS_TO_DQ | 2 | 2.5 |
| DNF_LIMIT | 30.00 s | 1.4 |
| RESULTS_DELAY | 1.5 s | 1.4 |
| AI_VTOP_JITTER | +/-1% | 3.1 |
| AI_QUIRK_JITTER | +/-3 m | 3.1 |
| HISTORY_MAX | 50 | 4.2 |
| SAVE_KEY | `retroRunner.save.v1` | 4.3 |
| INTERNAL_RES | 320 x 180 | 5.1 |
| SPRITE_FRAME | 48 x 48 | 5.5 |
| PLAYER_SCREEN_X | 96 | 5.7 |
| MAX_FLASH_HZ | 3 (1 reduced) | 6.5 |
