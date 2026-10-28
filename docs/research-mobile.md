# Retro Runner - mobile and touch research

Status: recommendation, researched 2026-10-27.
Owner of this file: tech researcher.
Game rules, layout of the touch controls and copy live in `docs/design.md`; this file covers platform facts and architecture only.
Browser support facts come from `@mdn/browser-compat-data@8.1.7` (current releases in that data: Safari iOS 27, Chrome Android 156), the Safari release notes JSON for 18.4 to 27, and the installed Phaser 4.2.1 and Playwright 1.64.1 sources.
Package versions were read from the npm registry on 2026-10-27.

## Decision table

| Area | Choice | Version (if a library) | Why (one line) |
| --- | --- | --- | --- |
| Touch input API | Pointer Events (`pointerdown` / `pointerup` / `pointercancel` / `lostpointercapture`) on DOM run zones | Web platform | One model for touch, pen and mouse, a per-finger `pointerId`, explicit cancel, and `event.timeStamp` on the `performance.now()` origin. |
| Output shape | Touch emits the existing `RunKeyEvent { kind, side, t, repeat: false }` through a new pure input hub in `src/core` | in-repo code | Core step rules (alternation, held side, 35 ms, fumbles) apply unchanged, with no race code knowing about touch. |
| Jump | A new core action event (`{ kind, action: 'jump', t }`) defined by MECHANICS, emitted by touch and keyboard alike | in-repo code | `Side` is `'L' \| 'R'` only; jump must not be smuggled through it. |
| Run / jump / pause controls | DOM overlay above the canvas, not Phaser in-canvas input | Web platform | Exact multi-touch with capture, sizes in CSS px independent of game scale, can sit in the letterbox bars, real `<button>` accessibility. |
| Menu taps | Canvas tap mapped to game pixels by `src/touch`, hit-tested against a scene-registered tap-target list in `src/ui` | in-repo code | Menus are drawn in-canvas; Phaser pointer input would need a bounds fix and adds window touch listeners. |
| Phaser pointer input | Turn off (`input: { keyboard: false, mouse: false, touch: false }`) | `phaser@4.2.1` | Phaser 4 uses Touch Events with 1 touch pointer by default, `preventDefault`s canvas touches, and its cached canvas bounds go stale after our manual CSS sizing. |
| Gesture suppression | `touch-action: none` on `html`, `-webkit-user-select: none`, `-webkit-touch-callout: none`, `-webkit-tap-highlight-color: transparent`, `overscroll-behavior: none` | CSS | Kills double-tap zoom, pinch, pull-to-refresh, selection and callouts without `user-scalable=no`. |
| Viewport | `viewport-fit=cover` plus fitting the canvas and controls inside `env(safe-area-inset-*)` | HTML/CSS | Uses the full landscape screen while keeping controls off the notch and home indicator. |
| iPhone "fullscreen" | Add to Home Screen web app (`display: fullscreen` in the manifest, iOS falls back to `standalone`) and a one-time hint in Safari tabs | Web platform | iPhone has no element Fullscreen API; iOS 26+ opens every Home Screen site as a web app. |
| Orientation | Rotate-device overlay in portrait on touch devices; `screen.orientation.lock('landscape')` only on Android after fullscreen | Web platform | iOS has no `lock()`; Chrome Android supports it once fullscreen. |
| Audio unlock | Call the existing `unlockAudio()` on `pointerup` and `touchend` too | in-repo code | `pointerdown` from touch is not a user-activation event; `pointerup` and `touchend` are. |
| Wake lock | Do not use | - | Touches and key presses already reset the idle timer; races last under 30 s. |
| Haptics | Android only, opt-out setting, short pulses on fumble and false start, never per step | Web platform | `navigator.vibrate` is Chrome Android only; per-step buzzing at 10+ Hz is mush and drains battery; iOS has no web haptics. |
| Low Power Mode | No change; document that rendering drops to 30 fps on iOS | in-repo code | Our sim places inputs by timestamp, so race times stay exact; only visual smoothness suffers. |
| PWA | `vite-plugin-pwa` generating manifest and a precaching service worker, `registerType: 'prompt'`, never auto-reload | `vite-plugin-pwa@2.0.0` (pulls `workbox-build@7.4.1`, `workbox-window@7.4.1`) | Exact precache list from the build, offline play from the Home Screen, updates applied on next launch, never mid-race. |
| Icons | One 32x32 palette pixel map, integer-upscaled by an in-repo script to committed PNGs | in-repo code | Resizers like `@vite-pwa/assets-generator` smooth pixels; integer nearest-neighbour keeps the art crisp. |
| Vercel | Add `headers` for immutable `/assets/*`, `no-cache` for `/sw.js`, manifest content type | Vercel config | Hashed assets cache forever, the service worker always revalidates. |
| Touch / keyboard detection | Initial `(pointer: coarse)`, then live switching on last input (touch `pointerdown` shows, keyboard `keydown` hides) | Web platform | Covers phones, iPads with keyboards and touch laptops without guessing from user agents. |
| E2E | New Playwright projects `Pixel 7 landscape` (Chromium) and `iPhone 15 landscape` (WebKit); trusted multi-touch via CDP `Input.dispatchTouchEvent` on Chromium, synthetic `PointerEvent`s on WebKit | `@playwright/test@1.64.1` | Playwright's only public touch API is single `tap()`; Chromium CDP gives real multi-touch, WebKit needs in-page dispatch. |
| Unit tests | Pure pointer-to-`RunKeyEvent` mapper and zone layout tested in Vitest (Node) | `vitest@5.0.5` | Exact timing and edge cases (cancel, capture loss, two fingers on one side) without a browser. |

