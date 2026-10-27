/**
 * Everything the game draws, baked to one RGBA atlas page plus the texture, frame, animation and
 * anchor tables that describe it (research 3). Pure, no Phaser and no DOM, so it runs in the bake
 * worker (bake.worker.ts) or inline; phaser/textures.ts uploads the result.
 *
 * Every map shares one page so the renderer binds a single texture for all art: Phaser 4 compiles
 * one shader variant per distinct texture count in a batch, and ~120 separate textures meant new
 * variants (50-450 ms stalls) appearing mid-race.
 */
import { packAtlas, writeRGBA } from './bake/atlas.ts';
import { packSheet, type IndexMap, type SheetRect } from './bake/index.ts';
import { buildCharacter, CHARACTER_IDS, type CharFrame } from './chars/index.ts';
import type { Anchors } from './chars/rig.ts';
import type { SpecId } from './chars/specs.ts';
import { buildField, FIELD_BODIES, FIELD_VARIANTS, fieldSpec, type FieldBody } from './chars/field.ts';
import {
  BEAM_FRAMES,
  BEAM_FPS,
  BUBBLE_CORNER,
  BUBBLE_PIECES,
  landingBeam,
  medal,
  MEDAL_PLACES,
  medalPip,
  meetBadge,
  MEET_TIERS,
  speechBubble,
  speechBubbleTail,
} from './sprites/meets.ts';
import {
  JUDGE_COUNT,
  JUDGE_FRAMES,
  judge,
  judgeBench,
  photoCamera,
  pistolSmoke,
  SMOKE_FPS,
  starter,
  STARTER_FRAMES,
  starterHelmet,
} from './stadium/officials.ts';
import { buildEffects } from './sprites/effects.ts';
import { eventPictogram, PICTOGRAM_EVENTS } from './sprites/events.ts';
import {
  buildIcon,
  ICON_NAMES,
  keyIcon,
  rotatePhone,
  type IconName,
  type KeyState,
} from './sprites/icons.ts';
import { lockedPortrait, portrait16, portrait16Spec, portrait48 } from './sprites/portraits.ts';
import {
  distanceBoard,
  farLayer,
  fgLayer,
  finishLine,
  groundShadow,
  nearLayer,
  SIGN_EVENTS,
  skyLayer,
  standsLayer,
  startLine,
  TIERS,
  trackLayer,
} from './stadium/layers.ts';
import {
  AIR_SHADOW_SIZES,
  airShadow,
  bellOfficial,
  board50,
  HURDLE_KNOCK_FPS,
  hurdleKnockFrames,
  hurdleStanding,
  splitBoard,
} from './stadium/props.ts';

/** 400 m small boards (design 14.3): every 50 m except the large split boards at 100/200/300. */
export const BOARD50_M = [50, 150, 250, 350] as const;
export const SPLIT_BOARD_M = [100, 200, 300] as const;

