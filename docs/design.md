# Retro Runner - Game Design Document

Status: v1 design, engine-agnostic, shipped; v2 expansion (three events, touch) specified in sections 12-22.
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
| 16-bit authenticity | 320x180 internal canvas, fixed 42-colour palette, 1 px dark outlines, nearest-neighbour scaling that fills the window at 16:9. |
| Short, replayable races | A race lasts 10-20 s. Retry is one key press away. **[v2]** 100 m and hurdles stay 10-25 s; the 400 m is the one long-form event at 50-75 s (section 14). |

## 1. Core loop and screen flow

### 1.1 Loop

1. Pick an unlocked rival on the Ladder Map.
2. Countdown, race 100 m, see the result card with times and PB.
3. Win to unlock the next rival, or retry instantly to beat your time.

### 1.2 Screens

| # | Screen | Shows | Inputs | Goes to |
|---|---|---|---|---|
| S1 | Boot / Title | Logo, "PRESS ENTER", version, mute icon. **[v2]** Event pictograms, `TAP TO START` on touch (18.8). | Enter/Space: continue. M: mute. | **[v2]** S10 (was S2) |
| S2 | Ladder Map | Vertical ladder of 7 rival nodes, bottom (Pip) to top (Zyx). Selected rival card: portrait, name, tier, target time, your PB. Menu row: RACE, RECORDS, OPTIONS. | Up/Down: move between rivals. Left/Right: move in menu row. Enter: confirm. Esc: back to Title. **[v2]** One ladder per event (18.3); Esc goes back to S10. | S3, S6, S7, **[v2]** S10 |
| S3 | Pre-race | Stadium for that tier, both runners walk to blocks (1.5 s), then crouch. Countdown 3-2-1-GO. | Left/Right only matter as false start detection. Esc: pause. | S4 |
| S4 | Race | Running, HUD (section 6). | Left/Right (or A/D): run. Esc: pause. | S5 |
| S5 | Results | Result card (section 6.6). | Enter: default button. Left/Right: choose button. R: retry. Esc: map. | S3 (retry), S3 next rival (next), S2 (map) |
| S6 | Records | Per-rival PB table and last results (section 4.5). **[v2]** Event tabs (18.7). | Up/Down: scroll. **[v2]** Left/Right: tab. Esc: back. | S2 **[v2]** or S10 |
| S7 | Options | Volume (0-10), mute, reduced flashing, screen shake on/off, reset records. | Up/Down, Left/Right, Enter, Esc. | S2 |
| S8 | Pause (overlay) | RESUME, RESTART, QUIT TO MAP. | Up/Down, Enter. Esc: resume. | S4, S3, S2 |
| S9 | Champion | Shown once after first win vs Zyx: celebration, ladder total time, credits scroll. **[v2]** Once per event (12.3). | Enter: skip. | S2 |
| S10 | **[v2]** Event Select | Three event cards, locks, progress, totals (18.2). Menu row: RECORDS, OPTIONS. | Left/Right, Up/Down, Enter, Esc. | S2, S6, S7, S1 |

### 1.3 Unlock rules

1. Tier 1 (Pip) is unlocked on a fresh save.
2. Winning against tier N unlocks tier N+1 immediately and moves the map cursor to it.
3. Unlocks are permanent. Losing never re-locks anything.
4. Every unlocked rival can be raced any number of times, and every completed race records a time.
5. Locked rivals show a black silhouette, "???" as name and "Beat <previous name> to unlock".
6. First win against Zyx (tier 7) sets `champion: true` and shows S9 once.
7. "Ladder total" = sum of PBs against all 7 rivals, shown only when all 7 have a PB.

**[v2]** Rules 1-7 apply per event, each event with its own ladder (section 15); events themselves unlock per 12.2.

### 1.4 Race end rules

1. The race clock starts at GO (t = 0) and runs on the simulation clock, not wall time.
2. The player's time is the interpolated instant their position crosses 100.000 m (section 2.6).
3. If the player finishes first, the opponent's remaining run is simulated instantly off-screen to get its exact time.
   The results card appears 1.5 s after the player crosses.
4. If the opponent finishes first, the race continues until the player crosses.
5. If the player has not finished by t = 30.00 s, the race ends as DNF: loss, no time recorded, no PB.
   **[v2]** The cap is per event: 30.00 s (100 m), 40.00 s (hurdles), 90.00 s (400 m); in rules 2 and 7, 100.000 m means the event distance (12.1).
6. Win if player ms < opponent ms.
   Equal ms is a dead heat and counts as a win, shown as "PHOTO FINISH".
7. Both runners keep running past the line into a 20 m run-out and decelerate (player: input ignored after crossing; AI: target speed 0 with its tau).

## 2. Mash-to-speed model

### 2.1 Units and world scale

| Quantity | Value |
|---|---|
| Race distance | 100 m. **[v2]** 110 m (hurdles) and 400 m (12.1). |
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
7. **[v2]** In the hurdles, a fresh jump press (Up, W or the JUMP touch control) inside the window is also a false start; touch presses in run or jump zones count like keydowns (17.3).

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
   **[v2]** Times of 60 s or more (400 m, ladder totals) display as `M:SS.hh` (14.4).
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

**[v2]** Superseded for the live save by section 16 (`retroRunner.save.v2`, per-event records); this v1 schema stays authoritative as the migration source.

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

**[v2]** Records gain event tabs, a hurdles HIT column and `M:SS.hh` totals (18.7, 16.5).

## 5. Art bible

### 5.1 Canvas and scaling

| Rule | Value |
|---|---|
| Internal resolution | 320 x 180 (16:9) |
| Scaling | The largest 16:9 size that fits the window, nearest-neighbour, snapped to whole device pixels (exact 4x at 1280x720, 6x at 1920x1080; fractional in between, where some game pixels are one device pixel wider). Bars in `#0b0b14` fill only the sides that do not match 16:9. Whole-number-only scaling was dropped because it left up to 40% of common windows empty. |
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

**[v2]** New character Sol, the `hurdle` anim for 8 characters, Rio's `tired` run, hurdle props and touch UI art are listed in section 19.

### 5.7 Background layers (side view, runners move left to right)

Camera: follows the player so that Rio's pivot is at screen x = 96, clamped so the start line is visible at the start and the camera stops 64 px after the finish line run-out begins.

| Layer | Screen rows (y) | Parallax factor | Content |
|---|---|---|---|
| L0 Sky | 0-48 | 0.00 | Gradient bands with 2x2 dither, per-tier colours. Static clouds or stars. |
| L1 Far | 24-64 | 0.10 | Stadium roof, skyline, floodlight towers. 256 px wide tile. |
| L2 Far stands | 48-92 | 0.30 | Crowd tile 128 px wide, 2-frame crowd bob at 4 fps, faster (8 fps) when a runner is within 10 m of the finish. |
| L3 Near stands | 88-104 | 0.60 | Advertising boards and wall, 64 px tiles with fictional brand-free signage. |
| L4 Track | 104-160 | 1.00 | Lane 1 (rival): feet at y = 128. Lane 2 (player): feet at y = 152. 1 px lane lines index 8 at y = 108, 132, 156. Start line, checkered finish line, distance boards every 10 m. **[v2]** Hurdles: 10 hurdles per lane (13.1). 400 m: boards every 50 m, 9600 px track (14.3). |
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

**[v2]** Per-event HUD changes (hurdle ticks, jump gauge, stamina meter, oval lap icon, 400 m timer width) and touch-mode positions are in 18.4 and 17.4.

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

**[v2]** The card grows to (52, 22, 216 x 136) with an event row and an event-unlock line (18.6).

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

**[v2]** New SFX and music in section 20; on touch, audio unlocks on the release of the first tap (17.6).

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
| Fullscreen toggle | F (any screen) | Corner button (shown while the mouse moves) |
| **[v2]** Jump (hurdles only) | ArrowUp | W |
| **[v2]** Touch | Run zones, JUMP zone, pause button, menu taps | Section 17 |

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
10. **[v2]** ArrowUp and W jump in the hurdles race (13.2) and stay menu keys elsewhere; they are not race inputs in the 100 m and 400 m.
11. **[v2]** Keyboard and touch can be mixed in one race; a side is held if any key or finger for it is down (17.3).
12. **[v2]** Options adds `HAPTICS` (Android only, 17.7).

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
4. More events: 110 m hurdles, long jump, 4x100 relay. **[v2]** Hurdles promoted to v2 scope, plus the 400 m (section 21).
5. Gamepad support (alternating shoulder buttons) and touch (two on-screen pads). **[v2]** Touch promoted to v2 scope (section 17); gamepad stays later.
6. Hero customisation (kit palette swaps).
7. Online leaderboard with replay-based validation.
8. Difficulty modes and an accessibility "assist" mode with separately tracked records.

## 10. Acceptance criteria

A tester verifies each item by playing in the browser.
**[v2]** The criteria below stay valid for the 100 m; v2 criteria are in section 22. With v2, "Reloading the page keeps unlocks" is checked against `retroRunner.save.v2`, and the `retroRunner.save.v1` check applies only to the v1 build.

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

