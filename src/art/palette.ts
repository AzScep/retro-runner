/**
 * Master palette, design 5.2. Index 0 is transparent and never drawn.
 * Pure module (no Phaser) so the bake step, tests and tools/art can use it.
 */

/** 0xRRGGBB per index. Index 0 is a placeholder for "transparent". */
export const PALETTE: readonly number[] = Object.freeze([
  0x000000, // 0 transparent
  0x0b0b14, // 1 ink outline
  0x1d1b2e, // 2 ink deep shadow / UI panel
  0x2e2a45, // 3 ink shadow on dark
  0x4a4766, // 4 neutral metal shadow
  0x6e6b8c, // 5 neutral metal base
  0x9b98b3, // 6 neutral metal light
  0xc9c7d9, // 7 neutral light grey
  0xf4f2ff, // 8 neutral white
  0x4a2a1a, // 9 skin darkest
  0x7a4a2c, // 10 skin dark
  0xb0774a, // 11 skin mid
  0xdda67a, // 12 skin light
  0xf7d3ae, // 13 skin lightest
  0x2b1a12, // 14 hair dark
  0x5a3a22, // 15 hair brown
  0x6b1525, // 16 red shadow
  0xb02a32, // 17 red base
  0xe8503f, // 18 red light
  0xff8f6b, // 19 red highlight
  0xa85a12, // 20 orange shadow
  0xe89a1c, // 21 orange base
  0xffd23f, // 22 yellow
  0xfff1a8, // 23 pale yellow
  0x18402a, // 24 green shadow
  0x2e7a3a, // 25 grass base
  0x5dbb46, // 26 grass light
  0xa6e86b, // 27 green highlight
  0x142a5c, // 28 navy
  0x2456b8, // 29 blue base
  0x4b8df0, // 30 sky
  0x9cd2ff, // 31 sky light
  0x3b1d5c, // 32 purple shadow
  0x6e2fa0, // 33 purple base
  0xb05ce0, // 34 purple light
  0x0f4a4a, // 35 teal shadow
  0x1fa38f, // 36 teal base
  0x6ef2c2, // 37 teal glow
  0x5c2a1e, // 38 tartan shadow
  0x8f3f2a, // 39 tartan base
  0xc4613c, // 40 tartan light
  0xff7aa8, // 41 sunset pink
  0x0a1430, // 42 space black-blue
]);

export const PALETTE_SIZE = PALETTE.length; // 43 including transparent

/** Named indices for readability in art code. */
export const C = {
  CLEAR: 0,
  INK: 1,
  INK2: 2,
  INK3: 3,
  GREY4: 4,
  GREY5: 5,
  GREY6: 6,
  GREY7: 7,
  WHITE: 8,
  SKIN9: 9,
  SKIN10: 10,
  SKIN11: 11,
  SKIN12: 12,
  SKIN13: 13,
  HAIR14: 14,
  HAIR15: 15,
  RED16: 16,
  RED17: 17,
  RED18: 18,
  RED19: 19,
  ORA20: 20,
  ORA21: 21,
  YEL22: 22,
  YEL23: 23,
  GRN24: 24,
  GRN25: 25,
  GRN26: 26,
  GRN27: 27,
  BLU28: 28,
  BLU29: 29,
  BLU30: 30,
  BLU31: 31,
  PUR32: 32,
  PUR33: 33,
  PUR34: 34,
  TEA35: 35,
  TEA36: 36,
  TEA37: 37,
  TAR38: 38,
  TAR39: 39,
  TAR40: 40,
  PINK41: 41,
  SPACE42: 42,
} as const;

/**
 * Darkest tone of the material ramp each index belongs to (design 5.3 selective outline and
 * 5.4 interior lines). Index 0 maps to 0.
 */
export const RAMP_DARKEST: readonly number[] = Object.freeze([
  0, // 0
  1,
  1,
  1, // ink
  4,
  4,
  4,
  4,
  4, // neutral 4-8
  9,
  9,
  9,
  9,
  9, // skin 9-13
  14,
  14, // hair
  16,
  16,
  16,
  16, // red
  20,
  20,
  20,
  20, // yellow/orange
  24,
  24,
  24,
  24, // green
  28,
  28,
  28,
  28, // blue
  32,
  32,
  32, // purple
  35,
  35,
  35, // teal
  38,
  38,
  38, // tartan
  16, // pink -> red shadow
  1, // space
]);

export function isPaletteIndex(i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < PALETTE_SIZE;
}

/** Palette index -> 0xRRGGBB. Throws on an invalid index so bad art data fails loudly. */
export function paletteColor(index: number): number {
  if (!isPaletteIndex(index)) throw new RangeError(`palette index out of range: ${index}`);
  return PALETTE[index] as number;
}