export const KEYS = {
  char: (id: string) => `char.${id}`,
  anim: (id: string, name: string) => `${id}.${name}`,
  fx: 'fx',
  fxAnim: (name: string) => `fx.${name}`,
  portrait: (id: string, size: number, locked: boolean) => `portrait.${id}.${size}${locked ? '.locked' : ''}`,
  icon: (id: string) => `icon.${id}`,
  key: (side: 'L' | 'R' | 'U', state: KeyState) => `key.${side}.${state}`,
  /** Rotate-phone frame textures (frame 0 is `icon.rotatePhone`) and their 4-frame animation. */
  rotatePhoneFrame: (i: number) => (i === 0 ? 'icon.rotatePhone' : `icon.rotatePhone.${i}`),
  rotatePhoneAnim: 'icon.rotatePhone',
  event: (event: string, size: number, locked: boolean) => `event.${event}.${size}${locked ? '.locked' : ''}`,
  hurdle: 'prop.hurdle',
  hurdleKnockAnim: 'prop.hurdle.knock',
  bell: 'prop.bell',
  bellAnim: 'prop.bell.ring',
  board50: (m: number) => `stadium.board50.${m}`,
  split: (m: number) => `stadium.split.${m}`,
  airShadow: (i: number) => (i === 0 ? 'stadium.shadow' : `stadium.shadow.${i}`),
  layer: (tier: number, name: string) => `stadium.${tier}.${name}`,
  /** Event-specific signage layers ('far', 'near'); the 100 m uses the plain layer key. */
  signLayer: (tier: number, name: 'far' | 'near', event: string) =>
    event === '100m' ? `stadium.${tier}.${name}` : `stadium.${tier}.${name}.${event}`,
  finish: 'stadium.finish',
  board: (m: number) => `stadium.board.${m}`,
  shadow: 'stadium.shadow',
  atlas: 'art.atlas',
  // v3 (design 35)
  /** The second atlas page: every field runner frame (design 26.5, 35.1). */
  atlasField: 'art.atlas.field',
  fieldChar: (body: string, variant: string) => `fchar.${body}.${variant}`,
  fieldAnim: (body: string, variant: string, name: string) => `${body}.${variant}.${name}`,
  fieldPortrait: (body: string, variant: string) => `portrait.${body}.${variant}.16`,
  starter: 'prop.starter',
  starterIdleAnim: 'prop.starter.idle',
  starterHelmet: 'prop.starter.helmet',
  smoke: 'prop.smoke',
  smokeAnim: 'prop.smoke.puff',
  judge: (v: number) => `prop.judge.${v}`,
  judgeSitAnim: (v: number) => `prop.judge.${v}.sit`,
  bench: 'prop.bench',
  photo: 'prop.photo',
  meet: (tier: number) => `meet.${tier}`,
  medalPip: (place: number) => `medal.pip.${place}`,
  medal: (place: number) => `medal.${place}`,
  bubble: 'ui.bubble',
  bubbleTail: 'ui.bubble.tail',
  beam: 'fx.beam',
  beamAnim: 'fx.beam.shimmer',
} as const;

/** One texture key: its rect on the page and its named frames (relative to that rect). */
export interface BakedTexture {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly frames: readonly SheetRect[];
  /** Index into BakedArt.pages. */
  readonly page: number;
}

export interface BakedAnim {
  readonly key: string;
  /** Texture key plus frame name; no frame means the texture's own (`__BASE`) frame. */
  readonly frames: readonly { readonly key: string; readonly frame?: string }[];
  readonly fps: number;
  readonly repeat: number;
  readonly repeatDelay?: number;
}

export interface BakedPage {
  /** Phaser texture key of the page's GL texture. */
  readonly key: string;
  /** RGBA8, `w` x `h`. */
  readonly data: Uint8Array<ArrayBuffer>;
  readonly w: number;
  readonly h: number;
}

export interface BakedArt {
  /**
   * Page 0 holds everything but the field runners; page 1 holds the field (design 26.5: a race binds
   * at most these 2 pages).
   */
  readonly pages: readonly BakedPage[];
  readonly textures: readonly BakedTexture[];
  readonly anims: readonly BakedAnim[];
  /** Overlay anchors per `${characterId}/${frame}`. */
  readonly anchors: readonly (readonly [string, Anchors])[];
}

/** The page is 2048 px wide (every WebGL implementation supports it) and as tall as needed. */
const ATLAS_WIDTH = 2048;
/** Design 35.1: the field page is at most 2048 x 1024. */
export const FIELD_PAGE_MAX = { w: 2048, h: 1024 } as const;
/** Field frames per grid row: 42 x 48 = 2016 px, so one body (4 variants x 31 frames) is 3 rows. */
const FIELD_COLS = 42;

/** Everything: both pages (tests, tools and the inline fallback). */
export function bakeArt(): BakedArt {
  return mergeBaked(bakeMain(), bakeField());
}

/** Combines the main and field bakes (each from its own worker) into one BakedArt. */
export function mergeBaked(main: BakedArt, field: BakedArt): BakedArt {
  return {
    pages: [...main.pages, ...field.pages],
    textures: [...main.textures, ...field.textures],
    anims: [...main.anims, ...field.anims],
    anchors: [...main.anchors, ...field.anchors],
  };
}

