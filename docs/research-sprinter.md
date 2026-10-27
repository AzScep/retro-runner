# Research: "Sprinter" (Gamedesign.jp) and what Retro Runner should take from it

Status: research input for the multi-runner expansion; not a spec.
Date: 2026-10-27.
Scope: identity, mechanics, progression, race format, feel, design analysis, then a mapping onto Retro Runner (`docs/design.md`).

## 0. How this was researched (and how much to trust it)

| Evidence | What it gave | Confidence |
|---|---|---|
| Original SWF from the developer's own site (`https://www.gamedesign.jp/flash/sprinter/sprinter.swf`, 408 KB, SWF v7 / ActionScript 2, served with Last-Modified 2021-07-04) | Disassembled the ActionScript: lanes, AI speeds, player speed model, stumble rule, timing, results ranking, stage flow, game over. | High: this is the game's own code. |
| Headless playthrough of that SWF in Ruffle (Playwright + Chromium), title to ending credits | Screenshots of title, stage cards, races, results tables, alien stage, ending. | High for what is shown. |
| Simulation of the extracted formulas (4000 seeded fields per stage) | Expected winning times and required press rates per stage. | High for the model; real play adds human noise. |
| Hosting pages (CrazyGames, FlashArch, search snippets for Y8) | Platform, dates, play counts, descriptions. | Medium: pages disagree on dates. |
| YouTube titles and one let's-play transcript | What players remember and say. | Medium: small sample, anecdotal. |

Nothing below was copied into this repo: no assets, names, text or level data.
Where this document mentions the original's names or text, it is to describe the humour, not to reuse it.

Sources:
- https://www.gamedesign.jp/flash/sprinter/sprinter.html
- https://www.gamedesign.jp/index_en.html
- https://www.crazygames.com/game/sprinter
- https://flasharch.com/en/archive/play/1ef382d8a2ae693c9919947eb68b6262
- https://www.y8.com/games/sprinter (page did not load from this machine; facts taken from search-result snippets only)

## 1. Identity

