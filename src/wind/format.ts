// Wind tile binary format, written by pipeline/build_tiles.py (encode_tile).
// Little-endian and packed (no padding):
//   char[4] 'WIND', uint8 version, uint8 nLevels, uint8 nHours, uint16 nLat, uint16 nLon,
//   float32 lat0, lon0, res, scale, int16 levels[nLevels], int16 hours[nHours],
//   then for each hour, for each level: int8 u[nLat*nLon], int8 v[nLat*nLon], int16 gh[nLat*nLon].
// Rows run south -> north from lat0, columns west -> east from lon0. u and v are in units of
// `scale` m/s; gh is geopotential height in metres. Files are served gzipped (.bin.gz).

export const TILE_HEADER = {
  MAGIC: 'WIND',
  VERSION: 1,
  /** Bytes before the levels array. */
  FIXED_BYTES: 27,
  OFFSET: {
    magic: 0,
    version: 4,
    nLevels: 5,
    nHours: 6,
    nLat: 7,
    nLon: 9,
    lat0: 11,
    lon0: 15,
    res: 19,
    scale: 23,
  },
} as const;

export interface WindTile {
  version: number;
  nLevels: number;
  nHours: number;
  nLat: number;
  nLon: number;
  lat0: number;
  lon0: number;
  res: number;
  scale: number;
  levels: number[];
  hours: number[];
  /** Raw units (multiply by `scale` for m/s), flat [hour][level][lat][lon]. */
  u: Int8Array;
  v: Int8Array;
  /** Metres, flat [hour][level][lat][lon]. */
  gh: Int16Array;
}

/** Total header size (fixed part plus the levels and hours arrays). */
export function headerBytes(nLevels: number, nHours: number): number {
  return TILE_HEADER.FIXED_BYTES + 2 * (nLevels + nHours);
}

/** Flat index into u, v or gh. i is the row (south -> north), j the column (west -> east). */
export function windIndex(t: WindTile, hourIdx: number, levelIdx: number, i: number, j: number): number {
  return ((hourIdx * t.nLevels + levelIdx) * t.nLat + i) * t.nLon + j;
}

/** Decode an uncompressed tile. Data is copied out, since int16 values may be unaligned. */
export function decodeTile(buf: ArrayBuffer): WindTile {
  const dv = new DataView(buf);
  const O = TILE_HEADER.OFFSET;
  if (buf.byteLength < TILE_HEADER.FIXED_BYTES) throw new Error('wind tile: too short');
  const magic = String.fromCharCode(
    dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3),
  );
  if (magic !== TILE_HEADER.MAGIC) throw new Error(`wind tile: bad magic "${magic}"`);
  const version = dv.getUint8(O.version);
  if (version !== TILE_HEADER.VERSION) throw new Error(`wind tile: unsupported version ${version}`);

  const nLevels = dv.getUint8(O.nLevels);
  const nHours = dv.getUint8(O.nHours);
  const nLat = dv.getUint16(O.nLat, true);
  const nLon = dv.getUint16(O.nLon, true);
  const n = nLat * nLon;
  let off = headerBytes(nLevels, nHours);
  const expected = off + nHours * nLevels * 4 * n;
  if (buf.byteLength !== expected) {
    throw new Error(`wind tile: ${buf.byteLength} bytes, header says ${expected}`);
  }

  const levels: number[] = [];
  const hours: number[] = [];
  for (let k = 0; k < nLevels; k++) levels.push(dv.getInt16(TILE_HEADER.FIXED_BYTES + 2 * k, true));
  for (let k = 0; k < nHours; k++) hours.push(dv.getInt16(TILE_HEADER.FIXED_BYTES + 2 * (nLevels + k), true));

  const total = nHours * nLevels * n;
  const u = new Int8Array(total);
  const v = new Int8Array(total);
  const gh = new Int16Array(total);
  const bytes = new Int8Array(buf);
  for (let block = 0; block < nHours * nLevels; block++) {
    const base = block * n;
    u.set(bytes.subarray(off, off + n), base);
    off += n;
    v.set(bytes.subarray(off, off + n), base);
    off += n;
    for (let k = 0; k < n; k++) gh[base + k] = dv.getInt16(off + 2 * k, true);
    off += 2 * n;
  }

  return {
    version,
    nLevels,
    nHours,
    nLat,
    nLon,
    lat0: dv.getFloat32(O.lat0, true),
    lon0: dv.getFloat32(O.lon0, true),
    res: dv.getFloat32(O.res, true),
    scale: dv.getFloat32(O.scale, true),
    levels,
    hours,
    u,
    v,
    gh,
  };
}