/** Page 0: all art except the field runners. */
export function bakeMain(): BakedArt {
  const maps: { key: string; map: IndexMap; frames: readonly SheetRect[] }[] = [];
  const add = (key: string, map: IndexMap, frames: readonly SheetRect[] = []): void => {
    maps.push({ key, map, frames });
  };
  const anims: BakedAnim[] = [];
  const anim = (
    key: string,
    texture: string,
    frames: readonly string[],
    fps: number,
    repeat: number,
  ): void => {
    anims.push({ key, frames: frames.map((frame) => ({ key: texture, frame })), fps, repeat });
  };
  const anchors: [string, Anchors][] = [];

  for (const id of CHARACTER_IDS) {
    const art = buildCharacter(id);
    const key = KEYS.char(id);
    const sheet = packSheet(
      art.frames.map((f: CharFrame) => ({ name: f.name, map: f.map })),
      8,
    );
    add(key, sheet.map, sheet.rects);
    for (const f of art.frames) anchors.push([`${id}/${f.name}`, f.anchors]);
    for (const a of art.anims) anim(KEYS.anim(id, a.name), key, a.frames, a.fps, a.repeat);
    for (const size of [16, 48] as const) {
      const p = size === 16 ? portrait16(id as SpecId) : portrait48(id as SpecId);
      add(KEYS.portrait(id, size, false), p);
      add(KEYS.portrait(id, size, true), lockedPortrait(p));
    }
  }

  const fx = buildEffects();
  const fxFrames = fx.flatMap((d) => d.frames.map((map, i) => ({ name: `${d.name}${i}`, map })));
  const fxSheet = packSheet(fxFrames, 8);
  add(KEYS.fx, fxSheet.map, fxSheet.rects);
  for (const d of fx) {
    anim(
      KEYS.fxAnim(d.name),
      KEYS.fx,
      d.frames.map((_, i) => `${d.name}${i}`),
      d.fps,
      d.repeat,
    );
  }

  for (const name of ICON_NAMES) add(KEYS.icon(name), buildIcon(name as IconName));
  for (let i = 1; i < 4; i++) add(KEYS.rotatePhoneFrame(i), rotatePhone(i));
  anims.push({
    key: KEYS.rotatePhoneAnim,
    frames: [0, 1, 2, 3].map((i) => ({ key: KEYS.rotatePhoneFrame(i) })),
    fps: 4,
    repeat: -1,
    repeatDelay: 600,
  });
  for (const event of PICTOGRAM_EVENTS) {
    for (const size of [16, 32] as const) {
      for (const locked of [false, true])
        add(KEYS.event(event, size, locked), eventPictogram(event, size, locked));
    }
  }
  for (const side of ['L', 'R', 'U'] as const) {
    for (const state of ['dim', 'bright', 'wrong'] as const) add(KEYS.key(side, state), keyIcon(side, state));
  }

  for (const tier of TIERS) {
    add(KEYS.layer(tier, 'sky'), skyLayer(tier));
    for (const ev of SIGN_EVENTS) {
      add(KEYS.signLayer(tier, 'far', ev), farLayer(tier, ev));
      add(KEYS.signLayer(tier, 'near', ev), nearLayer(tier, ev));
    }
    add(KEYS.layer(tier, 'stands0'), standsLayer(tier, 0));
    add(KEYS.layer(tier, 'stands1'), standsLayer(tier, 1));
    add(KEYS.layer(tier, 'track'), trackLayer(tier));
    add(KEYS.layer(tier, 'fg'), fgLayer(tier));
    add(KEYS.layer(tier, 'start'), startLine(tier));
  }
  add(KEYS.finish, finishLine());
  for (let m = 10; m <= 100; m += 10) add(KEYS.board(m), distanceBoard(m));
  for (const m of BOARD50_M) add(KEYS.board50(m), board50(m));
  for (const m of SPLIT_BOARD_M) add(KEYS.split(m), splitBoard(m));

  // Hurdle: frame 'stand' plus 'knock0'..'knock3' (the last one lying), one 40x28 cell each.
  const hurdle = packSheet(
    [
      { name: 'stand', map: hurdleStanding() },
      ...hurdleKnockFrames().map((map, i) => ({ name: `knock${i}`, map })),
    ],
    5,
  );
  add(KEYS.hurdle, hurdle.map, hurdle.rects);
  anim(KEYS.hurdleKnockAnim, KEYS.hurdle, ['knock0', 'knock1', 'knock2', 'knock3'], HURDLE_KNOCK_FPS, 0);
  const bell = packSheet(
    [
      { name: 'f0', map: bellOfficial(0) },
      { name: 'f1', map: bellOfficial(1) },
    ],
    2,
  );
  add(KEYS.bell, bell.map, bell.rects);
  anim(KEYS.bellAnim, KEYS.bell, ['f1', 'f0'], 6, -1);
  for (let i = 1; i < AIR_SHADOW_SIZES.length; i++) add(KEYS.airShadow(i), airShadow(i));
  add(KEYS.shadow, groundShadow());

  // v3 officials (design 31.2, 31.3, 35.2).
  const st = packSheet(
    STARTER_FRAMES.map((name) => ({ name, map: starter(name) })),
    STARTER_FRAMES.length,
  );
  add(KEYS.starter, st.map, st.rects);
  anim(KEYS.starterIdleAnim, KEYS.starter, ['idle0', 'idle1'], 2, -1);
  add(KEYS.starterHelmet, starterHelmet());
  const smoke = packSheet(
    pistolSmoke().map((map, i) => ({ name: `s${i}`, map })),
    3,
  );
  add(KEYS.smoke, smoke.map, smoke.rects);
  anim(KEYS.smokeAnim, KEYS.smoke, ['s0', 's1', 's2'], SMOKE_FPS, 0);
  for (let v = 0; v < JUDGE_COUNT; v++) {
    const j = packSheet(
      JUDGE_FRAMES.map((name) => ({ name, map: judge(v, name) })),
      JUDGE_FRAMES.length,
    );
    add(KEYS.judge(v), j.map, j.rects);
    anim(KEYS.judgeSitAnim(v), KEYS.judge(v), ['sit0', 'sit1'], 2, -1);
  }
  add(KEYS.bench, judgeBench());
  const photo = packSheet(
    [
      { name: 'off', map: photoCamera(false) },
      { name: 'on', map: photoCamera(true) },
    ],
    2,
  );
  add(KEYS.photo, photo.map, photo.rects);

  // v3 UI art (design 31.1, 35.3) and the reveal beam (30.2).
  for (const tier of MEET_TIERS) add(KEYS.meet(tier), meetBadge(tier));
  for (const p of MEDAL_PLACES) {
    add(KEYS.medalPip(p), medalPip(p));
    add(KEYS.medal(p), medal(p));
  }
  const c = BUBBLE_CORNER;
  add(
    KEYS.bubble,
    speechBubble(),
    BUBBLE_PIECES.map((name, i) => ({ name, x: (i % 3) * c, y: Math.floor(i / 3) * c, w: c, h: c })),
  );
  add(KEYS.bubbleTail, speechBubbleTail());
  const beam = packSheet(
    [
      ...Array.from({ length: BEAM_FRAMES }, (_, i) => ({ name: `b${i}`, map: landingBeam(i) })),
      { name: 'static', map: landingBeam('static') },
    ],
    BEAM_FRAMES + 1,
  );
  add(KEYS.beam, beam.map, beam.rects);
  anim(
    KEYS.beamAnim,
    KEYS.beam,
    Array.from({ length: BEAM_FRAMES }, (_, i) => `b${i}`),
    BEAM_FPS,
    -1,
  );
  // Field portraits live on the main page (results table, design 35.1).
  for (const body of FIELD_BODIES) {
    for (const v of FIELD_VARIANTS) add(KEYS.fieldPortrait(body, v), portrait16Spec(fieldSpec(body, v)));
  }

  const layout = packAtlas(
    maps.map((m) => m.map),
    ATLAS_WIDTH,
  );
  const page = new Uint8Array(layout.w * layout.h * 4);
  const textures = maps.map((m, i): BakedTexture => {
    const { x, y } = layout.slots[i]!;
    writeRGBA(page, layout.w, m.map, x, y);
    return { key: m.key, x, y, w: m.map.w, h: m.map.h, frames: m.frames, page: 0 };
  });

  return { pages: [{ key: KEYS.atlas, data: page, w: layout.w, h: layout.h }], textures, anims, anchors };
}