- [ ] At any window size, the game fills the window at 16:9 with crisp, unblurred pixels; bars appear only on the two sides that do not match 16:9.
- [ ] F or the corner button toggles true fullscreen; the button fades out while the mouse is idle.
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

**[v2]** Expansion constants (sections 12-17).
Per-rival AI numbers (REACTION, TAU, V_TOP, pClip, landKeep, pace segments) live in the roster tables 15.3 and 15.4, like 3.2.

| Name | Value | Section |
|---|---|---|
| EVENT_IDS | `100m`, `110mh`, `400m` | 12.1 |
| DISTANCE_M | 100 / 110 / 400 | 12.1 |
| DNF_LIMIT (per event) | 30.00 / 40.00 / 90.00 s | 12.1 |
| UNLOCK_HURDLES | 100 m win vs `marco` | 12.2 |
| UNLOCK_400 | 100 m win vs `kofi` or hurdles win vs `marco` | 12.2 |
| HURDLE_COUNT | 10 | 13.1 |
| HURDLE_FIRST_M | 13.72 m | 13.1 |
| HURDLE_SPACING_M | 9.14 m | 13.1 |
| HURDLE_RUN_IN_M | 14.02 m | 13.1 |
| HURDLE_HEIGHT_M | 1.00 m (24 px) | 13.1 |
| JUMP_AIR | 0.40 s | 13.2 |
| JUMP_PEAK_M | 1.30 m (31 px) | 13.2 |
| JUMP_LOCK | 0.10 s | 13.2 |
| LAND_KEEP | 0.94 | 13.2 |
| CLIP_KEEP | 0.80 | 13.2 |
| HIT_KEEP | 0.40 | 13.2 |
| HIT_STUMBLE | 0.30 s | 13.2 |
| HIT_SHAKE | 2 px, 0.15 s | 13.2 |
| CLEAN_WINDOW | takeoff 0.296-0.104 s before the hurdle (derived) | 13.2 |
| AI_TAKEOFF_S (clean / clip) | 0.50 / 0.80 | 15.2 |
| AI_HIT_MULT | x0.30 for 0.30 s | 15.2 |
| LEAN_OFFSET_M | distance - 2 to distance + 2 | 13.4 |
| SUSTAIN_RATE | 7.0 alt/s | 14.1 |
| STEP_COST | 0.014 | 14.1 |
| REGEN | 0.098 /s (SUSTAIN_RATE x STEP_COST) | 14.1 |
| S_FATIGUE | 0.30 | 14.1 |
| V_TIRED | 6.0 m/s | 14.1 |
| FATIGUE_DECEL | 2.0 m/s^2 | 14.1 |
| SPLITS_M | 100, 200, 300 | 14.3 |
| SPLIT_POPUP | 2.0 s | 18.4 |
| BELL_AT_M | 300 | 14.3 |
| BOARD_STEP_400_M | 50 | 14.3 |
| CROWD_RISE_400_M | last 100 m | 14.3 |
| TIME_FORMAT_LONG_FROM | 60.00 s (`M:SS.hh`) | 14.4 |
| AI_QUIRK_JITTER_400 | +/-10 m | 15.4 |
| WARP_JUMP_M | 5 (100 m, hurdles) / 10 (400 m) | 15.2 |
| ZYX_PRESSURE (from, lead) | 100 m: 50 m, 1.5 m. Hurdles: 55 m, 1.5 m. 400 m: 200 m, 3.0 m | 15.3, 15.4 |
| SAVE_KEY_V2 | `retroRunner.save.v2` | 16.2 |
| HISTORY_MAX | 50 per event | 16.1 |
| PB_RANGE_MS | 5000-30000 / 8000-40000 / 40000-90000 | 16.3 |
| TOUCH_TOP_STRIP | 22% of viewport height | 17.2 |
| TOUCH_JUMP_SPLIT | 58% of viewport height | 17.2 |
| TOUCH_EDGE_MARGIN | 12 CSS px inside the safe-area inset | 17.2 |
| TOUCH_MIN_TARGET | 44 CSS px | 17.4 |
| TOUCH_BAR_PADS_MIN | 56 CSS px side bar | 17.4 |
| RUN_PAD | 64 x 48 game px | 17.4 |
| JUMP_PAD | 64 x 40 game px | 17.4 |
| MENU_TAP_MIN | 20 x 20 game px | 17.5 |
| HAPTIC_FUMBLE | 30 ms | 17.7 |
| HAPTIC_FALSE_START | 40, gap 60, 40 ms | 17.7 |
| HAPTIC_HIT | 40 ms | 17.7 |
| JUMP_GAUGE_SPAN | 1.0 s | 18.4 |
| STAMINA_LOW_SFX_EVERY | 0.6 s | 20.1 |
| QUARTER_FINAL_LAYER_AT_M | 300 | 20.2 |

---

# Part 2 - Expansion v2: three events and touch

Status: v2 design, approved scope, not yet built.
Sections 0-11 stay authoritative for the 100 m.
Where the expansion changes them, the change is marked inline with **[v2]** and points here.
Sections 12-22 below are the source of truth for everything new.
Starting values marked "prototype sim" come from a throwaway fixed-step simulation of the exact formulas in this document (120 Hz, same J, K_DRAG, V_MAX); mechanics must still tune them headless as in section 3.1.

## 12. Events and event unlocks

### 12.1 Event list

| Event id | Display name | Short name (tabs, 8 px) | Distance | New mechanic | DNF cap | Race length for a good human |
|---|---|---|---|---|---|---|
| `100m` | 100 METRES | `100M` | 100 m | - (sections 1-4) | 30.00 s | 11-13 s |
| `110mh` | 110 METRES HURDLES | `HURDLES` | 110 m | Jump input, 10 hurdles (section 13) | 40.00 s | 14-16 s |
| `400m` | 400 METRES | `400M` | 400 m | Stamina and pacing (section 14) | 90.00 s | 50-60 s |

Each event has its own 7-rival ladder (section 15), its own unlocked tier, beaten set, champion flag, PBs, history and ladder total (section 16).
The mash rules of section 2.2-2.3, the false start rules of 2.5 and the finish timing of 2.6 apply to every event unless section 13 or 14 says otherwise.
The finish crossing rule uses the event distance in place of 100 m.

### 12.2 Event unlock rules

| Event | Unlocked when | Locked card text |
|---|---|---|
| 100 m | Always (fresh save). | - |
| 110 m hurdles | First 100 m win against Marco (100 m tier 3). | `BEAT MARCO IN 100M` |
| 400 m | First 100 m win against Kofi (100 m tier 4), or first hurdles win against Marco (hurdles tier 3), whichever comes first. | `BEAT KOFI IN 100M` / `OR MARCO IN HURDLES` |

Justification:

1. The 100 m teaches the one skill every event shares: clean, fast alternation.
   Beating Marco proves a sustained ~8.6 alt/s, while the first two hurdles rivals ask for only 5.8 and 7.1 alt/s, so the only new thing the player must learn in hurdles is the jump.
2. The 400 m adds the hardest idea (pacing against a meter) and the longest race, so it comes second and later.
3. Two routes to the 400 m mean a player who struggles with jump timing, or with raw hand speed, is never blocked by one skill.
4. Unlocks are derived from the beaten sets (section 16.4), never stored separately, so they cannot disagree with the records and a migrated v1 save gets the right events immediately.
5. Expected time to first hurdles unlock for a new player: about 10-15 minutes of play (three 100 m wins plus retries).

Event unlocks are permanent, like rival unlocks.
When a win unlocks an event, the results card shows it (section 18.6) and plays `unlock`.
An event that is unlocked but whose ladder has never been opened shows a `NEW!` badge on the event select screen.

### 12.3 Champions

1. Each event has its own champion flag, set on the first win against that event's tier 7 rival (Zyx in all three).
2. S9 (Champion) is shown once per event, titled `100M CHAMPION`, `HURDLES CHAMPION` or `400M CHAMPION`, with that event's ladder total.
3. A migrated v1 save with `champion: true` never sees the 100 m S9 again.

## 13. Event: 110 m hurdles

### 13.1 Course

| Quantity | Value |
|---|---|
| Distance | 110 m (2640 px at 24 px/m) |
| Hurdles per lane | 10 |
| Start to first hurdle | 13.72 m |
| Between hurdles | 9.14 m |
| Last hurdle to finish (run-in) | 14.02 m |
| Hurdle positions (m) | 13.72, 22.86, 32.00, 41.14, 50.28, 59.42, 68.56, 77.70, 86.84, 95.98 |
| Hurdle bar height (game) | 1.00 m = 24 px above the lane's feet row (stylised; real 1.067 m) |
| Run-out | 20 m, no hurdles |
| Lanes | Rival lane 1, player lane 2, as in 5.7; each lane has its own 10 hurdles |

### 13.2 Jump model (sim terms)

State added to the player: `airT` (s since takeoff, or none when grounded), `lockT` (s left of post-landing or stumble lock).

