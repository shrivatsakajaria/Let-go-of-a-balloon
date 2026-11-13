import { LINK_POINTS } from '../config';
import { lonDelta, wrapLon, type LatLon } from '../geo/coords';

/** A released balloon, as stored locally and as encoded in a link. `release` is UTC milliseconds. */
export type SavedBalloon = {
  v: 1;
  name: string;
  start: LatLon;
  release: number;
  hourly: LatLon[];
  runId: string;
  /** Stable id for the local store; computed on add, never part of a link. */
  id?: string;
};

export class BadLinkError extends Error {
  constructor(message = 'bad balloon link') {
    super(message);
    this.name = 'BadLinkError';
  }
}

const VERSION = 1;
const QUANT = 1e4; // 1e-4 degrees, about 11 m
const MAX_NAME_BYTES = 80;
const MAX_RUNID_BYTES = 64;
const MAX_RAW_BYTES = 4096;
const MAX_MINUTES = 0xffffffff;

// ---- varints ---------------------------------------------------------------

class Writer {
  bytes: number[] = [];
  byte(n: number) { this.bytes.push(n & 0xff); }
  uvar(n: number) {
    while (n >= 0x80) {
      this.bytes.push((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    this.bytes.push(n);
  }
  svar(n: number) { this.uvar(n >= 0 ? n * 2 : -n * 2 - 1); }
  u32(n: number) { for (let s = 24; s >= 0; s -= 8) this.byte(Math.floor(n / 2 ** s)); }
  str(b: Uint8Array) { this.uvar(b.length); for (const x of b) this.bytes.push(x); }
}

class Reader {
  i = 0;
  constructor(readonly b: Uint8Array) {}
  byte(): number {
    if (this.i >= this.b.length) throw new BadLinkError('truncated');
    return this.b[this.i++];
  }
  uvar(): number {
    let n = 0;
    let mul = 1;
    for (let k = 0; k < 7; k++) {
      const x = this.byte();
      n += (x & 0x7f) * mul;
      if (x < 0x80) return n;
      mul *= 0x80;
    }
    throw new BadLinkError('varint too long');
  }
  svar(): number {
    const z = this.uvar();
    return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
  }
  u32(): number {
    let n = 0;
    for (let k = 0; k < 4; k++) n = n * 256 + this.byte();
    return n;
  }
  take(n: number): Uint8Array {
    if (n < 0 || this.i + n > this.b.length) throw new BadLinkError('truncated');
    const out = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return out;
  }
  get done() { return this.i === this.b.length; }
}

// ---- helpers ---------------------------------------------------------------

/** UTF-8 of s, cut to at most maxBytes on a code point boundary. */
function utf8Capped(s: string, maxBytes: number): Uint8Array {
  const enc = new TextEncoder();
  let out = '';
  let used = 0;
  for (const ch of s) {
    const n = enc.encode(ch).length;
    if (used + n > maxBytes) break;
    out += ch;
    used += n;
  }
  return enc.encode(out);
}

const q = (deg: number): number => Math.round(deg * QUANT);

async function pump(input: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  // Errors surface through the readable side; swallow them here to avoid unhandled rejections.
  w.write(input as BufferSource).then(() => w.close()).catch(() => {});
  const r = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await r.cancel().catch(() => {});
      throw new BadLinkError('payload too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) throw new BadLinkError('not base64url');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- public API ------------------------------------------------------------

/**
 * The share link for an encoded payload. The payload sits in the fragment, which the browser never
 * sends to a server, so the route and start point stay out of server logs and link-preview crawlers.
 */
export function linkFor(payload: string): string {
  return `/#b=${payload}`;
}

/** The payload of a share link: the `#b=` fragment, or the legacy `?b=` query. Null when there is none. */
export function payloadFromLocation(loc: { hash: string; search: string }): string | null {
  return new URLSearchParams(loc.hash.replace(/^#/, '')).get('b') ?? new URLSearchParams(loc.search).get('b');
}

/**
 * Encode a balloon as a base64url string.
 * Layout (before deflate-raw): version, name (len + UTF-8, <= 80 bytes), runId (len + bytes),
 * release minutes u32, start lat/lon and hourly[0] as signed varints at 1e-4 deg, then hourly
 * 1..72 as signed varint deltas of the quantised values (longitude unwrapped via lonDelta).
 */
export async function encodeBalloon(b: SavedBalloon): Promise<string> {
  if (b.hourly.length !== LINK_POINTS) throw new RangeError(`a balloon link holds ${LINK_POINTS} points, not ${b.hourly.length}`);
  for (const p of [b.start, ...b.hourly]) {
    if (!(Math.abs(p.lat) <= 90) || !Number.isFinite(p.lon)) throw new RangeError('latitude must be within 90 degrees and longitude finite');
  }
  const w = new Writer();
  w.byte(b.v);
  w.str(utf8Capped(b.name, MAX_NAME_BYTES));
  w.str(utf8Capped(b.runId, MAX_RUNID_BYTES));
  w.u32(Math.min(MAX_MINUTES, Math.max(0, Math.round(b.release / 60000))));
  w.svar(q(b.start.lat));
  w.svar(q(b.start.lon));
  let prevLat = 0;
  let prevLon = 0; // quantised, unwrapped
  let trueLon = 0; // unwrapped, unquantised
  b.hourly.forEach((p, i) => {
    trueLon = i === 0 ? p.lon : trueLon + lonDelta(b.hourly[i - 1].lon, p.lon);
    const qLat = q(p.lat);
    const qLon = q(trueLon);
    if (i === 0) {
      w.svar(qLat);
      w.svar(qLon);
    } else {
      w.svar(qLat - prevLat);
      w.svar(qLon - prevLon);
    }
    prevLat = qLat;
    prevLon = qLon;
  });
  const packed = await pump(Uint8Array.from(w.bytes), new CompressionStream('deflate-raw'));
  return toBase64Url(packed);
}

/** Decode a payload from encodeBalloon; rejects with BadLinkError for anything malformed. */
export async function decodeBalloon(payload: string): Promise<SavedBalloon> {
  try {
    const packed = fromBase64Url(payload);
    let raw: Uint8Array;
    try {
      raw = await pump(packed, new DecompressionStream('deflate-raw'), MAX_RAW_BYTES);
    } catch (e) {
      throw e instanceof BadLinkError ? e : new BadLinkError('cannot decompress');
    }
    const r = new Reader(raw);
    if (r.byte() !== VERSION) throw new BadLinkError('unknown version');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(r.take(r.uvar()));
    const runId = new TextDecoder('utf-8', { fatal: true }).decode(r.take(r.uvar()));
    if (new TextEncoder().encode(name).length > MAX_NAME_BYTES) throw new BadLinkError('name too long');
    const release = r.u32() * 60000;
    const start = { lat: r.svar() / QUANT, lon: wrapLon(r.svar() / QUANT) };
    let lat = 0;
    let lon = 0;
    const hourly: LatLon[] = [];
    for (let i = 0; i < LINK_POINTS; i++) {
      lat += r.svar();
      lon += r.svar();
      hourly.push({ lat: lat / QUANT, lon: wrapLon(lon / QUANT) });
    }
    if (!r.done) throw new BadLinkError('trailing data');
    for (const p of [start, ...hourly]) {
      if (!(Math.abs(p.lat) <= 90) || !Number.isFinite(p.lon)) throw new BadLinkError('bad coordinates');
    }
    return { v: 1, name, start, release, hourly, runId };
  } catch (e) {
    throw e instanceof BadLinkError ? e : new BadLinkError('cannot read link');
  }
}