## 1. Input: Pointer Events vs Touch Events

### Facts

- Pointer Events ship in every target: `setPointerCapture` and `lostpointercapture` since Safari iOS 13 and Chrome Android 55-57.
- Each finger gets its own `pointerId`, so two-thumb alternation is two independent down/up pairs.
- `event.timeStamp` is a `DOMHighResTimeStamp` relative to the document's time origin, the same origin as `performance.now()`, for pointer events exactly as for key events.
- Chrome stamps input with the OS hardware time, so `timeStamp` can be a few ms earlier than `performance.now()` at dispatch; that is the point of using it.
- Chrome dispatches discrete events (`touchstart`, `touchend`, `mousedown`, `keydown`) immediately and only rAF-aligns continuous events (`touchmove`, `pointermove`); `pointerdown` is generated from `touchstart`, so it is not delayed to the frame.
- `getCoalescedEvents()` and `getPredictedEvents()` (Safari 18.2+, Chrome Android 58/77) only matter for `pointermove`; they add nothing for taps and we ignore them.
- There is no 300 ms click delay with `width=device-width` and `touch-action: none`, and we do not use `click` for run zones anyway.
- Safari 27 fixed touch event properties that were "sometimes swapped with neighboring values" (171147417); Pointer Events avoid the `TouchList` path that bug affected on older iOS.
- Safari 26.4 fixed pointer events failing to dispatch when a host view's gesture recognizer blocked `touchesEnded` (168015965), which affects some in-app browsers on older iOS.
- Touch Events (`touchstart` with `changedTouches`) remain an option, but give one event for several fingers, no capture, and a separate model from mouse.
- Phaser 4.2.1 itself uses Touch Events (`src/input/touch/TouchManager.js`), with `input.activePointers` defaulting to 1 touch pointer, and processes them immediately with `pointer.downTime = event.timeStamp`.

### Gesture suppression (all CSS, plus one listener)

- `touch-action: none` on `html` (the effective touch action is intersected down the tree, so this covers the overlay and canvas) disables pan, pinch-zoom and double-tap zoom in Safari iOS 13+ and Chrome Android 36+.
- Do not add `user-scalable=no`; iOS ignores it since iOS 10 and it fails accessibility audits, while `touch-action` does the job.
- `overscroll-behavior: none` (already on `html, body`) plus no scrollable overflow prevents Chrome pull-to-refresh.
- `-webkit-user-select: none` is required; MDN data lists unprefixed `user-select` as Safari Technology Preview only.
- `-webkit-touch-callout: none` stops the iOS long-press callout; `-webkit-tap-highlight-color: transparent` removes the grey flash.
- Add a `contextmenu` `preventDefault` on the overlay root, because Android long-press fires `contextmenu` and Phaser's `disableContextMenu` covers the canvas only.
- Edge-swipe back: iOS Safari tabs cannot disable it, and it needs history to go back to, so the game must never push history entries; Home Screen web apps have no browser back.
- Android gesture navigation keeps its left and right back-swipe strips even in fullscreen, and the web cannot set gesture exclusion rects; back is a horizontal drag, not a tap, so run zones should start a few dp in from the screen edge and the design should not rely on edge drags.
- iOS system gestures (home indicator at the bottom, Control Center and notifications at the top) cannot be deferred by web content, so keep every control inside `env(safe-area-inset-*)` and away from the top and bottom edges.

### Mapping touches to `RunKeyEvent`