| Rule | Value |
|---|---|
| Input | Fresh keydown of ArrowUp or W, or a touch press on the JUMP control (section 17). Auto-repeat ignored. |
| Accepted when | Phase `running`, player grounded, player not finished, `lockT = 0`. Otherwise silently ignored (no fumble). |
| Airtime | JUMP_AIR = 0.40 s, fixed, independent of speed. |
| Arc | Feet height `y(s) = 4 * JUMP_PEAK * s * (1 - s)` with `s = airT / JUMP_AIR` in [0, 1] and JUMP_PEAK = 1.30 m (31 px). |
| Speed in the air | Frozen: no drag, no idle braking, no impulse. |
| Steps in the air | Valid steps are classified by the normal step filter (they update `lastSide`, `lastStepTime` and reset the idle timer, so rhythm is not broken), but give zero impulse and spawn no dust. Fumbles in the air are still fumbles. |
| Landing | `v = v * LAND_KEEP`, LAND_KEEP = 0.94. Then `lockT = JUMP_LOCK` = 0.10 s before the next jump is accepted (running and stepping are allowed). |

Hurdle check, evaluated on the tick where the player's x passes a hurdle position `h` (`x_prev < h <= x_now`), with `s` interpolated to the crossing instant:

| Outcome | Condition | Effect | Event |
|---|---|---|---|
| CLEAN | Airborne and `y(s) >= 1.00 m`, which is `s` in [0.260, 0.740] | None (only the landing cost). | `hurdleClear` |
| CLIP | Airborne and `y(s) < 1.00 m` (jumped too late: still rising; or a bit too early: already falling) | `v = v * CLIP_KEEP` (0.80). Hurdle knocked over. Trail-leg flinch (1 frame, no anim break). | `hurdleClip` |
| HIT | Grounded (no jump, or jumped so early that the runner already landed) | `v = v * HIT_KEEP` (0.40). Stumble lock HIT_STUMBLE = 0.30 s: steps give no impulse, idle braking is off, drag applies, `stumble` anim plays. Hurdle knocked over. Screen shake 2 px for 0.15 s if enabled. | `hurdleHit` |

Takeoff timing window (follows from the arc because airtime is fixed and speed is frozen in the air):

| Takeoff time before reaching the hurdle | Result |
|---|---|
| more than 0.400 s | Lands before the hurdle, grounded at the hurdle: HIT (a re-jump after the 0.10 s lock can still save a CLIP) |
| 0.400 s to 0.296 s | CLIP (falling) |
| 0.296 s to 0.104 s | CLEAN (192 ms window, sweet spot 0.200 s) |
| less than 0.104 s | CLIP (rising) |
| no jump | HIT |

At 10 m/s the clean window is a takeoff between 2.96 m and 1.04 m before the hurdle.

No fall exists.
Reason: a fall would end or wreck the race on one mistimed press, and with retry and exact times as pillars a big, recoverable penalty is better than a race-ending one.
A HIT already costs about 1.3 s, which loses to every rival from tier 3 up.

Knocked hurdles are legal, as in real athletics, and only cost time.
The race records how many hurdles the player knocked (CLIP plus HIT), stored as `hit` (section 16).

### 13.3 Expected times (prototype sim)

All jumps CLEAN at the sweet spot, sustained rate r, same mash constants as 2.3:

| Sustained rate r (alt/s) | 110 m hurdles, all clean | Compare 100 m (2.4) |
|---|---|---|
| 6 | 21.52 s | 18.7 s |
| 7 | 18.94 s | 16.3 s |
| 8 | 17.02 s | 14.5 s |
| 9 | 15.67 s | 13.1 s |
| 10 | 14.47 s | 12.0 s |
| 11 | 13.62 s | 11.1 s |
| 12 | 12.87 s | 10.3 s |
| 12.5 or more | ~12.3 s floor | ~10.0 s |

Cost of one mistake at r = 10, measured against the clean run: CLIP +0.36 s, HIT +1.28 s.
Never jumping at r = 10 finishes in ~23.7 s; at r = 6 in ~32.4 s, inside the 40 s DNF cap.
A good human (9-11 alt/s) with 1-3 clips finishes in 14-16.5 s, the target feel.
Spamming jump is self-punishing: each landing costs 6% and air steps give nothing.

### 13.4 Other hurdles rules

1. False start: a fresh Up/W keydown or JUMP touch inside the countdown window is a false start, exactly like Left/Right (2.5).
   In the 100 m and 400 m, Up/W is not a race input and never a false start.
2. Lean anim: triggered at distance - 2 m, held to distance + 2 m (108-112 m).
3. Crowd intensity rises in the last 20 m, as in the 100 m.
4. First hurdles race ever (no hurdles history): the pre-race intro shows the tip `UP TO JUMP` (keyboard) or `TAP JUMP` (touch), and the jump gauge (18.3) shows the label `JUMP` for the first 3 hurdles.

## 14. Event: 400 m

### 14.1 Stamina model

State added to the player: `S`, stamina in [0, 1], shown as 0-100.
`S = 1` at GO.
Stamina is a budget of steps: each valid step costs a fixed amount, and stamina refills at a constant rate, so mashing faster than SUSTAIN_RATE drains it.

On each valid step (after the step filter accepts it, before the impulse):

```
S = max(0, S - STEP_COST)
vCap = (S >= S_FATIGUE) ? V_MAX : V_TIRED + (V_MAX - V_TIRED) * S / S_FATIGUE
if v < vCap: v = min(v + J, vCap)          // a step at or above the cap still costs stamina
```

Every simulation step (dt = 1/120 s), in this order after the steps:

```
S = min(1, S + REGEN * dt)                 // REGEN = SUSTAIN_RATE * STEP_COST
v = v - K_DRAG * v * dt
if v > vCap: v = max(vCap, v - FATIGUE_DECEL * dt)
if idleTime > IDLE_GRACE: v = max(0, v - IDLE_DECEL * dt)
x = x + v * dt
```

| Constant | Value | Meaning |
|---|---|---|
| SUSTAIN_RATE | 7.0 alt/s | Mashing at this rate neither drains nor refills. |
| STEP_COST | 0.014 per valid step | 1/0.014 = ~71 steps of budget above the sustainable rate. |
| REGEN | 0.098 /s | Continuous, also while stopped; frozen while paused and before GO. |
| S_FATIGUE | 0.30 | Below this, speed is capped. |
| V_TIRED | 6.0 m/s | Speed cap at S = 0 ("tying up"). |
| FATIGUE_DECEL | 2.0 m/s^2 | How fast speed falls to a falling cap (no snapping). |

Net drain at a steady rate r is `(r - 7.0) * 0.014` per second.
From full, stamina lasts 36 s at 9 alt/s, 24 s at 10 alt/s and 14 s at 12 alt/s.
Above S_FATIGUE the 100 m model is unchanged: speed still equals alternations per second.
At S = 0 a player who keeps mashing above 7 alt/s stays empty and is stuck near 6 m/s; easing off below 7 alt/s refills the meter and lifts the cap.

### 14.2 Expected times (prototype sim)

Even pace, sustained rate r from GO to the line:

| Pace | Finish | Split 100 / 200 / 300 m | Lowest stamina |
|---|---|---|---|
| Even 6.0 alt/s | 68.9 s | 18.7 / 35.4 / 52.1 | 99 |
| Even 7.0 | 59.3 s | 16.3 / 30.6 / 45.0 | 99 |
| Even 7.5 | 55.5 s | 15.3 / 28.7 / 42.1 | 60 |
| Even 8.0 | 52.2 s | 14.5 / 27.0 / 39.6 | 26 |
| Even 8.25 (optimum) | 50.6 s | 14.1 / 26.3 / 38.5 | 10 |
| Even 8.5 | 51.6 s | 13.8 / 25.6 / 37.4 | 0 |
| Even 9.0 | 54.1 s | 13.1 / 24.3 / 36.9 | 0 |
| Even 10.0 | 56.9 s | 12.0 / 22.7 / 39.7 | 0 |
| Flat out 12.0 | 59.6 s | 10.3 / 25.5 / 42.6 | 0 |
| 12.0 until S < 0.30, then 6.0 | 52.2 s | 10.3 / 23.5 / 37.8 | 28 |

The theoretical best is ~50.5 s.
A good human who paces (7.5-8.3 alt/s with a late kick) finishes in 51-56 s; one who sprints and dies finishes near 60 s; a beginner at 6 alt/s finishes near 69 s.
The best strategy is visible on the HUD: keep the speed meter near the sustain tick, keep stamina above 30 until ~300 m, then spend it.

### 14.3 Presentation

1. The side view stays.
   The 400 m is drawn as one 400 m straight (9600 px plus the 20 m run-out), because a curve cannot be shown in a side view without a new camera.
2. No stagger: both runners start on the same line and run exactly 400 m.
   Stagger only compensates for bends, which this view does not simulate.
3. The lap is shown on the HUD instead: a 32x16 oval lap icon (18.4) moves both runners around a track with the real layout (bend 0-100 m, back straight 100-200 m, bend 200-300 m, home straight 300-400 m).
4. Distance boards every 50 m (the 100 m uses 10 m), with large boards at 100, 200 and 300 m.
5. A lap-bell official prop stands in the L5 foreground at 300 m; the `bell` SFX rings when the player passes 300 m.
6. Splits: the race records the player's interpolated crossing times at 100, 200 and 300 m (rule 2.6), shown on the HUD for 2 s at each split and on the results card.
7. Crowd intensity rises over the last 100 m instead of the last 20 m.
8. Lean anim at 398-402 m.
9. First 400 m race ever: the intro shows the tip `WATCH STAMINA. STEADY BEATS FAST.`

