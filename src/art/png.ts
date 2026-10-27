/**
 * Pure, synchronous PNG encoder for palette-indexed maps (no DOM, no node:zlib), so the DOM touch
 * overlay can get crisp data URLs at boot and Node scripts can write icons with the same code.
 *
 * Output: colour type 3 (indexed) with the master palette in PLTE and index 0 fully transparent in
 * tRNS, upscaled by an integer factor with nearest neighbour. Compression: zlib stream with one
 * fixed-Huffman deflate block and a small greedy LZ77 (upscaled pixel art is mostly runs and
 * repeated rows, which this handles well).
 */
import type { IndexMap } from './bake/index.ts';
import { PALETTE } from './palette.ts';

// ---------------------------------------------------------------------------
// Checksums
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + (bytes[i] as number)) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// ---------------------------------------------------------------------------
// Deflate (RFC 1951), fixed Huffman codes only.
// ---------------------------------------------------------------------------

class BitWriter {
  private buf = new Uint8Array(1024);
  private len = 0;
  private bits = 0;
  private nbits = 0;

  private push(byte: number): void {
    if (this.len === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = byte;
  }

  /** Write `n` bits of `v`, least significant bit first. */
  write(v: number, n: number): void {
    this.bits |= v << this.nbits;
    this.nbits += n;
    while (this.nbits >= 8) {
      this.push(this.bits & 0xff);
      this.bits >>>= 8;
      this.nbits -= 8;
    }
  }

  /** Write a Huffman code (`n` bits, most significant bit first). */
  code(c: number, n: number): void {
    let r = 0;
    for (let i = 0; i < n; i++) r = (r << 1) | ((c >> i) & 1);
    this.write(r, n);
  }

  finish(): Uint8Array {
    if (this.nbits > 0) this.push(this.bits & 0xff);
    this.bits = 0;
    this.nbits = 0;
    return this.buf.slice(0, this.len);
  }
}

const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195,
  227, 258,
];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097,
  6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];

function litLen(w: BitWriter, sym: number): void {
  if (sym < 144) w.code(0x30 + sym, 8);
  else if (sym < 256) w.code(0x190 + sym - 144, 9);
  else if (sym < 280) w.code(sym - 256, 7);
  else w.code(0xc0 + sym - 280, 8);
}

function findIndex(table: readonly number[], v: number): number {
  let i = table.length - 1;
  while ((table[i] as number) > v) i--;
  return i;
}

const WINDOW = 32768;
const MAX_MATCH = 258;
const MAX_CHAIN = 48;

export function deflateFixed(data: Uint8Array): Uint8Array {
  const w = new BitWriter();
  w.write(1, 1); // BFINAL
  w.write(1, 2); // BTYPE = 01 fixed Huffman
  const head = new Map<number, number>();
  const prev = new Int32Array(data.length).fill(-1);
  const key = (i: number) =>
    ((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number);
  const insert = (i: number) => {
    if (i + 2 >= data.length) return;
    const k = key(i);
    prev[i] = head.get(k) ?? -1;
    head.set(k, i);
  };
  let i = 0;
  while (i < data.length) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + 2 < data.length) {
      let cand = head.get(key(i)) ?? -1;
      let chain = 0;
      while (cand >= 0 && i - cand <= WINDOW && chain++ < MAX_CHAIN) {
        let l = 0;
        const max = Math.min(MAX_MATCH, data.length - i);
        while (l < max && data[cand + l] === data[i + l]) l++;
        if (l > bestLen) {
          bestLen = l;
          bestDist = i - cand;
          if (l === max) break;
        }
        cand = prev[cand] as number;
      }
    }
    if (bestLen >= 3) {
      const li = findIndex(LEN_BASE, bestLen);
      litLen(w, 257 + li);
      w.write(bestLen - (LEN_BASE[li] as number), LEN_EXTRA[li] as number);
      const di = findIndex(DIST_BASE, bestDist);
      w.code(di, 5);
      w.write(bestDist - (DIST_BASE[di] as number), DIST_EXTRA[di] as number);
      for (let k = 0; k < bestLen; k++) insert(i + k);
      i += bestLen;
    } else {
      litLen(w, data[i] as number);
      insert(i);
      i++;
    }
  }
  litLen(w, 256);
  return w.finish();
}

export function zlibFixed(data: Uint8Array): Uint8Array {
  const body = deflateFixed(data);
  const out = new Uint8Array(body.length + 6);
  out[0] = 0x78;
  out[1] = 0x01;
  out.set(body, 2);
  const a = adler32(data);
  out[out.length - 4] = (a >>> 24) & 0xff;
  out[out.length - 3] = (a >>> 16) & 0xff;
  out[out.length - 2] = (a >>> 8) & 0xff;
  out[out.length - 1] = a & 0xff;
  return out;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

function u32(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  out.set(u32(crc32(out, 4, 8 + data.length)), 8 + data.length);
  return out;
}

export interface PngOptions {
  /** Integer nearest-neighbour upscale (default 1). */
  readonly scale?: number;
  /** Fill transparent pixels with this palette index (opaque icons). */
  readonly background?: number;
  /** Output canvas size in px (square); the upscaled art is centred and the margin is `background`. */
  readonly canvas?: number;
}

/** Encode an index map as an indexed PNG (palette per design 5.2, index 0 transparent). */
export function encodeIndexedPng(map: IndexMap, opts: PngOptions = {}): Uint8Array {
  const k = opts.scale ?? 1;
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`png: scale must be a positive integer, got ${k}`);
  const W = opts.canvas ?? map.w * k;
  const H = opts.canvas ?? map.h * k;
  const ox = Math.floor((W - map.w * k) / 2);
  const oy = Math.floor((H - map.h * k) / 2);
  if (ox < 0 || oy < 0) throw new RangeError('png: canvas smaller than the scaled art');
  const bg = opts.background ?? 0;
  const raw = new Uint8Array((W + 1) * H);
  for (let y = 0; y < H; y++) {
    const row = y * (W + 1);
    raw[row] = 0; // filter: none
    const sy = Math.floor((y - oy) / k);
    for (let x = 0; x < W; x++) {
      const sx = Math.floor((x - ox) / k);
      const inArt = y >= oy && x >= ox && sy < map.h && sx < map.w;
      const v = inArt ? (map.data[sy * map.w + sx] as number) : 0;
      raw[row + 1 + x] = v === 0 ? bg : v;
    }
  }
  const ihdr = new Uint8Array([...u32(W), ...u32(H), 8, 3, 0, 0, 0]);
  const plte = new Uint8Array(PALETTE.length * 3);
  PALETTE.forEach((c, i) => {
    plte[i * 3] = (c >> 16) & 0xff;
    plte[i * 3 + 1] = (c >> 8) & 0xff;
    plte[i * 3 + 2] = c & 0xff;
  });
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    // Only index 0 is transparent; the rest default to opaque.
    ...(opts.background === undefined ? [chunk('tRNS', new Uint8Array([0]))] : []),
    chunk('IDAT', zlibFixed(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** `data:image/png;base64,...` for an encoded PNG (btoa exists in browsers and Node 16+). */
export function pngDataUrl(png: Uint8Array): string {
  let s = '';
  for (let i = 0; i < png.length; i += 0x8000) s += String.fromCharCode(...png.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(s)}`;
}