- Run zones are two DOM elements (`data-touch="L"` and `"R"`); jump and pause are separate buttons.
- On `pointerdown` over a zone: call `setPointerCapture(pointerId)` inside `try/catch` (synthetic test pointers throw `NotFoundError`), record `pointerId -> side`, and emit `{ kind: 'down', side, t, repeat: false }`.
- Forward every `pointerdown`, even when that side already has a finger down, exactly like the keyboard adapter forwards every keydown; core's held-side rule then ignores it.
- On `pointerup`, `pointercancel` or `lostpointercapture`: if the `pointerId` is still tracked, delete it and emit `{ kind: 'up', side, t }` only when the side has no fingers left (mirrors the keyboard adapter's per-side key set); the first of the three events wins and the others are no-ops.
- Capture means a thumb that slides from the left zone into the right zone stays a left touch; sliding never creates a step.
- On window `blur` and `visibilitychange` hidden, release every tracked pointer with a synthetic `up`, matching `attachKeyboard`'s blur rule.
- Timestamp guard: use `ev.timeStamp`, but if it is greater than `performance.now()` or more than 1000 ms older, fall back to `performance.now()`, and never emit a `t` lower than the previous emitted `t`.
- `repeat` is always `false`; touch has no auto-repeat.
- Accept `pointerType` `touch`, `pen` and `mouse` on the zones, so desktop mouse clicks exercise the same path in tests.
- Jump: `pointerdown` on the jump button emits a jump action `down`, release emits `up`; the core action type and its keyboard binding are MECHANICS' change, not touch's.
- Pause: the pause button dispatches `new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true })` on `window`, which `scenes/app.ts` already handles; this is fine for menu-level commands, whose timing does not matter, and avoids any scene importing touch.

Sources:
- https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
- https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture
- https://developer.mozilla.org/en-US/docs/Web/API/Event/timeStamp
- https://w3c.github.io/hr-time/#time-origin
- https://developer.chrome.com/blog/aligning-input-events
- https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents
- https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action
- https://developer.mozilla.org/en-US/docs/Web/CSS/user-select
- https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-touch-callout
- https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior
- https://developer.apple.com/documentation/safari-release-notes/safari-27-release-notes
- https://developer.apple.com/documentation/safari-release-notes/safari-26_4-release-notes
- `node_modules/phaser/src/input/touch/TouchManager.js`, `node_modules/phaser/src/input/InputManager.js`, `node_modules/phaser/src/core/Config.js`

## 2. DOM overlay vs Phaser in-canvas input

### Findings

- Our canvas is sized by `fitZoom` to a fractional CSS size and positioned with `left`/`top` after `game.scale.setZoom()` runs, but Phaser's `ScaleManager` computes `canvasBounds` and `displayScale` inside `setZoom` -> `refresh()`, before those style writes, so Phaser pointer coordinates can be offset until the next Phaser resize; in-canvas input would need `game.scale.refresh()` after every `fitCanvas` (and `refresh()` rewrites `style.width` to `width * zoom`, undoing the device-pixel snapping).
- Phaser's TouchManager also listens on `window` for `touchstart`/`touchend` and calls `preventDefault()` on canvas touches, which would compete with a DOM overlay.
- Hit targets: Apple HIG asks for at least 44x44 pt, Material for 48x48 dp, WCAG 2.2 SC 2.5.8 for 24x24 CSS px (AA) and SC 2.5.5 for 44x44 (AAA); on phones 1 CSS px is 1 pt (iOS) or 1 dp (Android).
- In game pixels that is about 20-25 internal px on a landscape phone:

| Device (landscape) | Viewport CSS px | CSS px per game px | Letterbox bar each side | 44 pt / 48 dp in game px |
| --- | --- | --- | --- | --- |
| iPhone 15, Safari tab | 734x343 | 1.91 | 62 | 23 / 25 |
| iPhone 15, Home Screen app | 852x393 | 2.18 | 77 | 20 / 22 |
| Pixel 7, Chrome tab | 863x360 | 2.00 | 111 | 22 / 24 |
| Pixel 7, fullscreen | 915x412 | 2.29 | 91 | 19 / 21 |

- A 320x180 canvas therefore cannot afford many 44 pt in-canvas buttons, while the letterbox bars (62-111 CSS px) are natural thumb rests that only a DOM overlay can use.

### Recommendation: DOM overlay for run zones, jump and pause; canvas taps for menus

- Run zones: large transparent hit areas (for example the left and right halves of the screen below a top strip), with pixel-art pad graphics drawn by the overlay.
- Pixel look: size every control in whole multiples of the current game-pixel size (`cssHeight / 180`, exposed as a CSS variable `--gp`), draw icons as inline SVG with `shape-rendering="crispEdges"` as `src/ui/fullscreen.ts` already does, and use only palette colours.
- Accessibility: real `<button type="button">` with `aria-label` for jump and pause; run zones get `aria-hidden="true"` because the game is not screen-reader playable and the keyboard path remains; never let overlay buttons take focus (`tabIndex = -1`, `preventDefault` on `pointerdown` focus) so the keyboard keeps driving the game.
- Visual feedback (pressed state) is a CSS class toggled in the same handler, so it appears on the next frame regardless of the game loop.
- Menu taps stay in-canvas: `src/touch` converts `clientX/Y` with a fresh `canvas.getBoundingClientRect()` to game pixels and hit-tests a tap-target list that scenes register in `src/ui` (game-pixel rects plus a callback); this avoids Phaser pointer input entirely.

Sources:
- https://developer.apple.com/design/human-interface-guidelines/accessibility
- https://m3.material.io/foundations/designing/structure
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html
- `node_modules/phaser/src/scale/ScaleManager.js` (`refresh`, `updateBounds`, `transformX`)
- Viewport sizes: Playwright 1.64.1 device descriptors (`iPhone 15 landscape`, `Pixel 7 landscape`)

## 3. iOS Safari specifics

- No element fullscreen on iPhone: `Element.requestFullscreen` is iPad-only on iOS (16.4+), shows an overlay button that cannot be hidden, and a swipe down exits it, which MDN data calls unsuitable for games; `installFullscreen` already skips the button where the API is missing.
- Instead: Home Screen web app. Since iOS 26 every site added to the Home Screen opens as a web app by default, with no manifest or service worker required, but manifest icons and `display` are still used.
- The manifest `display: fullscreen` is not supported on iOS and falls back to `standalone`; `minimal-ui` is not supported either (and the old `minimal-ui` viewport keyword was removed in iOS 8).
- In landscape the iPhone status bar is hidden, so `standalone` is effectively fullscreen for us; add `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">` for portrait screens such as the rotate prompt.
- Detect "running as a web app" with `matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches` or `navigator.standalone`; do not rely on `display-mode: fullscreen` alone (WebKit reports it true in standalone apps, bug 264218).
- Show a one-time "Add to Home Screen for full screen" hint only on iPhone Safari tabs (coarse pointer, no Fullscreen API, not standalone); wording and placement are the director's.
- Safe areas: add `viewport-fit=cover` so `env(safe-area-inset-*)` is non-zero; iPhone landscape insets are roughly 47-59 px left and right and about 21 px at the bottom (home indicator).
- `fitCanvas` should fit the 16:9 canvas into the viewport minus the safe-area insets; on current iPhones the letterbox bars already exceed the insets, but iPads and future devices may not.
- Dynamic toolbar: in a Safari tab the page cannot scroll, so the toolbar stays shown and the viewport is smaller (734x343 for iPhone 15 landscape in Playwright's descriptor); keep `#app` as `position: fixed; inset: 0`, size from `innerWidth`/`innerHeight`, and also refit on `visualViewport` `resize`; `100dvh` is available (Safari 15.4+) if any CSS needs a height.
- Orientation: `ScreenOrientation.lock()` does not exist in Safari iOS and the manifest `orientation` member is ignored; show a pixel-art "rotate device" overlay via `@media (orientation: portrait)` on touch devices, and pause the race when the device turns to portrait mid-race.
- Audio unlock: per the HTML spec, activation-triggering events are `keydown`, `mousedown`, `pointerdown` from a mouse, `pointerup` from a non-mouse and `touchend`; so `unlockAudio()` must also run on `pointerup` and `touchend`, not on touch `pointerdown`.
- iOS can put the context into an `interrupted` state (calls, Siri, app switch); the engine resumes any state other than `running` or `closed` on input, on visibility and from a `statechange` listener (design 39.4).
- Web Audio follows the ring/silent switch by default; `navigator.audioSession.type = 'playback'` (Safari 16.4+) would override that, and we should not, because a muted phone should stay muted.
- Wake lock: `navigator.wakeLock` works in Safari iOS 18.4+ including Home Screen apps (fixed in 18.4), but every touch resets the auto-lock timer and races last under 30 s, so it buys nothing; skip it.
- Low Power Mode caps `requestAnimationFrame` and CSS animations at 30 fps on iOS (intended since iOS 14, WebKit bug 215745); Safari also caps rAF at 30 fps in cross-origin iframes until the user interacts (relevant only if embedded, for example on itch.io).
- Effect on our sim: none on results, because inputs carry their own timestamps and the 120 Hz accumulator catches up (each 33 ms frame runs 4 ticks, far below the 250 ms cap); the cost is up to 33 ms extra visual latency and choppier motion.

Sources:
- https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen
- https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/
- https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/display-mode
- https://bugs.webkit.org/show_bug.cgi?id=264218
- https://developer.mozilla.org/en-US/docs/Web/CSS/env
- https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
- https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock
- https://bugs.webkit.org/show_bug.cgi?id=257695
- https://html.spec.whatwg.org/multipage/interaction.html#activation-triggering-input-event
- https://developer.mozilla.org/en-US/docs/Web/API/AudioSession
- https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes
- https://bugs.webkit.org/show_bug.cgi?id=215745
- https://bugs.webkit.org/show_bug.cgi?id=211624

## 4. Android Chrome specifics

- Fullscreen: `document.documentElement.requestFullscreen({ navigationUI: 'hide' })` works (Chrome Android 71+) but needs transient user activation, so call it from a `pointerup` handler, not `pointerdown`.
- Then `await screen.orientation.lock('landscape')` inside `try/catch`; Chrome requires fullscreen (or an installed app) for `lock()`, and leaving fullscreen unlocks it.
- An installed PWA with manifest `display: fullscreen` and `orientation: landscape` opens fullscreen and landscape with no code.
- The existing corner fullscreen button only reveals on `mousemove`, which touch never produces here (Phaser `preventDefault`s canvas `touchend`, suppressing compatibility mouse events), so the touch layer needs its own fullscreen control, or a "tap to start" step on Android that enters fullscreen, locks landscape and unlocks audio in one gesture.
- System back gesture: still active in fullscreen; the first back exits fullscreen; see section 1 for edge insets.
- Haptics: `navigator.vibrate(ms)` works on Chrome Android only, requires prior user activation (returns `false` otherwise), and does nothing in cross-origin iframes.
- Vibration motors have tens of ms of spin-up, so a pulse per step at 8-14 steps per second blurs into a constant buzz and gives no timing information; use short single pulses (about 20-40 ms) on fumble and false start only, behind a settings toggle, feature-detected with `'vibrate' in navigator`.
- iOS has no `navigator.vibrate`; the only web haptic on iOS is the system tick when a user toggles an `<input type="checkbox" switch>` (Safari 18+), which cannot be fired programmatically; do not attempt it.

Sources:
- https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen
- https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock
- https://developer.chrome.com/docs/web-platform/screen-orientation-lock
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate
- https://developer.mozilla.org/en-US/docs/Web/API/UserActivation

## 5. PWA basics for a static Vercel site

- Manifest (generated by the plugin into `manifest.webmanifest`): `name` and `short_name` "Retro Runner", `id`, `start_url` and `scope` `"./"` (matches `base: './'`), `display: "fullscreen"`, `orientation: "landscape"`, `background_color` and `theme_color` `#0b0b14`, icons below.
- Icons: 192x192 and 512x512 `purpose: "any"`, 512x512 `purpose: "maskable"` (art inside the central 80 % safe zone), and a 180x180 `apple-touch-icon` link (iOS prefers it over manifest icons).
- Pixel-art icons: draw one 32x32 palette map and integer-upscale it with solid `#0b0b14` padding: 192 = 32x6; 512 = 32x16 (any) or 32x12 plus padding (maskable); 180 = 32x5 plus 10 px padding per side.
- Generate them with a small in-repo Node script using the existing `src/art` bake and `node:zlib` to write PNGs, and commit the PNGs to `public/icons/`; `@vite-pwa/assets-generator@2.0.0` resamples with smoothing and would blur the pixels.
- `<meta name="theme-color" content="#0b0b14">` colours the Android status bar and Safari chrome.
- Service worker: worth it, because Home Screen players expect the game to start offline and the whole game is a few static files; Chrome no longer needs a service worker for its install menu (since Chrome 108 on Android), so this is purely for offline and fast start.
- Use `vite-plugin-pwa@2.0.0` (supports Vite 8; v2 only widened the `@vite-pwa/assets-generator` peer range) with `strategies: 'generateSW'`, `registerType: 'prompt'`, `injectRegister: false`, `workbox.globPatterns` covering js, css, html, png, svg and font files, `navigateFallback: 'index.html'`, `cleanupOutdatedCaches: true`, and `devOptions.enabled: false`.
- Register from `main.ts` with `registerSW` from `virtual:pwa-register`, but not when `VITE_TEST_HOOKS === '1'`.
- Never auto-reload: a new version waits and takes over on the next cold launch; if wanted later, the Title screen can offer "update ready" via `onNeedRefresh`.
- A hand-written service worker was considered: it needs the hashed asset list from the build, which means writing a Vite plugin anyway, and update handling is where hand-rolled workers go wrong.
- Vercel: static files are already served with revalidation by default; add explicit headers so behaviour does not depend on defaults: `/assets/(.*)` -> `Cache-Control: public, max-age=31536000, immutable`, `/sw.js` -> `Cache-Control: no-cache`, `/manifest.webmanifest` -> `Content-Type: application/manifest+json`.

Sources:
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons
- https://web.dev/articles/maskable-icon
- https://developer.chrome.com/blog/update-install-criteria
- https://vite-pwa-org.netlify.app/guide/
- https://vite-pwa-org.netlify.app/guide/prompt-for-update
- https://github.com/vite-pwa/vite-plugin-pwa/releases
- https://www.npmjs.com/package/vite-plugin-pwa
- https://vercel.com/docs/project-configuration#headers
- https://vercel.com/docs/edge-cache

## 6. Testing

### What Playwright 1.64.1 offers

- `hasTouch` and `isMobile` come with device descriptors; `devices['Pixel 7 landscape']` (Chromium, 863x360, DPR 2.625) and `devices['iPhone 15 landscape']` (WebKit, 734x343, DPR 3) exist.
- The only public touch API is `page.touchscreen.tap(x, y)`: on Chromium it sends CDP `Input.dispatchTouchEvent` `touchStart` then `touchEnd`, on WebKit `Input.dispatchTapEvent`; there is no hold, no multi-touch and no timing control.
- Playwright's own touch guide dispatches untrusted `TouchEvent`s with `locator.dispatchEvent`; the same approach works for `PointerEvent`s and is what WebKit needs.
- Chromium only: a CDP session gives trusted multi-touch, which also generates real pointer events with distinct `pointerId`s.
- CDP rules: `touchStart` and `touchMove` carry the full list of active points, `touchEnd` and `touchCancel` carry none, and Chrome derives press, move and release per point by diffing against the previous list; so lifting one of two fingers is a `touchMove` listing only the remaining finger (verify in the first spike).
- CDP also accepts a `timestamp` per touch event; whether Chrome copies it into `event.timeStamp` is unverified, so do not build exact-ms E2E assertions on it.
- Desktop WebKit with a mobile user agent is not iOS Safari; safe areas, toolbars, Low Power Mode and Home Screen mode need a manual pass in the iOS Simulator and on a real iPhone and Android phone.
- Block service workers in E2E (`serviceWorkers: 'block'`) so the precache never serves a stale build.

### Config sketch

```ts
// playwright.config.ts (additions)
projects: [
  // existing desktop projects unchanged ...
  {
    name: 'mobile-chromium',
    testMatch: /touch\.spec\.ts/,
    use: { ...devices['Pixel 7 landscape'], serviceWorkers: 'block' },
  },
  {
    name: 'mobile-webkit',
    testMatch: /touch\.spec\.ts/,
    use: { ...devices['iPhone 15 landscape'], serviceWorkers: 'block' },
  },
],
```

### Helper sketches (`e2e/touchHelpers.ts`)

```ts
import type { CDPSession, Page } from '@playwright/test';

export type Control = 'L' | 'R' | 'jump' | 'pause';

export async function controlCenter(page: Page, c: Control): Promise<{ x: number; y: number }> {
  const box = await page.locator(`[data-touch="${c}"]`).boundingBox();
  if (!box) throw new Error(`touch control ${c} not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Chromium only: trusted multi-touch through CDP. Each finger keeps its id while down. */
export class Fingers {
  private readonly active = new Map<number, { x: number; y: number }>();
  private constructor(private readonly cdp: CDPSession) {}

  static async open(page: Page): Promise<Fingers> {
    return new Fingers(await page.context().newCDPSession(page));
  }

  async down(id: number, at: { x: number; y: number }): Promise<void> {
    this.active.set(id, at);
    await this.send('touchStart');
  }

  async up(id: number): Promise<void> {
    this.active.delete(id);
    await this.send(this.active.size > 0 ? 'touchMove' : 'touchEnd');
  }

  async cancelAll(): Promise<void> {
    this.active.clear();
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  }

  private async send(type: 'touchStart' | 'touchMove' | 'touchEnd'): Promise<void> {
    const touchPoints =
      type === 'touchEnd' ? [] : [...this.active].map(([id, p]) => ({ id, x: p.x, y: p.y }));
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  }
}

/**
 * Any engine: runs a timed pointer script inside the page, so gaps between events are set by the
 * page's own timers rather than by Playwright round trips. Events are untrusted, so the adapter must
 * not check isTrusted and must tolerate setPointerCapture throwing.
 */
export interface PointerStep {
  readonly waitMs: number;
  readonly type: 'pointerdown' | 'pointerup' | 'pointercancel';
  readonly control: Control;
  readonly pointerId: number;
}

export async function runPointerScript(page: Page, steps: readonly PointerStep[]): Promise<void> {
  await page.evaluate(async (script) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (const s of script) {
      if (s.waitMs > 0) await sleep(s.waitMs);
      const el = document.querySelector(`[data-touch="${s.control}"]`);
      if (!el) throw new Error(`no control ${s.control}`);
      const r = el.getBoundingClientRect();
      el.dispatchEvent(
        new PointerEvent(s.type, {
          pointerId: s.pointerId,
          pointerType: 'touch',
          isPrimary: s.pointerId === 1,
          bubbles: true,
          cancelable: true,
          clientX: r.x + r.width / 2,
          clientY: r.y + r.height / 2,
        }),
      );
    }
  }, steps);
}

/** One full tap of a run zone with a fresh finger id. */
export function tapSteps(control: Control, pointerId: number, gapMs: number): PointerStep[] {
  return [
    { waitMs: gapMs, type: 'pointerdown', control, pointerId },
    { waitMs: 0, type: 'pointerup', control, pointerId },
  ];
}
```

### Rule assertions over touch (reading `getState` from the existing test hook)

- Alternation: script `L, R, L, R` with 60 ms gaps; expect `race.expectedSide` to flip each time and `player.vMps > 0`.
- Fumble: `L, L` 60 ms apart; expect `hud.fumbles` to rise by one and `expectedSide` to stay `'R'`.
- Held side: finger 1 down on `L` (step), finger 2 taps `L` while finger 1 holds; expect no step and no fumble; lift finger 1, tap `R`, expect a step.
- Cancel releases: finger 1 down on `L` (step), `pointercancel` for finger 1, tap `R` (step), tap `L`; expect a step, which proves cancel emitted the `up`.
- Capture: Chromium `Fingers`, finger down on `L`, `touchMove` it into the `R` zone, lift; expect exactly one `L` step and no `R` step.
- Two thumbs: Chromium `Fingers`, finger 1 holds `R` from the previous step while finger 2 presses `L`; expect a step on press, not on release.
- 35 ms minimum: assert in Vitest on the pure mapper plus core, where timestamps are exact; E2E keeps gaps of 50 ms or more to stay non-flaky.
- Optional (UI owner): a test-hook ring buffer of the last 32 `RunKeyEvent`s the race received would let E2E assert exact `kind`/`side` sequences and monotonic `t`.
- Unit tests in Vitest (Node): the pure mapper takes `{ type, pointerId, control, t }` records and returns `RunKeyEvent[]`, covering cancel, `lostpointercapture` after `pointerup`, two fingers on one side, blur release, the timestamp guard and monotonic `t`.

Sources:
- https://playwright.dev/docs/emulation#devices
- https://playwright.dev/docs/api/class-touchscreen
- https://playwright.dev/docs/touch-events
- https://playwright.dev/docs/api/class-cdpsession
- https://playwright.dev/docs/service-workers-experimental
- https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchTouchEvent
- https://github.com/microsoft/playwright/issues/2903
- `node_modules/playwright-core/lib/coreBundle.js` (`RawTouchscreenImpl.tap`, WebKit `Input.dispatchTapEvent`)

## 7. Detecting touch vs keyboard users

- `(pointer: coarse)` describes the primary pointer and `(any-pointer: coarse)` any pointer; `(hover: none)` / `(any-hover: hover)` describe hover; all are supported in Safari iOS 9+ and Chrome Android 41-50+.
- Use `(pointer: coarse)` for the initial state: phones and plain tablets show controls, while touch laptops (`any-pointer: coarse` but `pointer: fine`) and iPads with a trackpad start without them.
- Then switch live on the last input modality: a `pointerdown` with `pointerType` `touch` or `pen` anywhere shows the controls; a `keydown` of any run or menu key hides them; mouse input changes nothing.
- Never switch modes mid-race in a way that drops held state: hiding the overlay must not detach its listeners until every tracked pointer is released.
- Keyboard and touch may both feed the same race; held state is per source and per side, which matches today's keyboard rule closely enough (design should state that mixing is allowed).
- A `?touch=1` / `?touch=0` query parameter forces the mode for debugging and E2E, because emulated media features differ between Playwright engines.
- HUD prompts that name keys (`hud.keys`) need touch wording when the overlay is shown; the touch layer should expose the current modality as `document.documentElement.dataset.input = 'touch' | 'keyboard'` and an event, so `src/ui` can read it without importing `src/touch`.

Sources:
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/pointer
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/any-pointer
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/any-hover
- https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/pointerType

## Proposed `src/touch/` layer

Owner: one implementation agent (TOUCH).
Dependency rule: `src/touch` may import `src/core` (types, input hub) and `src/ui` (tap-target registry, palette colours, `toggleFullscreen`); nothing in `src/core`, `src/ui`, `src/scenes`, `src/art` or `src/audio` imports `src/touch`; only `src/main.ts` does.
Add the reverse rule to ESLint `no-restricted-imports` next to the existing `src/core` rule.

```
src/touch/
  index.ts          installTouch({ game, canvas, unlockAudio }): { relayout(): void; detach(): void }
  modality.ts       pure reducer (initial media query, pointer/key events, ?touch= override) + DOM listeners;
                    sets <html data-input="touch|keyboard"> and dispatches 'retro-input-modality'
  layout.ts         pure: viewport, canvas rect, safe-area insets, game-pixel size -> rects for L, R, jump,
                    pause, fullscreen; enforces 44 CSS px minimum and edge insets
  pointerMap.ts     pure state machine: pointer records -> RunKeyEvent[] and jump action events
                    (capture, cancel, lostpointercapture, blur release, timestamp guard, monotonic t)
  overlay.ts        builds the DOM controls (buttons, data-touch attributes, aria, pixel SVG icons),
                    applies layout.ts rects, pressed-state classes
  adapter.ts        DOM listeners on the overlay (pointer*, contextmenu), setPointerCapture try/catch,
                    feeds pointerMap and emits through core's input hub
  menuTap.ts        canvas pointerup -> game pixels via getBoundingClientRect -> ui tap-target hit test
  platform.ts       rotate prompt, iOS Add to Home Screen hint, Android fullscreen + orientation lock,
                    haptics wrapper (fumble / false start pulses), pause on portrait
  touch.css         overlay, zones, buttons, rotate prompt; imported by index.ts (Vite bundles it)
  layout.test.ts, pointerMap.test.ts, modality.test.ts   Vitest, Node environment
e2e/
  touch.spec.ts, touchHelpers.ts                         mobile-chromium and mobile-webkit projects
scripts/
  icons.ts           32x32 pixel map -> public/icons/*.png (integer scale, committed output)
```

### Contracts other owners add (small, no import of touch)

- MECHANICS, `src/core/input/hub.ts` exported from `src/core/index.ts`: a pure `RunInputHub` with `emit(e: RunKeyEvent | ActionEvent)` and `subscribe(cb): () => void`, plus the new `ActionEvent { kind: 'down' | 'up'; action: 'jump'; t: number }` and its keyboard binding.
- UI, `src/scenes/RaceScene.ts`: subscribe the race to the hub next to `attachKeyboard` (one line), and unsubscribe on shutdown.
- UI, `src/ui/tapTargets.ts`: scenes register game-pixel rects with a callback (`focus item i and confirm`, `back`); scenes clear them on shutdown.
- UI, HUD: read `document.documentElement.dataset.input` to word the key prompts for touch.

### Minimal changes in `src/main.ts`

- Phaser config: `input: { keyboard: false, mouse: false, touch: false }`.
- `fitCanvas`: subtract `env(safe-area-inset-*)` (read once per fit from a probe element's computed padding) before calling `fitZoom`, set `--gp` (CSS px per game pixel) on `document.documentElement`, and call `touch.relayout()` at the end.
- Also refit on `visualViewport` `resize`.
- Call `unlockAudio()` from capture-phase `pointerup` and `touchend` listeners on `window`, in addition to `keydown`.
- After `READY`: `const touch = installTouch({ game, canvas, unlockAudio })`.
- PWA: `if (import.meta.env.VITE_TEST_HOOKS !== '1') registerSW({ immediate: true })` from `virtual:pwa-register`.

### Minimal changes in `index.html`

- Viewport: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />`.
- Add `<meta name="theme-color" content="#0b0b14" />`, `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />` and `<link rel="apple-touch-icon" href="./icons/apple-touch-icon-180.png" />` (the plugin injects the manifest link).
- On `html, body`: `touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;` (keep the existing `overscroll-behavior: none`).

### Other files

- `vite.config.ts`: add `VitePWA({...})` as in section 5.
- `vercel.json`: add the three `headers` entries from section 5.
- `playwright.config.ts`: add the two mobile projects from section 6.
- `package.json`: `vite-plugin-pwa@2.0.0` as an exact dev dependency.

### Open items for the director (`docs/design.md`)

- Zone geometry (halves of the screen vs pads in the letterbox bars), jump button side, pause position.
- Whether two fingers on the same side should count as "held" (current core rule) on touch.
- Tap-to-start screen on touch, the Add to Home Screen hint, the rotate prompt art, and the haptics setting default.