### 14.4 Time display

Times of 60 s or more display as `M:SS.hh` (for example `1:04.37`), with the same round-up rule as 4.1.
Times under 60 s keep `SS.hh`.
This applies to the HUD timer, PBs, targets, results, records and ladder totals in every event (100 m times never reach it).

## 15. Rivals per event

### 15.1 Reuse rule and the new character

1. All 7 existing rivals keep their look, personality and quirk family in every event they appear in; only targets, AI numbers and quirk parameters change.
2. Hurdles uses the existing 7, in the same order, with no new character.
   Every existing quirk has a natural hurdles version (Pip hits hurdles, Jess fades, Marco clips, Kofi owns the run-in, Valentina never touches a hurdle, UNIT-7 has piston landings, Zyx warps through hurdles), and Valentina's zero-clip technique already plays the "specialist" role.
   Keeping familiar faces lets the ladder teach the jump without also teaching new rivals.
3. The 400 m adds exactly one new character, Sol, a veteran 400 m runner with metronome even pacing, at tier 5.
   The 400 m is about pacing, and no existing rival embodies good pacing; Sol is the rival who shows the player what an even split looks like, at the tier where stamina becomes decisive.
4. Valentina sits out the 400 m (flavour: a 100 m sprinter "who does not do laps").
5. Stadium themes stay per tier (5.8): the tier N rival of every event races in theme N, so Sol races in the Olympic sunset stadium.

### 15.2 AI model extensions (minimal)

The AI of 3.1 stays: exponential approach of `v` to `vTarget = V_TOP * multiplier`.
Extensions:

| Extension | Rule |
|---|---|
| Pace segments | A per-rival, per-event list of `(fromM, multiplier)` steps, applied like the existing distance quirks (Jess fade, Kofi kick are already this). Segment boundaries jitter by the event's AI_QUIRK_JITTER per race. |
| AI jump | Rivals use the player's jump physics (13.2): takeoff when `(h - x) / v <= TAKEOFF_S * JUMP_AIR`, airborne speed frozen, `v *= landKeep` on landing. A clean jump uses TAKEOFF_S = 0.50. |
| AI clip | Before each hurdle, a seeded draw with the rival's `pClip` decides a clip; a clipping rival takes off at TAKEOFF_S = 0.80, so the arc itself produces the CLIP (`v *= 0.80`, hurdle knocked). Scripted clips and hits per hurdle index override the draw. |
| AI hit | A scripted hit means no takeoff: HIT rules of 13.2 (`v *= 0.40`, then multiplier x0.30 for 0.30 s, `stumble` anim). |
| landKeep | Per rival, default LAND_KEEP 0.94. |
| Warp through | Zyx can replace a jump by a warp: vanish at `h - 2.5 m` for 0.25 s, reappear at `h + 2.5 m` with the same speed; the hurdle stays standing. |
| Warp distance | WARP_JUMP per event: 5 m (100 m, hurdles), 10 m (400 m). |
| Pressure | Zyx rule of 3.3 with per-event thresholds (lead and start distance). |
| No AI stamina | Rivals do not simulate stamina; their pace segments are their stamina story. |

Hurdle-indexed quirks never jitter; distance-based ones do.
Every V_TOP below is a starting value from the prototype sim of exactly these rules (mean over seeded clips, no V_TOP jitter).
Mechanics tunes V_TOP headless to the target within +/-0.05 s over 1000 seeded races, as in 3.1, with pressure excluded.

"Required rate" for hurdles is the sustained rate a player with all clean jumps needs to match the target (from 13.3).
"Required even pace" for the 400 m is the even rate that matches the target (from 14.2).

### 15.3 Roster: 110 m hurdles

| Tier | Id | Target | Required rate (clean) | REACTION | TAU | V_TOP (start) | pClip | landKeep |
|---|---|---|---|---|---|---|---|---|
| 1 | `pip` | 22.00 s | 5.8 alt/s | 0.30 s | 1.5 s | 6.66 m/s | 0.30 (scripted hits H3, H7) | 0.94 |
| 2 | `jess` | 18.60 s | 7.1 alt/s | 0.25 s | 1.2 s | 7.22 m/s | 0.15 | 0.94 |
| 3 | `marco` | 16.90 s | 8.3 alt/s | 0.22 s | 1.8 s | 8.75 m/s | 0.25 | 0.94 |
| 4 | `kofi` | 15.60 s | 9.1 alt/s | 0.18 s | 1.4 s | 8.66 m/s | 0.10 | 0.94 |
| 5 | `valentina` | 14.50 s | 9.8 alt/s | 0.14 s | 1.2 s | 8.95 m/s | 0.00 | 0.94 |
| 6 | `unit7` | 13.80 s | 10.5 alt/s | 0.10 s | 2.4 s | 10.40 m/s | 0.00 (scripted clip H9) | 1.00 |
| 7 | `zyx` | 13.30 s | 11.3 alt/s | 0.05 s | 1.0 s | 8.99 m/s | 0.00 (warps H4, H8) | 0.94 |

Hn means the n-th hurdle (H1 at 13.72 m).

| Id | Quirks in hurdles (multiplier on vTarget, or hurdle events) | Flavour (ladder card) |
|---|---|---|
| `pip` | Scripted HIT at H3 and H7 (stumble anim). Wave at 100 m (in the run-in): x0.85 for 1.0 s. Other hurdles: 30% clip. | `Hurdles are taller than Pip.` |
| `jess` | Fade from H6 (59.42 m): x0.90 to the line. Gum bubble on celebrate as before. | `Quick over the first five.` |
| `marco` | Coasts H3-H5 (32.00-50.28 m): x0.93, looks at the camera over H4. Lazy trail leg: 25% clip. | `Lazy trail leg. Clips a few.` |
| `kofi` | Run-in kick from 96 m (after H10): x1.08. | `Clean, steady, big run-in.` |
| `valentina` | Never clips. Kick from H8 (77.70 m): x1.03. Flashbulb pops at H10 (off with reduced flashing). | `Never touches a hurdle.` |
| `unit7` | Piston landings: landKeep 1.00. Overclock 50-85 m: x1.06 with red glow. Overheat 85-92 m: x0.80 with sparks, and a scripted CLIP at H9 (86.84 m). | `Piston legs. Lossless landings.` |
| `zyx` | Warps through H4 and H8 instead of jumping. Pressure: after 55 m, if the player leads by more than 1.5 m, x1.03 until the player no longer leads. | `Why jump when you can warp?` |

### 15.4 Roster: 400 m

| Tier | Id | Target | Required even pace | REACTION | TAU | V_TOP (start) |
|---|---|---|---|---|---|---|
| 1 | `pip` | 1:12.00 (72.00 s) | 5.7 alt/s | 0.30 s | 1.5 s | 6.56 m/s |
| 2 | `jess` | 1:04.00 (64.00 s) | 6.5 alt/s | 0.25 s | 1.2 s | 6.52 m/s |
| 3 | `marco` | 59.00 s | 7.0 alt/s | 0.22 s | 1.8 s | 7.13 m/s |
| 4 | `kofi` | 56.00 s | 7.4 alt/s | 0.18 s | 1.4 s | 7.37 m/s |
| 5 | `sol` (new) | 54.00 s | 7.7 alt/s | 0.15 s | 1.6 s | 7.65 m/s |
| 6 | `unit7` | 52.50 s | 7.9 alt/s | 0.10 s | 2.4 s | 8.00 m/s |
| 7 | `zyx` | 51.40 s | 8.1 alt/s | 0.05 s | 1.0 s | 7.79 m/s |

Zyx's 51.40 s sits ~0.9 s above the theoretical best (~50.5 s), the same kind of margin as his 100 m target over the 10.0 s floor.

Default 400 m pace profile (used where a rival row says "default"): x1.00 from 0 m, x0.97 from 200 m, x0.94 from 300 m.

| Id | Pace segments (fromM: multiplier) and quirks | Flavour (ladder card) |
|---|---|---|
| `pip` | 0: x1.40 (kid sprint), 60: x0.80 (gassed, sweat overlay from 60 m). Wave at 380 m: x0.85 for 1.0 s. | `Sprints 60 m. Then not.` |
| `jess` | 0: x1.12, 150: x1.00, 250: x0.85 (out fast, pays for it). | `Out fast. Pays for it.` |
| `marco` | 0: x1.00, 150: x0.92 (coasts the back straight, looks at the camera), 250: x0.98, 320: x1.06 (suddenly cares). | `Coasts the back straight.` |
| `kofi` | 0: x1.00, 200: x0.97, 320: x1.04 (late kick). | `Even pace. Strong last 100.` |
| `sol` | Flat x1.00 the whole race (even splits). Glances at his watch at 100, 200 and 300 m (overlay only, no speed effect). | `Even splits. Every lap.` |
| `unit7` | 0: x1.00, 100: x1.08 (overclock, red glow), 250: x1.00, 300: x0.75 (overheat, sparks), 330: x0.95. Long TAU boot-up as in 100 m. | `Overclocks. Overheats.` |
| `zyx` | Default profile. Warps at 150 m and 330 m (10 m each). Pressure: after 200 m, if the player leads by more than 3.0 m, x1.03 until the player no longer leads. | `Bends the bend.` |