| Question | Answer | Source / confidence |
|---|---|---|
| Developer | GAMEDESIGN (gamedesign.jp), a small Japanese browser-game site, also known for Circle the Cat and Dice Wars. The title screen says "GAMEDESIGN"; the ending credits name it for art and program. | Game itself, CrazyGames. High. |
| Year | Ending credits read "Copyright(c) 1999-2005" (the site's range); CrazyGames and the Y8 snippet say 2006; FlashArch says 2007. Best estimate: released 2005-2006. | Conflicting; exact date unverified. |
| Platform | Macromedia Flash, SWF version 7, ActionScript 2, 30 fps, 640x480 stage. | SWF header and code. High. |
| Developer's own blurb | A 100 m sprint simulation run with the left and right arrow keys. | gamedesign.jp English index. High. |
| Hosted today | gamedesign.jp still serves the SWF (needs Ruffle or a Flash player); CrazyGames (Ruffle, rating 8.8 with ~16K likes); Y8 (snippet: ~24.5M plays, "HTML5 version" note); FlashArch archive; Numuki, Agame, Two Player Games mirrors. | Mixed. Y8 claims unverified (page unreachable). |
| How it is played now | Mostly through the Ruffle Flash emulator in the browser. The "HTML5" label on portals most likely means Ruffle, not a rewrite; I found no evidence of an official HTML5 port. The developer's mobile site lists no Sprinter. | Medium. |
| Sequels / related | A "Facebook version" link (apps.facebook.com/sprinterff) on the original page, now dead. No sequel found. Unrelated games share the name (for example an AI-made "Sprinter" on seeles.ai with 4 runners and a chase camera; its "design spec" is not the original, ignore it). | Medium. |
| Speedrun culture | YouTube titles show records in the 7-9 s range and alien wins; a "3.60 s" video and "How To Hack Sprinter" exist. The code caps legal times at about 6.3 s, so sub-6 s videos are glitches or hacks. | Medium. |

Sources:
- https://www.gamedesign.jp/index_en.html
- https://www.crazygames.com/game/sprinter
- https://flasharch.com/en/archive/play/1ef382d8a2ae693c9919947eb68b6262
- https://www.youtube.com/watch?v=kBxHqCN8KS4
- https://www.youtube.com/watch?v=HBZbJM0g8x8
- https://www.youtube.com/watch?v=Qh824KQ1h6A

## 2. Core loop and controls (from the code)

Units below: the game uses 32 px per metre and 30 frames per second, so 1 px/frame = 0.9375 m/s.

| Mechanic | How it works in Sprinter | Retro Runner today |
|---|---|---|
| Inputs | Left and Right arrows only (FlashArch lists A and L for an older build). Nothing else during a race. | Left/Right or A/D; Up/W to jump in hurdles; touch zones. |
| What counts | A keydown on the opposite side of the last one is counted. A keydown on the same side is not counted. | Same idea (valid step = alternation), plus held-key, auto-repeat and 35 ms filters. |
| Speed model | Presses are counted in 0.5 s buckets from GO. Each frame the target speed is `7 + 10 * (current bucket + previous bucket) / 12` px/frame, clamped 7-17. So target speed is a linear function of the press rate over the last 0.5-1.0 s. | Impulse per step with proportional drag; speed in m/s equals alternations per second. |
| Speed range | 6.6 m/s floor (you jog even with no input) to 15.9 m/s cap. | 0 to 12.5 m/s; no input means you stop. |
| Acceleration feel | Player approaches the target at +4.2 m/s^2, drops at -11.25 m/s^2: slow to build, quick to lose. | Drag time constant 2.0 s; idle braking after 0.25 s. |
| Same-key press (the "stumble") | Each same-side press has a 1 in 3 chance to trip the runner: speed bleeds to 0, the runner lies down for 0.4 s, gets up, and restarts from the 6.6 m/s floor. Roughly 2 s lost. A voice clip plays and a finish judge reacts. | Fumble: zero impulse and a prompt shake, no fall. |
| Start | Starter official with speech bubbles: Ready (about 2.7 s), Get set (about 2 s), pistol, Go. All runners leave at 1.9 m/s at GO, no reaction time. | 3-2-1-GO with a random extra 0-0.5 s on "1". |
| False starts | None. Keys before Go are ignored. | Two-strike false start rule. |
| Timing | Frame count at GO; at the line, time = 100 m x elapsed / distance covered (an average-speed extrapolation), shown as `SS.hh`. | Interpolated crossing at 120 Hz, ms precision, shown as `SS.hh` or `M:SS.hh`. |
| Fastest legal time | About 6.3 s (17 px/frame cap, 30 fps). | About 10.0 s floor. |

Player time for a steady press rate, from the extracted model (simulated):

| Steady alternations per second | 0 (no input) | 4 | 6 | 8 | 10 | 12 | 14 | 16+ |
|---|---|---|---|---|---|---|---|---|
| Finish time | 15.6 s | 11.6 s | 10.7 s | 9.7 s | 9.3 s | 8.9 s | 8.5 s | 8.0 s, then the cap |

Sources:
- https://www.gamedesign.jp/flash/sprinter/sprinter.swf (disassembled; runner, input and timing scripts)
- https://www.crazygames.com/game/sprinter (controls blurb)

## 3. Progression

### 3.1 Stages in order

| Stage | Field (who you race) | Stage card (theme, in my words) | AI top speed | Winning time, median of 7 rivals (sim) | Steady rate needed to win a median field |
|---|---|---|---|---|---|
| 1 | Kindergarten kids | School sports day | 7.5 m/s | 14.0 s | 1.5 alt/s |
| 2 | High school girls | School athletics festival | 8.4 m/s | 12.5 s | 3.3 alt/s |
| 3 | High school boys | Inter-school meet (unverified title) | 9.4 m/s | 11.3 s | 5.1 alt/s |
| 4 | College students | National sports festival (from a let's-play) | 10.3 m/s | 10.3 s | 7.1 alt/s |
| 5 | Olympic sprinters | The Olympics | 11.25 m/s | 9.5 s | 9.0 alt/s |
| - | Champion screen | Shown after winning the Olympics; looks like the end | - | - | - |
| 6 | Aliens (bonus stage after the "ending") | A galactic athletics meet | 12.2 m/s | 8.8 s (1 in 100 fields: 8.5 s) | 11.9 alt/s |
| - | Ending | Short congratulation text and credits, then back to the title | - | - | - |

Level list confirmed three ways: the code (stage labels s1-s6, a champion label between 5 and 6), FlashArch's level list, and the playthrough.
Exact stage-card wording for stages 3 and 4 was not fully captured; treat those two titles as unverified.
The model agrees with player lore: a LetsRun forum post (via search snippet) says you need sub 9 s to have a shot at the aliens, and the sim says the median alien field wins in 8.84 s.

### 3.2 How difficulty ramps

| Property | Value |
|---|---|
| Ramp | AI top speed rises by exactly 1 px/frame (0.94 m/s) per stage; the required press rate rises by about 1.8-2.0 alt/s per stage, a straight line from "barely press" to "near the human ceiling". |
| Variance | Each AI rival rolls a first-half speed and a second-half speed, each uniformly 80-100% of the stage top speed, and switches at a random point between 40 and 80 m. |
| Field effect | With 7 rivals the winning time is the best of 7 rolls, so the target is tight and the winner's identity changes from race to race. |
| Ceiling | Stage 6 asks for about 12 alt/s, close to the same ceiling Retro Runner's Zyx asks for (11.9 alt/s). |
| Floor | Stage 1 is almost free: jogging plus a few presses wins. This makes the first minute pure fun. |

### 3.3 Unlocks, economy, losing

| Topic | Sprinter |
|---|---|
| Win condition | Finish 1st of 8. Second place is a loss. |
| Losing | Any loss shows GAME OVER and returns to the title; the next start is stage 1 again. A full run is one attempt. |
| Retry speed | Losing costs the walk back through every earlier stage, but those are quick (about 15 s each plus cards). |
| Upgrades, money, training, stats | None. |
| Saving | None: no records, no PBs, no stage select. Times live only on the results table. |
| Characters | One unnamed player runner (pink and blue kit, lane 4). |

Sources:
- https://www.gamedesign.jp/flash/sprinter/sprinter.swf (stage flow, ranking, game over)
- https://flasharch.com/en/archive/play/1ef382d8a2ae693c9919947eb68b6262
- https://www.letsrun.com/forum/flat_read.php?thread=2774107 (403 from this machine; quoted via search snippet)
- https://www.youtube.com/watch?v=0xPJkLa50Q4

## 4. Race format

| Element | Sprinter |
|---|---|
| Runners | 8 per race: the player plus 7 rivals of the same stage type. |
| Lanes | 8 numbered lanes; the player is always in lane 4, so rivals sit on both sides. |
| Camera | Fixed quarter view: the track runs diagonally from bottom left to top right, and the whole track scrolls to keep the player centred. No zoom, no cuts. |
| World | One stadium for every stage: red track, green infield, blue sky band, distance numbers every 10 m. Only the runners change. |
| Props | Starter official with speech bubbles at the start; at the finish a photo-finish camera on a pole and three seated judges who react (one stands up when you trip). |
| HUD | None during the race: no timer, no speed meter, no position. You read the race from the runners. |
| Results | Black screen, "RESULTS" header, 8 rows of rank, name, time (`SS.hh`), a pointing-hand cursor on the player row; equal times share a rank. Win and loss jingles differ. |
| Medals | None. Only 1st matters. |

Sources:
- https://www.gamedesign.jp/flash/sprinter/sprinter.swf (lane setup, judges, results code)
- Playthrough screenshots (not committed)

## 5. Feel and presentation

| Aspect | Sprinter |
|---|---|
| Art | Pre-rendered 3D (CG) runners as small sprites; flat vector track; photographic-style CG athletes on the title and ending. Not pixel art. |
| Animation | Run cycle speed follows actual speed; set position crouch; fall, lie and get-up; aliens stand upright at the start instead of crouching. |
| Audio | A different streamed music track per stage (described by portals as funky and by one player as catchy but annoying), starter pistol, a voice clip on falls, win and loss jingles. |
| Humour | Deadpan: the same serious stadium hosts toddlers and aliens. Rival names are jokes for those who get them: old-fashioned grandmother names for the teenage girls, names nodding to classic Japanese film actors for the students, near-real 100 m legends for the Olympians, tokusatsu-hero-style names for the aliens. The ending text is charmingly broken English. |
| The alien stage | After a champion screen that looks like the end, a surprise extra stage puts you against a row of identical silver grey aliens, standing upright on the line, much faster than anyone before. |
| Session pacing | A clean run is about 5-6 minutes: six 10-15 s races, short cards between them. A loss throws you back to the start. |

What players remember and say (paraphrased unless quoted):

| Theme | Evidence |
|---|---|
| The aliens | Video titles centre on them ("Beating the aliens!", "WE'RE RACING ALIENS!", alien times like 6.92 s). |
| Falling | The let's-player falls repeatedly and reacts loudly every time; tripping is the drama of the game. |
| Physical effort | Players switch to two hands and joke about breaking keyboards (a Portuguese video title says the game can break your keyboard; a Thai title jokes about finger muscles). |
| Nostalgia | "I haven't played this since middle school" (let's-play, paraphrased); portals still rate it 8.8. |
| Difficulty memory | The same player recalls never getting past one stage as a kid. |
| Music | Each stage's tune is remembered; one player mutes it as "annoying". |

Sources:
- https://www.youtube.com/watch?v=0xPJkLa50Q4 (transcript)
- https://www.youtube.com/watch?v=3czVI_dZ4i0
- https://www.youtube.com/watch?v=Vv48E4kuZyY
- https://www.youtube.com/watch?v=EXpt0102aoY
- https://www.youtube.com/watch?v=Lii2YlKdXHY
- https://www.crazygames.com/game/sprinter

## 6. Why it works

| Ingredient | Why it lands |
|---|---|
| A crowd, not a duel | Eight bodies on the track make every race feel like an event; you pass people, which is the best feeling in a sprint game. One rival cannot give that. |
| A target you cannot see | No HUD: you judge the race from bodies around you. The field's random paces mean the leader changes, so the race is readable and dramatic without numbers. |
| A straight-line difficulty ramp in press rate | Each stage asks for about 2 more presses per second. Players feel the step up in their hands, not in a menu. |
| A gentle floor | Stage 1 is almost impossible to lose. Everyone gets the joke and the first win. |
| Risk in the input | The 1-in-3 trip on a same-key press punishes panic mashing. Under pressure you lose rhythm, fall, and hear about it. Fear of falling is the tension. |
| One-life run | A loss sends you to stage 1. The Olympics and the aliens become places you earn, and a near miss is a story. |
| The fake ending | The champion screen says you are done; then the aliens arrive. The twist reframes the whole run and makes the last stage legendary. |
| Deadpan absurdity | Toddlers to aliens in the same plain stadium, serious officials, joke names. The humour never interrupts play; it sits in the cards, names and the final reveal. |
| Short and honest | A run takes minutes; times are shown to the hundredth; nothing is bought or levelled. |

## 7. Mapping onto Retro Runner

Retro Runner already has most of Sprinter's spine (a ladder from a child to an alien, alternation-only running, exact times, instant retry) plus things Sprinter never had (PBs, three events, touch, false starts, a pixel-art identity).
What Sprinter has that we lack: a field of runners, a run-based tension mode, the fake-ending reveal, the fall, stage cards and officials.

### 7.1 Prioritised proposals

| # | Proposal | Scope | Why |
|---|---|---|---|
| 1 | Multi-runner races: 6 runners (player plus 5) in every event | L (core, art, HUD, records, tuning) | The user's idea and Sprinter's biggest difference. Details in 7.2. |
| 2 | Tier fields: each race is the tier's named rival plus 4 field runners of the same cohort (classmates, teammates, robots, alien drones) | L (art: about 7 cohort bodies with palette swaps) | Keeps our named rivals and personalities; adds Sprinter's crowd. |
| 3 | Fake ending and alien reveal: hide tier 7 until tier 6 is beaten; show a champion card, then an "unidentified runners" interruption and Zyx's squad on the line | M | Sprinter's most memorable moment, in our own words and art. |
| 4 | Gauntlet mode per event: race tiers 1-7 back to back, one loss ends the run, score is the total time | M | Adds Sprinter's one-life tension without taking away instant retry on the ladder. |
| 5 | Meet title cards and officials: a card per tier naming the meet (sports day ... galactic meet), a pixel starter with speech bubbles, finish judges and a photo-finish camera | S-M | Cheap, characterful, and helps the field read as a real event. |
| 6 | Deterministic trip: a fall when the player makes 2 same-side presses within 0.5 s (not random), about 1.5 s lost | S, but needs tuning and a user decision | Adds Sprinter's drama while keeping "honest mashing" deterministic. |
| 7 | Per-tier race music variants beyond the current semitone transposition | M (audio) | Sprinter's per-stage tunes are remembered; our tracker approach makes variants cheap-ish. |

Skip:

| Sprinter feature | Why we skip it |
|---|---|
| Diagonal quarter view | Breaks our side-view art, parallax and every existing background layer. |
| Random 1-in-3 trip | Randomness undercuts "honest mashing"; use the deterministic version (#6) if anything. |
| Free 6.6 m/s jog without input | Breaks "speed comes only from alternation". |
| No false starts, no HUD, no saves | Ours are better and are pillars ("every hundredth counts"). |
| Losing returns to stage 1 in the main mode | Conflicts with "retry is one key press away"; keep it only inside Gauntlet (#4). |
| Real-person parody names and broken-English text | Legal and tonal risk; our humour comes from our own characters and quirks. |

### 7.2 Multi-runner races in a 320x180 side view

| Topic | Proposal |
|---|---|
| Count | 6 runners: player plus 5 (named rival plus 4 field). 5 is also viable; 8 is too crowded at 320 px. |
| Lanes | 6 lanes in the L4 track band (y 104-160) with feet at y = 112, 121, 130, 139, 148, 157 (9 px apart, about 0.4 of a 24 px metre). Sprites overlap like a side-on TV shot; draw in lane order, far lane first. Track art needs 6 lane lines instead of 3. |
| Player lane | Nearest lane (feet at 157) so the player is never covered; named rival in the next lane up so the key duel stays readable. Alternative (Sprinter style): player in a middle lane with a 1 px highlight outline. Open question. |
| Camera | Unchanged: follow the player at screen x = 96. |
| Off-screen runners | Replace the single rival arrow with one right-edge arrow for the leader only (`> 4.2m` plus the leader's 8x8 head) and one left-edge pip for anyone behind. |
| Progress bar | One head marker per runner (6x4 px); player below the bar, others above, named rival in its own colour, field runners in a neutral colour. |
| Live position | `3RD` / `1ST` at 2x near the timer, changing as runners pass (no flashing; reduced-flashing safe). |
| Results card | A 6-row table: place, portrait, name, time; player row highlighted; then margin to the winner (or to 2nd when you win), PB row, unlock row, buttons. The panel needs about 24 px more height or a two-column layout. |
| Win and unlock | Unlock the next tier on 1st place (Sprinter's rule). Record best placing per rival; show bronze, silver or gold pips on the ladder node so a 2nd place still feels like progress. |
| AI for field runners | Reuse the existing exponential-approach AI with Sprinter-style pace: per race, a first-half and a second-half multiplier, each seeded uniform in [0.85, 1.00] of the tier's pace, switching at a seeded 40-80% of the distance. Same seed rules as section 3.1. |
| AI for the named rival | Unchanged (quirks, warps, pressure). |
| Tuning | The target is now the field's winning time, an order statistic. Tune headless so that (a) the named rival wins the field most of the time (suggest 60-75%), and (b) the field's median winning time equals today's tier target within +/-0.05 s, so existing PBs stay comparable. Report the 90th-percentile winning time too. |
| 400 m | Field runners use the default pace profile with the seeded multipliers; no AI stamina, as today. |
| Hurdles | Field runners use the existing AI jump and pClip rules; 6 lanes x 10 hurdles means 60 hurdle sprites per race, so check batching (perf handover note: one atlas, 1-2 textures per batch). |
| Records | Add `place` and `fieldSize` to history entries, a best placing per rival, and a schema migration (v2 to v3) that treats old wins as 1st place. PB and ladder total rules stay as they are. |
| Pillars kept | Honest mashing (player model untouched), exact times (every runner gets an interpolated ms time), one-key retry. |

### 7.3 Risks and open questions for the user

| # | Question or risk | Options |
|---|---|---|
| 1 | Runners per race | 5 or 6 (recommended) or 8 like Sprinter. |
| 2 | Win rule | 1st place to unlock (recommended, Sprinter-like) or "beat the named rival" with placings as a bonus. |
| 3 | Player lane | Nearest lane (recommended for readability) or a middle lane like Sprinter. |
| 4 | Hide Zyx for the reveal | Hidden until tier 6 is beaten (recommended); existing saves that already unlocked Zyx skip the reveal. |
| 5 | Fall mechanic | Deterministic trip (recommended to prototype), or keep today's fumble only. |
| 6 | Gauntlet mode | Add per event (recommended) or skip. |
| 7 | Readability risk | Overlapping 40 px sprites in a 56 px band may hide the named rival; prototype at 1x before committing art. |
| 8 | Art cost risk | About 7 cohort bodies x 3 events of animations (run, crouch, celebrate, stumble, jump); palette swaps reduce it. |
| 9 | Performance risk | 6 animated runners plus props on low-end phones; stay inside the single atlas. |
| 10 | Tuning risk | Field variance can make a tier feel unfair if a field runner wins too often; cap field pace below the named rival's top pace. |

## 8. Evidence appendix: values read from the original code

| Name in code | Value | Meaning |
|---|---|---|
| `COURSE_MAX` | 8 | Runners per race. |
| `USER_COURSE` | 4 | Player's lane index. |
| `METER` | 32 px | One metre; finish at 3200 px. |
| `type_spd_max` | 8, 9, 10, 11, 12, 13 px/frame for stages 1-6 | AI top speed per stage. |
| AI pace | first and second speed each `max - max * random / 5`; switch at `40 + random * 40` m | Per-race variance. |
| AI accel / decel | 0.5 px/frame^2 | Near-instant speed changes. |
| `user_spd_min` / `user_spd_max` | 7 / 17 px/frame | Player speed floor and cap. |
| Rate window | 0.5 s buckets; current plus previous divided by 12 | Press rate to speed. |
| Player accel / decel | +0.15 / -0.4 px/frame^2 | Slow build, fast loss. |
| Trip chance | 1 in 3 per same-side press | Random stumble. |
| Down time | 12 frames lying, then get-up, restart at 7 px/frame | About 2 s lost. |
| Start delays | 80 frames on "Ready", 60 frames on "Get set" | No false-start window. |
| Lose rule | Not 1st goes to GAME OVER, then the title (stage 1). | One-life run. |
| Stage flow | Win stage 5 shows the champion screen, then stage 6; win stage 6 shows the ending. | Fake ending and bonus alien stage. |