/**
 * The field page (design 35.1): one 42-column grid of 48x48 frames, body after body, each body's 4
 * variants back to back (124 frames = 3 rows). Every variant is its own texture key whose rect is
 * its body's band and whose frames are its own 31.
 */
export function bakeField(): BakedArt {
  return joinFieldParts(FIELD_PARTS.map((bodies) => bakeFieldPart(bodies)));
}

/**
 * The field bodies split in two halves of similar bake cost, one per worker (field.worker.ts), so
 * the field page bakes in about the time of the main page.
 */
export const FIELD_PARTS: readonly (readonly FieldBody[])[] = [
  ['fKid', 'fTeen', 'fStudent', 'fClub'],
  ['fElite', 'fBot', 'fDrone'],
];

/** One part of the field page: its bodies' bands, stacked from y 0. */
export function bakeFieldPart(bodies: readonly FieldBody[]): BakedArt {
  const anims: BakedAnim[] = [];
  const bands = bodies.map((body) => {
    const frames: { name: string; map: IndexMap }[] = [];
    const arts = FIELD_VARIANTS.map((v) => buildField(body, v));
    for (const art of arts)
      for (const f of art.frames) frames.push({ name: `${art.variant}:${f.name}`, map: f.map });
    return { body, arts, sheet: packSheet(frames, FIELD_COLS) };
  });
  const layout = packAtlas(
    bands.map((b) => b.sheet.map),
    ATLAS_WIDTH,
  );
  const data = new Uint8Array(layout.w * layout.h * 4);
  const textures: BakedTexture[] = [];
  bands.forEach((b, i) => {
    const { x, y } = layout.slots[i]!;
    writeRGBA(data, layout.w, b.sheet.map, x, y);
    for (const art of b.arts) {
      const key = KEYS.fieldChar(b.body, art.variant);
      const prefix = `${art.variant}:`;
      const frames = b.sheet.rects
        .filter((r) => r.name.startsWith(prefix))
        .map((r) => ({ ...r, name: r.name.slice(prefix.length) }));
      textures.push({ key, x, y, w: b.sheet.map.w, h: b.sheet.map.h, frames, page: 1 });
      for (const a of art.anims) {
        anims.push({
          key: KEYS.fieldAnim(b.body, art.variant, a.name),
          frames: a.frames.map((frame) => ({ key, frame })),
          fps: a.fps,
          repeat: a.repeat,
        });
      }
    }
  });
  return { pages: [{ key: KEYS.atlasField, data, w: layout.w, h: layout.h }], textures, anims, anchors: [] };
}

/** Stacks field parts into one page (1 px gap between parts), shifting each part's rects down. */
export function joinFieldParts(parts: readonly BakedArt[]): BakedArt {
  const w = Math.max(...parts.map((p) => p.pages[0]!.w));
  const h = parts.reduce((sum, p) => sum + p.pages[0]!.h, parts.length - 1);
  const data = new Uint8Array(w * h * 4);
  const textures: BakedTexture[] = [];
  let y0 = 0;
  for (const part of parts) {
    const pg = part.pages[0]!;
    for (let y = 0; y < pg.h; y++)
      data.set(pg.data.subarray(y * pg.w * 4, (y + 1) * pg.w * 4), (y0 + y) * w * 4);
    for (const t of part.textures) textures.push({ ...t, y: t.y + y0 });
    y0 += pg.h + 1;
  }
  return {
    pages: [{ key: KEYS.atlasField, data, w, h }],
    textures,
    anims: parts.flatMap((p) => p.anims),
    anchors: [],
  };
}