AI_QUIRK_JITTER for 400 m segment boundaries and warp points: +/-10 m.

### 15.5 New character: Sol

| Field | Value |
|---|---|
| Id | `sol` |
| Name | `SOL` |
| Who | Veteran 400 m runner |
| Events | 400 m only (tier 5) |
| Look | Tall and lean, ~42 px in the 48x48 frame. Orange and white kit (ramp indices 20-21 with 8), yellow sun emblem on the chest (22), dark hair with grey streaks (14 with 7), skin ramp 9-11, a silver wristwatch on the left wrist (5 and 8), calm half-closed eyes. |
| Personality | Unhurried metronome. Never reacts to the player. Nods once on celebrate. |
| Extra anim | Watch glance (upper body overlay), 2 frames at 6 fps, held 0.5 s. |
| Portrait | 16x16 and 48x48 like the others. |

### 15.6 Ladder summary

| Tier | 100 m | 110 m hurdles | 400 m |
|---|---|---|---|
| 1 | Pip 18.00 | Pip 22.00 | Pip 1:12.00 |
| 2 | Jess 15.00 | Jess 18.60 | Jess 1:04.00 |
| 3 | Marco 13.60 | Marco 16.90 | Marco 59.00 |
| 4 | Kofi 12.60 | Kofi 15.60 | Kofi 56.00 |
| 5 | Valentina 11.60 | Valentina 14.50 | Sol 54.00 |
| 6 | UNIT-7 11.00 | UNIT-7 13.80 | UNIT-7 52.50 |
| 7 | Zyx 10.40 | Zyx 13.30 | Zyx 51.40 |

## 16. Records v2

### 16.1 What changes from v1

| Data | v1 (4.2) | v2 |
|---|---|---|
| Unlocks, beaten, champion | Global | Per event |
| Personal bests | Per rival | Per event and rival |
| History | 50 entries, all races | 50 entries per event |
| History extras | - | `hit` (hurdles), `splits` (400 m) |
| Settings | volume, muted, reducedFlashing, screenShake (code also has `crt`, see note) | Same plus `crt` and `haptics` |
| UI flags | - | `lastEvent`, `seenEvents`, `hints` |

Note on drift: the shipped code already stores `settings.crt` (CRT post-effect, research 3) although 4.3 never listed it; v2 lists it explicitly.

### 16.2 Storage schema

Key: `retroRunner.save.v2` (SAVE_KEY_V2).
Value: one JSON document.

```json
{
  "version": 2,
  "lastEvent": "110mh",
  "seenEvents": ["100m", "110mh"],
  "hints": { "addToHomeScreen": false },
  "settings": {
    "volume": 8, "muted": false, "reducedFlashing": false,
    "screenShake": true, "crt": false, "haptics": true
  },
  "events": {
    "100m": {
      "unlockedTier": 5,
      "beaten": ["pip", "jess", "marco", "kofi"],
      "champion": false,
      "best": { "pip": { "ms": 12840, "at": "2026-10-26T20:15:03.120Z" } },
      "history": [
        { "opp": "kofi", "result": "win", "ms": 12410, "oppMs": 12620,
          "falseStarts": 0, "seed": 1849302231, "at": "2026-10-27T18:02:11.004Z" }
      ]
    },
    "110mh": {
      "unlockedTier": 2,
      "beaten": ["pip"],
      "champion": false,
      "best": { "pip": { "ms": 17920, "at": "2026-10-27T18:10:40.300Z" } },
      "history": [
        { "opp": "pip", "result": "win", "ms": 17920, "oppMs": 22140,
          "falseStarts": 0, "seed": 99120, "at": "2026-10-27T18:10:40.300Z", "hit": 2 }
      ]
    },
    "400m": {
      "unlockedTier": 1, "beaten": [], "champion": false, "best": {},
      "history": [
        { "opp": "pip", "result": "lose", "ms": 74530, "oppMs": 71980,
          "falseStarts": 0, "seed": 7, "at": "2026-10-27T18:20:00.000Z",
          "splits": [15120, 33800, 53410] }
      ]
    }
  }
}
```

### 16.3 Validation (on load)

| Field | Rule (invalid entries are dropped, invalid scalars fall back to defaults, as v1) |
|---|---|
| `version` | Integer 2, else the document is corrupt. |
| `events` | Object; each of `100m`, `110mh`, `400m` present after repair (missing event becomes a fresh one). Unknown event keys are dropped. |
| `events.<e>.beaten` | Rival ids of that event's ladder, unique, in ladder order. |
| `events.<e>.unlockedTier` | Integer 1-7, raised to at least (highest beaten tier + 1), capped at 7. |
| `events.<e>.champion` | Boolean, forced false unless `beaten` contains the tier 7 rival. |
| `events.<e>.best.<id>.ms` | Integer in the event's PB range: 100 m 5000-30000, hurdles 8000-40000, 400 m 40000-90000. `<id>` must be on that event's ladder. |
| `events.<e>.best.<id>.at` | ISO 8601 UTC. |
| `history[]` common fields | As v1 (4.3), with `ms` and `oppMs` in 0 to the event's DNF cap (`oppMs` up to 600000 as v1). At most 50 per event. |
| `history[].hit` | Hurdles only: integer 0-10, required (missing or invalid drops the entry). Absent in other events. |
| `history[].splits` | 400 m only: array of 0-3 integers, strictly increasing, each in 0-90000 and below `ms` when `ms` exists. A DNF or DQ entry stores the splits it reached (DQ: empty). Absent in other events. |
| `settings.*` | As v1, plus `crt` boolean (default false) and `haptics` boolean (default true). |
| `lastEvent` | An event id that is unlocked, else `100m`. |
| `seenEvents` | Array of event ids, unique; always contains `100m`. |
| `hints.addToHomeScreen` | Boolean, default false (true = the hint was dismissed). |

Event unlocks are never stored; they are derived from `events.100m.beaten` and `events.110mh.beaten` on every load (12.2).

### 16.4 Load and migration

Load order:

1. If `retroRunner.save.v2` exists and validates: use it. The v1 key is ignored.
2. If `retroRunner.save.v2` exists but fails JSON parse or `version !== 2`: copy the raw string to `retroRunner.save.corrupt`, then continue with step 3.
3. If `retroRunner.save.v1` exists and passes the v1 rules (4.3, including v1's field repair): migrate it (below), write v2 immediately.
4. If v1 exists but is corrupt: copy it to `retroRunner.save.corrupt` (v1 rule) and start a fresh v2.
5. Otherwise: fresh v2.

Migration v1 to v2:

| v2 field | Value |
|---|---|
| `events.100m.unlockedTier`, `beaten`, `champion`, `best`, `history` | Copied from v1 unchanged (v1 history entries are all 100 m). |
| `events.110mh`, `events.400m` | Fresh: tier 1, nothing beaten, no PBs, empty history. |
| `settings` | v1 settings, plus `crt` (from v1 if present, else false) and `haptics: true`. |
| `lastEvent` | `100m`. |
| `seenEvents` | `["100m"]`, so events unlocked by the migration show `NEW!`. |
| `hints` | `{ "addToHomeScreen": false }`. |

Rules:

1. The v1 key is never written or deleted by migration; it stays as a read-only backup.
2. Migration runs once: after the first successful v2 write, step 1 always wins.
3. Known limitation: progress made in an old cached v1 build after migration is not merged.
4. If the v2 write fails (private mode, quota), the migrated document lives in memory and the v1 rule 4.3.3 message is shown; the next load migrates again from v1, which loses nothing.
5. "Reset records" (Options) removes both `retroRunner.save.v2` and `retroRunner.save.v1`, keeps settings and hint flags (as the shipped code already keeps settings), and starts a fresh v2.
6. Save is written after every race result, every settings change, every `seenEvents` or `hints` change and every `lastEvent` change.

### 16.5 PB, history and totals per event

1. PB rule of 4.2 per event and rival: lowest completed-race ms, DQ and DNF never count.
   A hurdles time with knocked hurdles is a valid PB.
2. Ladder total per event: sum of the 7 PBs of that event, shown only when all 7 exist.
   Totals use the 14.4 format, so every total (70-420 s) displays as `M:SS.hh`, for example `1:24.10` (100 m) or `6:31.62` (400 m).
   **[v2]** This replaces the `SSS.hh` total format of 4.5.
3. History is per event, newest first, 50 per event.

## 17. Touch controls (phones and tablets)

Tech decisions come from `docs/research-mobile.md`: run, jump and pause controls are a DOM overlay driven by Pointer Events, menus are canvas taps mapped to game pixels, controls may use the letterbox bars and must respect `env(safe-area-inset-*)`.
This section owns the geometry, the rules and the copy.

### 17.1 Decisions on the three open research questions

| Question | Decision | Why |
|---|---|---|
| 1. Screen halves or pads in the letterbox bars? | Screen halves are the hit zones; the visible pad graphics sit in the side bars when the bars are wide enough, otherwise over the bottom corners of the canvas. | Bars vary from 0 (16:9 tablets, and 4:3 iPads where bars are top and bottom) to ~111 CSS px (Pixel 7 tab), so bar-only pads would be tiny or missing on some devices. Halves give every device the largest possible target, and the bars become the natural thumb rest wherever they exist. |
| 2. Two fingers on the same side: held? | Yes. The core held-side rule applies unchanged: while any finger is down on a side, another finger landing on that side gives nothing (no step, no fumble). | Otherwise two fingers of one hand could drum one side (index, middle, index...) and replace alternation, breaking the "honest mashing" pillar. It also matches the keyboard rule (A and ArrowLeft are one side). |
| 3. Tap to start, Add to Home Screen hint, haptics default | Title shows `TAP TO START` on touch; the tap unlocks audio and, on Android, enters fullscreen and locks landscape. One-time Add to Home Screen hint on iPhone Safari tabs only. Haptics default ON, Android only, three pulses (17.7). | One gesture does every activation-gated thing at once; the hint is shown once because it cannot be acted on in-game; haptics are opt-out because they are rare (never per step) and only where supported. |

### 17.2 Zones (race screen)

All zones are in screen space (CSS px of the viewport), so they include the letterbox bars.
Game-px equivalents below assume the canvas fills the screen with no bars (the worst case, for example a 16:9 tablet).

| Zone | Screen region | Game px with no bars | Event |
|---|---|---|---|
| Top strip | Top 22% of the viewport height | y 0-39 | All: no run input; only PAUSE is active. |
| LEFT run | Left half below the top strip, starting 12 CSS px inside the left safe-area inset | x 0-159, y 40-179 | All |
| RIGHT run (100 m, 400 m) | Right half below the top strip, ending 12 CSS px inside the right safe-area inset | x 160-319, y 40-179 | 100 m, 400 m |
| RIGHT run (hurdles) | Right half, lower part: from 58% of viewport height to the bottom | x 160-319, y 105-179 | Hurdles |
| JUMP (hurdles) | Right half, upper part: from 22% to 58% of viewport height | x 160-319, y 40-104 | Hurdles |
| PAUSE | Button at the top right, inside the safe area | visual 16x16 at (300, 18), hit at least 44x44 CSS px | All |

Jump sits above the right run zone so the right thumb reaches it with a short upward move, on phones and tablets alike, and the left thumb never has to cross the screen.
A mirrored layout (jump on the left) is "later" (21.2).

Edge rule: the 12 CSS px edge margin keeps zones off the Android back-gesture strips; the bottom 21 CSS px home-indicator inset on iPhone is excluded from all zones.

### 17.3 Step rules on touch (identical to keys)

1. A finger landing in a run zone is a fresh keydown of that side (`repeat: false`); lifting, cancel or capture loss is the keyup (only when the side has no fingers left).
2. A finger belongs to the zone where it landed until it lifts; sliding into another zone never steps (pointer capture).
3. All of 2.2 applies: alternation, held side (17.1 question 2), 35 ms minimum, fumbles on a same-side press.
4. Keyboard and touch may be mixed in one race; a side is held if any key or finger for it is down.
5. A finger landing in LEFT, RIGHT or JUMP during the countdown window is a false start (2.5); taps in the top strip are not.
6. A touch on the JUMP zone is a jump press under 13.2; in the 100 m and 400 m there is no JUMP zone.
7. Window blur, tab hidden and turning to portrait release every finger and auto-pause (8.5).

### 17.4 Visuals and sizes

All touch art follows sections 5.2-5.4: palette only, 1 px outlines, no semi-transparency, so pads are hollow outlines that never hide the race.
Sizes are in game px and scale with the canvas (`--gp`), with a floor of 44 CSS px for any tappable control.

| Element | Size (game px) | States |
|---|---|---|
| Run pad (L, R) | 64 x 48 | `idle`: 2 px border index 6, arrow glyph index 6. `expected` (next side, per 6.4): border index 22, glyph index 8. `pressed`: border index 22, glyph moved 1 px down, inner 1 px ring index 22. `held-blocked` (a second finger on a held side): border index 5 for 4 frames. `fumble`: glyph index 17, pad shakes 2 px for 4 frames. |
| Jump pad | 64 x 40 | `idle` index 6, `ready` (the next hurdle is within 1.0 s) border index 22, `pressed` as run pad. Label `JUMP` in 8 px. |
| Pause button | 16 x 16 icon, hit >= 44 CSS px | Two bars index 8 on panel index 2; pressed: 1 px down. |

Pad placement:

| Situation | LEFT pad | RIGHT pad | JUMP pad |
|---|---|---|---|
| Side bars at least 56 CSS px wide (most phones) | Centred in the left bar, bottom aligned 8 CSS px above the bottom safe inset, scaled to the bar width minus 8 CSS px | Same in the right bar | In the right bar, above the RIGHT pad with an 8 CSS px gap |
| Narrower or no side bars (tablets) | Over the canvas at game (6, 118) | At game (250, 118) | At game (250, 62) |

When pads are over the canvas, the speed meter moves to (118, 166) and the stamina meter to (118, 152), and the key prompt is hidden (the pads replace it in all layouts).

Feedback timing: the pressed state toggles in the same pointer handler, so it shows on the next frame regardless of the game loop.
The 6.4 prompt rules (both bright before the first step, `MASH!` after 0.5 s idle, reduced flashing keeps both bright) apply to the pads, with `MASH!` drawn above the pads' midpoint at game y 100.

### 17.5 Menus by tap

1. Every menu item, ladder node, event card, tab and button registers a tap rectangle in game px.
2. Minimum tap rectangle: 20 x 20 game px, padded outward where space allows to reach 44 CSS px; neighbouring rectangles never overlap.
3. List items (event cards, ladder nodes, records tabs): first tap selects (plays `menu_move`), a tap on the already selected item confirms (plays `menu_select`).
4. Buttons (RACE, RETRY, NEXT, MAP, RESUME, option toggles): one tap confirms.
5. Options: volume uses `-` and `+` buttons (20 x 20 each) beside the value.
6. In touch mode every screen that uses Esc to go back shows a `BACK` item as the first entry of its bottom menu row (S2, S6, S7, S10), or the RESULTS `MAP` button where it already exists.
7. The speaker icon on the Title screen is tappable (mute toggle, replacing M).

### 17.6 Title, rotate prompt and Add to Home Screen

| Element | Rule |
|---|---|
| Title prompt | `PRESS ENTER` with keyboard modality, `TAP TO START` with touch modality, same position and blink. |
| Tap to start | The first tap (on release) unlocks audio; on Android Chrome it also requests fullscreen and locks landscape; then continues to S10. |
| Rotate prompt | In portrait on a touch device: full-screen overlay, fill index 2, 32x32 phone icon rotating 90 degrees (4 frames at 4 fps, static with reduced flashing), text `ROTATE YOUR DEVICE` in index 8. A race auto-pauses; on return to landscape the pause overlay is shown (no auto-resume). |
| Add to Home Screen hint | Only on iPhone Safari tabs (coarse pointer, no Fullscreen API, not standalone), shown once on the Title after the first tap: panel 200 x 64 at (60, 100), text `FOR FULL SCREEN:` / `SHARE > ADD TO HOME SCREEN`, button `OK`. Dismissing sets `hints.addToHomeScreen = true`; never shown again, never shown in standalone mode. |
| Fullscreen | On Android the corner fullscreen button of 8 is replaced by the tap-to-start gesture; on iPad the existing fullscreen button appears as a 44 CSS px DOM button in the top-left safe area while on the Title and Options screens. |

### 17.7 Haptics

| Trigger | Pulse |
|---|---|
| Fumble | 30 ms |
| False start | 40 ms, 60 ms gap, 40 ms |
| Hurdle HIT | 40 ms |

Never per step.
Setting `HAPTICS ON/OFF` in Options, default ON, listed only where `navigator.vibrate` exists (Android Chrome); iOS shows no haptics row.

### 17.8 Modality

1. Start in touch modality when `(pointer: coarse)` matches, else keyboard.
2. Any touch or pen press switches to touch modality; any run, jump or menu keydown switches to keyboard.
3. Switching never drops a held finger mid-race; overlay listeners stay attached until every finger lifts.
4. Key-named copy follows the modality: `UP TO JUMP` / `TAP JUMP`, `PRESS ENTER` / `TAP TO START`, `R: RETRY` hidden on touch.

## 18. UI and HUD additions

### 18.1 Screen flow v2

New screen S10 Event Select sits between Title and Ladder Map (see the 1.2 change).

| From | Input | To |
|---|---|---|
| S1 Title | Enter / tap | S10 |
| S10 | Card confirm (unlocked) | S2 for that event |
| S10 | RECORDS / OPTIONS | S6 (on that event's tab) / S7 |
| S10 | Esc / BACK | S1 |
| S2 | Esc / BACK | S10 |
| S5 | MAP | S2 of the same event |
| S9 | Enter | S2 of the same event |

### 18.2 Event select (S10)

| Element | Position (x, y, w x h) | Content |
|---|---|---|
| Heading | centred at y 6, 2x font | `SELECT EVENT` |
| Event cards | (8, 30), (112, 30), (216, 30), each 96 x 120 | 32x32 pictogram at card (32, 8); event name (8 px, two lines for `110M` / `HURDLES`); trophy icon plus `3/7` beaten; crown icon if champion; `TOTAL` plus the ladder total or `--`; `NEW!` badge (index 22, top-right corner of the card) for unlocked, unseen events. |
| Locked card | same | Pictogram as black silhouette, lock icon, unlock text from 12.2 in Kenney Pixel, index 6. Selecting it plays `menu_back` and shakes the card 2 px. |
| Menu row | y 160 | `RECORDS`, `OPTIONS` (touch: `BACK` first). |
| Background | full | Stadium of the highest unlocked 100 m tier, scrolled slowly (8 px/s), with the cards on index 2 panels. |
| Input | - | Left/Right between cards, Up/Down between cards row and menu row, Enter confirm, Esc back. Cursor starts on `lastEvent`. |

### 18.3 Ladder map per event (S2)

1. Same layout as 6.7, with that event's 7 rivals and its PBs and targets.
2. Event name at (136, 4) in 8 px, for example `110M HURDLES`.
3. Rival card shows that event's target, PB and flavour line (15.3, 15.4); times use 14.4.
4. Opening an event's S2 adds it to `seenEvents` and sets `lastEvent`.

### 18.4 Race HUD by event

Unchanged from 6.2 unless listed.

| Element | 100 m | 110 m hurdles | 400 m |
|---|---|---|---|
| Timer | 6.2 | 6.2 | Centred on x 160, up to 7 glyphs at 2x (`1:04.37`, 112 px wide, x 104-215) |
| Progress bar | 240 px = 100 m | 240 px = 110 m; 10 hurdle ticks (2x3 px, index 8) above the bar, turning index 17 when the player knocked that hurdle | 240 px = 400 m; ticks at 100, 200, 300 m |
| Oval lap icon | - | - | 32 x 16 at (4, 22): oval outline index 6, home straight on the bottom, rival dot 2x2 index 8 and player dot 2x2 index 18 placed by distance (bend 0-100, back 100-200, bend 200-300, home 300-400) |
| Key prompt (keyboard) | 6.2 | Three icons: Left (120, 160), Up (152, 160), Right (184, 160) | 6.2 |
| Jump gauge | - | 80 x 6 at (120, 150) keyboard, 56 x 6 at (118, 140) touch with pads over the canvas, or above the JUMP pad in the bar: frame index 1, track index 2; a 2x6 px hurdle pip index 8 moves from the right end (next hurdle 1.0 s away at current speed) to the left end (0 s); the clean window (0.296-0.104 s) is a fixed index 26 zone. Hidden when v < 1 m/s or after H10. `JUMP` label above it for the first 3 hurdles of the first hurdles race. |
| Up icon / JUMP pad state | - | Dim until the next hurdle is within 1.0 s, then bright (no flashing). | - |
| Speed meter | 6.2 | 6.2 | 6.2 plus a 1 px index 8 tick above the meter at the SUSTAIN_RATE speed (7.0 m/s, x offset round(7.0 / 12.5 * 60) = 34 px into the segments) |
| Stamina meter | - | - | (228, 164, 84 x 12) keyboard, (118, 152, 84 x 12) touch over canvas: label `STA`, bar 56 x 8 with 1 px index 1 outline; fill index 26 above 60, index 22 from 30 to 60, index 18 below 30; a 1 px index 8 tick at 30 (S_FATIGUE); a 5x3 arrow above the bar's right end, down when net draining, up when refilling. Below 30 the label alternates index 18 / index 8 at 1 Hz (steady index 18 with reduced flashing). |
| Split popup | - | - | At each split, `200M 26.10` at (160, 44) in 8 px for 2.0 s. |
| Clip / hit popup | - | `CLIP` (index 22) or `HIT!` (index 17) in 8 px above the player for 0.5 s | - |

### 18.5 Pre-race and pause

1. Pre-race tips (13.4, 14.3) appear during the 1.5 s intro walk at (160, 60) in 8 px, first race of the event only.
2. The pause overlay (S8) is unchanged; on touch, items are tap targets (17.5) and the pause button opens it.

### 18.6 Results card v2

Panel grows to (52, 22, 216 x 136) in every event so the layout is shared.

| Row | y offset | Content |
|---|---|---|
| Title | 8 | As 6.6 |
| Player | 30 | As 6.6, times per 14.4 |
| Rival | 44 | As 6.6 |
| Margin | 58 | As 6.6 |
| Event row | 72 | Hurdles: `CLEAN RACE!` (index 22) or `HURDLES HIT 2/10` (index 8). 400 m: `100 13.92  200 26.10  300 38.25` in Kenney Pixel (cumulative splits; `--` for splits not reached). 100 m: empty. |
| PB | 86 | As 6.6 |
| Unlock | 100 | `<NEXT NAME> UNLOCKED!` as 6.6; if the win also unlocks an event, a second line at 110 in Kenney Pixel: `NEW EVENT: 110M HURDLES` (index 22). |
| Buttons | 120 | As 6.6 (touch: tap targets). |

### 18.7 Records screen v2 (S6)

1. Tab strip at y 4: three tabs `100M`, `HURDLES`, `400M`, 64 x 14 each at x 32, 128, 224; selected tab index 22 text on index 2 with an index 8 border, others index 6.
2. Left/Right switches tabs (Up/Down still scrolls rows); taps select tabs on touch.
3. Table as 4.5 for the selected event, 7 rows of 16 px starting at y 24, with times per 14.4.
4. Hurdles adds a `HIT` column after `PB`: knocked hurdles in the PB race (stored with the PB, see note).
5. 400 m `Last 3` shows finish times; selecting a row with Enter (or tapping it) shows that rival's best race splits in a one-line footer.
6. Footer: `LADDER TOTAL` for the selected event or `BEAT ALL 7 TO SET A LADDER TOTAL`.
7. A locked event's tab shows the lock icon and the unlock text from 12.2 instead of the table.

Note: to support items 4 and 5, `best.<id>` in hurdles also stores `hit` (0-10) and in the 400 m `splits` (3 integers); validation as 16.3; migrated and old entries without them show `-`.

### 18.8 Title screen v2

1. Three 16x16 event pictograms under the logo at y 120, unlocked in colour, locked as silhouettes.
2. Prompt per 17.8 (`PRESS ENTER` / `TAP TO START`).
3. Continues to S10.

## 19. Art list v2

All items follow sections 5.1-5.6 (palette, outlines, shading, 48x48 frames, pivot at (24, 47)).

### 19.1 Characters

| Item | Who | Frames | FPS | Notes |
|---|---|---|---|---|
| `hurdle` anim | Rio, Pip, Jess, Marco, Kofi, Valentina, UNIT-7, Zyx (8) | 4 each = 32 | Driven by arc phase: frame = floor(4 * s) | 1 takeoff, 2 lead leg over (peak), 3 trail leg snap, 4 landing. UNIT-7 shows pistons extended on frame 4. The sprite is raised by `round(y(s) * 24)` px (peak 31 px). |
| `tired` run | Rio only | 8 | Same rule as `run` | Used when S < S_FATIGUE: head tilted back, shoulders 1 px higher, arms lower. |
| Full set | Sol (new) | 35 | as 5.6 | idle, walk, ready, run, lean, celebrate (nod), lose, stumble. |
| Watch glance overlay | Sol | 2 | 6 | Upper body, held 0.5 s. |
| Portraits | Sol | 16x16 and 48x48 plus locked silhouettes | - | As 5.5. |
| Ground shadow in the air | All | - | - | Stays on the ground row and shrinks from 20x3 to 14x2 at the peak (solid index 38). |

New character frames: 32 + 8 + 35 + 2 = 77.

### 19.2 Props and effects

| Item | Size | Frames | Notes |
|---|---|---|---|
| Hurdle | 16 x 28 (pivot bottom-centre) | 1 standing, 4 knock (16 fps), last knock frame = lying | Drawn in a slight oblique so the bar reads: white and black striped bar (indices 8 and 1) 12 px wide, top edge exactly 24 px above the feet row; metal legs and L-shaped base (4-6). Drawn behind runners of the same or nearer lane. |
| Hurdle stacks (L5) | existing | - | Already in 5.7; used more often in the hurdles event. |
| 50 m distance boards | 16 x 12 | 1 | 400 m only; `50`, `150`, ... |
| Large split boards | 24 x 16 | 1 | `100`, `200`, `300`. |
| Lap-bell official | 32 x 32 | 2 (ringing, 6 fps, only while `bell` plays) | L5 foreground at 300 m, 400 m only. |
| Clip burst | 16 x 16 | 4 at 16 fps | Small splinter and dust burst at the hurdle bar. |
| Sweat drop | existing 16 x 16 effect | - | Spawned every 0.5 s above Rio when S < S_FATIGUE and above Pip after his 400 m gas-out. |

### 19.3 UI

| Item | Size | Frames / states |
|---|---|---|
| Event pictograms | 32 x 32 and 16 x 16, each for `100m` (sprinter), `110mh` (runner over a hurdle), `400m` (runner with a stopwatch) | colour plus silhouette |
| Up-arrow key icon | 16 x 16 | dim, bright, wrong (like 6.4 keys) |
| Jump gauge | 80 x 6 and 56 x 6 frames, 2x6 pip | - |
| Stamina bar parts | 84 x 12 frame, 5x3 arrows (up, down) | - |
| Oval lap icon | 32 x 16, 2x2 dots | - |
| Touch run pads | 64 x 48, L and R | idle, expected, pressed, held-blocked, fumble |
| Touch jump pad | 64 x 40 | idle, ready, pressed |
| Pause button | 16 x 16 | idle, pressed |
| Rotate-device phone icon | 32 x 32 | 4 frames (0, 30, 60, 90 degrees in pixel steps) |
| Crown icon (champion per event) | 8 x 8 | - |
| `NEW!` badge | 24 x 8 | - |
| Home Screen app icon | 32 x 32 palette pixel map (Rio's head on index 1), integer-upscaled per research-mobile 5 | - |

### 19.4 Backgrounds

No new stadium themes: all three events reuse the 7 tier themes of 5.8.
The 400 m world is 9600 px plus run-out; L1-L3 tiles repeat, so no new tiles are needed.
Bend artwork (curved stand ends on L2/L3 during 0-100 m and 200-300 m) is "later" (21.2).

## 20. Audio list v2

### 20.1 New SFX

| SfxId | Trigger | Character | Length |
|---|---|---|---|
| `jump` | Player or rival takeoff (rival at half volume) | Short rising pulse sweep | 120 ms |
| `land` | Player landing | Soft low tick | 40 ms |
| `hurdle_clip` | CLIP | Wooden clack | 80 ms |
| `hurdle_hit` | HIT | Crash with metal clatter | 300 ms |
| `split` | Player passes 100 m and 200 m in the 400 m | Square double blip | 150 ms |
| `bell` | Player passes 300 m in the 400 m | Bright bell, two strikes | 600 ms |
| `stamina_low` | Every 0.6 s while S < S_FATIGUE | Heartbeat-like double thump, filtered noise | 120 ms |
| `stamina_empty` | S reaches 0 (max once per 3 s) | Breathy noise wheeze | 400 ms |

Existing SFX reused: `unlock` for event unlocks, `menu_move` for tab switches and first taps, `menu_select` for confirming taps, step SFX for touch steps.

### 20.2 New music

| MusicId | Tempo | Length | Notes |
|---|---|---|---|
| `hurdles` | 170 BPM | 30 s loop | Race theme for hurdles tiers 1-6, syncopated with an accent every bar; transposed per tier like `race`. |
| `quarter` | 150 BPM | 64 s loop | 400 m tiers 1-6. Two renders of the same song, base and "final 100" (added lead and drums); crossfade to the final-100 render at 300 m over 1 s. |

Zyx uses `boss` in every event.
The event select screen uses `ladder`.
Crowd: hurdles as 100 m (last 20 m); 400 m rises over the last 100 m.

## 21. Scope v2

### 21.1 Must ship

1. S10 Event Select, per-event ladders and S2, S6 records tabs, per-event S9.
2. 110 m hurdles exactly as section 13, with the HUD of 18.4.
3. 400 m exactly as section 14, with the stamina meter, oval lap icon, splits and the 14.4 time format.
4. Rosters of 15.3 and 15.4, with Sol, AI extensions of 15.2, and V_TOP tuned headless per event to +/-0.05 s.
5. Records v2 with migration from v1 (section 16), including corruption handling.
6. Touch controls of section 17 (zones, pads in bars or over canvas, pause, menus by tap, rotate prompt, tap to start, Add to Home Screen hint, Android haptics), in current iOS Safari and Android Chrome, landscape.
7. Art of section 19 and audio of section 20.
8. Keyboard jump on ArrowUp and W.

### 21.2 Later

1. Mirrored touch layout (jump on the left) and a touch layout editor.
2. 400 m bend artwork and lane stagger.
3. All-round champion (all three events) and an all-round total.
4. Ghost runner of the PB, per event.
5. Long jump, 4x100 relay.
6. Gamepad (shoulder buttons to run, A to jump).
7. Everything already in 9.2 that is not promoted here.

## 22. Acceptance criteria v2

A tester verifies each item by playing in the browser.
Section 10 still applies to the 100 m.

### Events and unlocks

- [ ] A fresh profile shows the event select with 100 m unlocked, hurdles locked (`BEAT MARCO IN 100M`) and 400 m locked.
- [ ] Beating Marco in the 100 m shows `NEW EVENT: 110M HURDLES` on the results card, and the hurdles card shows `NEW!` until opened.
- [ ] The 400 m unlocks after beating Kofi in the 100 m, or, on another fresh profile, after beating Marco in hurdles.
- [ ] Each event's ladder starts at Pip and unlocks one rival per first win, independently of the other events.
- [ ] The first Zyx win in each event shows that event's Champion screen once.

### Hurdles

- [ ] Pressing Up about 0.2 s before each hurdle clears it with no knock; the runner rises about one sprite-third above the bar.
- [ ] Never jumping knocks all 10 hurdles, the runner stumbles at each, and the race still finishes under 40 s when mashing.
- [ ] Jumping visibly late or early knocks the hurdle with a `CLIP` popup and a small speed drop; a HIT drops speed much more.
- [ ] Mashing in the air does not add speed, but the key prompt keeps alternating and no fumble is shown for correct alternation.
- [ ] Holding Up never jumps twice; Up during the countdown is a false start; Up in the 100 m does nothing.
- [ ] A steady 10 alt/s with clean jumps finishes in about 14.5 s; the results card shows `CLEAN RACE!` or the hurdles hit count.
- [ ] The jump gauge pip passes through the green zone exactly when a jump would be clean.
- [ ] Valentina never knocks a hurdle; Zyx disappears at hurdles 4 and 8 and reappears past them with the hurdle still standing.

### 400 m

- [ ] Mashing flat out from GO empties the stamina meter in roughly 100-150 m, the runner slows to about 22 km/h and finishes near 60 s.
- [ ] Mashing at about 8 alt/s keeps stamina above 0 and finishes in about 52 s.
- [ ] Stopping when empty refills the meter (arrow points up) and the speed cap lifts.
- [ ] The speed meter shows the sustain tick at about 25 km/h; the stamina meter turns red below 30.
- [ ] Splits appear at 100, 200 and 300 m, the bell rings at 300 m, and the results card shows all three splits.
- [ ] Times of 60 s or more show as `M:SS.hh` everywhere; no time over 90 s is ever recorded (DNF).
- [ ] Pip sprints away and then fades before 100 m; Sol's three splits are within about 0.3 s of each other per 100 m.
- [ ] The oval lap icon moves both dots around the oval and reaches the bottom-right at the finish.

### Records v2 and migration

- [ ] With a v1 save in `retroRunner.save.v1` (PBs, history, unlocks up to Kofi, settings), loading the new build shows the same 100 m PBs, history, unlocks and settings, and hurdles and 400 m unlocked.
- [ ] After that load, `localStorage.getItem("retroRunner.save.v2")` returns JSON matching 16.2 and the v1 key is unchanged.
- [ ] Replacing the v2 value with `not json` and reloading backs it up to `retroRunner.save.corrupt` and re-migrates from v1 without a crash.
- [ ] Records has three tabs; each shows that event's PBs, targets, last 3 and ladder total; the hurdles tab has a HIT column.
- [ ] Each event's history holds at most 50 entries, and 100 m history is not pushed out by races in other events.
- [ ] Reset records removes both keys, keeps settings, and relocks hurdles and 400 m.

### Touch (Android Chrome and iOS Safari, landscape)

- [ ] Title shows `TAP TO START`; the first tap starts audio, and on Android enters fullscreen.
- [ ] On an iPhone Safari tab, the Add to Home Screen hint appears once and never again after OK; it never appears when launched from the Home Screen.
- [ ] Portrait shows the rotate prompt and pauses a race; turning back shows the pause menu.
- [ ] Alternating left and right thumbs runs at the same speed as keys for the same rate; tapping one side twice shows a fumble.
- [ ] Holding one thumb down on the left and tapping the left again with another finger gives no step and no fumble; the pad flashes the held-blocked border.
- [ ] Sliding a thumb from the left zone into the right zone gives no right step.
- [ ] Touching a run zone during the countdown is a false start; touching the top strip is not.
- [ ] In hurdles, the JUMP control sits above the right pad and jumps; in 100 m and 400 m there is none.
- [ ] Pads sit in the side bars on phones with bars and over the bottom corners on 16:9 tablets, never under the notch or home indicator, and never hide the runners.
- [ ] Every menu, card, tab, node and button is reachable by tap; every tappable control is at least 44 CSS px.
- [ ] The pause button pauses; the page never scrolls, zooms, selects text or shows a callout.
- [ ] On Android with haptics on, a fumble vibrates once; steps never vibrate; turning haptics off stops it; iOS shows no haptics option.
- [ ] Pressing a key on a tablet with a keyboard hides the touch pads; touching the screen shows them again.
