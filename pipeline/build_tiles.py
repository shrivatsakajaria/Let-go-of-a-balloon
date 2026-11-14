"""Turn a GFS run into small gzipped binary wind tiles for the browser.

Usage:
    python pipeline/build_tiles.py --run latest --store .winds-store --out dist/winds

Output (inside --out):
    manifest.json                                  newest four complete runs, newest first
    climb/<run>/<lat0>_<lon0>.bin.gz               5 deg tiles at 0.25 deg, hours 3..24, land only
    climb/<run>/tiles.json                         names of the climb tiles that exist
    cruise/<run>/<lat0>_<lon0>_<window>.bin.gz     20 deg tiles at 1 deg, 24 h windows 0..4 (to f120)

Runs are built into --store (kept between workflow runs by actions/cache) and copied to
--out. A run directory in the store is complete only once its run.json exists. If the new
run cannot be downloaded, the manifest is still written from the runs already in the store.

Tile binary layout (little-endian, packed; mirrored in src/wind/format.ts):
    char[4] 'WIND', uint8 version=1, uint8 nLevels, uint8 nHours, uint16 nLat, uint16 nLon,
    float32 lat0, lon0, res, scale, int16 levels[nLevels], int16 hours[nHours],
    then for each hour, for each level: int8 u[nLat*nLon], int8 v[nLat*nLon], int16 gh[nLat*nLon].
Rows run south -> north from lat0, columns west -> east from lon0. u and v are in units of
`scale` m/s (clipped to +-127), gh in metres.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import shutil
import struct
import sys
import time
import traceback
from dataclasses import dataclass
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gfs_fetch  # noqa: E402

VERSION = 1
MAGIC = b'WIND'
HEADER = struct.Struct('<4sBBBHHffff')  # 27 bytes, packed

CLIMB_LEVELS = [1000, 975, 950, 925, 900, 850]
CRUISE_LEVELS = [850, 800, 750, 700, 600, 500]
RUN_HOURS = list(range(0, gfs_fetch.LAST_HOUR + 1, 3))  # 0..120: a run carries a whole flight for 48 h
CLIMB_HOURS = list(range(3, 25, 3))
CLIMB = {'tileDeg': 5, 'res': 0.25, 'hours': CLIMB_HOURS, 'scale': 0.5}
CRUISE = {'tileDeg': 20, 'res': 1.0, 'windowHours': 24, 'scale': 1.0}
N_WINDOWS = gfs_fetch.LAST_HOUR // 24
KEEP_RUNS = 4
RUN_ID = re.compile(r'^\d{10}$')


# --- binary format ---------------------------------------------------------------------

def encode_tile(lat0, lon0, res, scale, levels, hours, u, v, gh) -> bytes:
    """Encode (hour, level, lat, lon) float fields into the uncompressed tile binary."""
    u, v, gh = (np.asarray(a, dtype=np.float64) for a in (u, v, gh))
    n_h, n_l, n_lat, n_lon = u.shape
    if v.shape != u.shape or gh.shape != u.shape or (n_h, n_l) != (len(hours), len(levels)):
        raise ValueError('field shapes do not match hours x levels')

    def q8(a):
        return np.clip(np.rint(np.nan_to_num(a / scale)), -127, 127).astype(np.int8)

    uq, vq = q8(u), q8(v)
    gq = np.clip(np.rint(np.nan_to_num(gh)), -32768, 32767).astype('<i2')
    parts = [HEADER.pack(MAGIC, VERSION, n_l, n_h, n_lat, n_lon, lat0, lon0, res, scale),
             np.asarray(levels, '<i2').tobytes(), np.asarray(hours, '<i2').tobytes()]
    for h in range(n_h):
        for lv in range(n_l):
            parts += [uq[h, lv].tobytes(), vq[h, lv].tobytes(), gq[h, lv].tobytes()]
    return b''.join(parts)


@dataclass
class Tile:
    version: int
    lat0: float
    lon0: float
    res: float
    scale: float
    levels: np.ndarray
    hours: np.ndarray
    u: np.ndarray   # m/s, (hour, level, lat, lon)
    v: np.ndarray   # m/s
    gh: np.ndarray  # metres (int16)


def decode_tile(buf: bytes) -> Tile:
    magic, version, n_l, n_h, n_lat, n_lon, lat0, lon0, res, scale = HEADER.unpack_from(buf, 0)
    if magic != MAGIC or version != VERSION:
        raise ValueError(f'not a v{VERSION} wind tile: {magic!r} v{version}')
    off = HEADER.size
    levels = np.frombuffer(buf, '<i2', n_l, off); off += 2 * n_l
    hours = np.frombuffer(buf, '<i2', n_h, off); off += 2 * n_h
    n = n_lat * n_lon
    if len(buf) != off + n_h * n_l * 4 * n:
        raise ValueError('tile length does not match its header')
    u = np.empty((n_h, n_l, n_lat, n_lon), np.int8)
    v = np.empty_like(u)
    gh = np.empty((n_h, n_l, n_lat, n_lon), np.int16)
    for h in range(n_h):
        for lv in range(n_l):
            u[h, lv] = np.frombuffer(buf, np.int8, n, off).reshape(n_lat, n_lon); off += n
            v[h, lv] = np.frombuffer(buf, np.int8, n, off).reshape(n_lat, n_lon); off += n
            gh[h, lv] = np.frombuffer(buf, '<i2', n, off).reshape(n_lat, n_lon); off += 2 * n
    return Tile(version, lat0, lon0, res, scale, levels.copy(), hours.copy(),
                u.astype(np.float32) * scale, v.astype(np.float32) * scale, gh)


# --- tiling ----------------------------------------------------------------------------

@dataclass(frozen=True)
class TileSlice:
    """Edges of a tile in degrees (inclusive) and its index range on the global tile grid."""
    lat_start: float
    lat_stop: float
    lon_start: float
    lon_stop: float
    res: float

    @property
    def rows(self) -> slice:
        return slice(round((self.lat_start + 90) / self.res), round((self.lat_stop + 90) / self.res) + 1)

    @property
    def cols(self) -> slice:
        return slice(round((self.lon_start + 180) / self.res), round((self.lon_stop + 180) / self.res) + 1)


def tile_slice(lat0: float, lon0: float, tile_deg: float, res: float) -> TileSlice:
    """Neighbouring tiles share their edge row and column (21 x 21 points for 20 deg at 1 deg)."""
    return TileSlice(lat0, lat0 + tile_deg, lon0, lon0 + tile_deg, res)


def tile_origins(tile_deg: int) -> list[tuple[int, int]]:
    return [(lat0, lon0) for lat0 in range(-90, 90, tile_deg) for lon0 in range(-180, 180, tile_deg)]


def tile_names(tile_deg: int) -> list[str]:
    """`<lat0>_<lon0>` (south-west corner, integer degrees) for every tile on the globe."""
    return [f'{lat0}_{lon0}' for lat0, lon0 in tile_origins(tile_deg)]


def land_tile_names(land: np.ndarray, tile_deg: int, res: float) -> list[str]:
    """Tiles with at least one land point (land fraction > 0), edges included."""
    is_land = np.nan_to_num(land) > 0
    out = []
    for lat0, lon0 in tile_origins(tile_deg):
        s = tile_slice(lat0, lon0, tile_deg, res)
        if is_land[s.rows, s.cols].any():
            out.append(f'{lat0}_{lon0}')
    return out


def window_hours(w: int) -> list[int]:
    """Cruise window w holds hours 24w .. 24w+24 inclusive (9 steps)."""
    return list(range(24 * w, 24 * w + 25, 3))


def run_entry(run_id: str) -> dict:
    issued = f'{run_id[:4]}-{run_id[4:6]}-{run_id[6:8]}T{run_id[8:10]}:00:00Z'
    return {'id': run_id, 'issued': issued, 'hours': RUN_HOURS,
            'climb': dict(CLIMB), 'cruise': dict(CRUISE)}


# --- building a run --------------------------------------------------------------------

def _write_tile(path: Path, lat0, lon0, res, scale, levels, hours, fields, h_idx, s: TileSlice):
    # Slice space first (a view), then pick hours: indexing hours first would copy the globe.
    sub = [fields[k][:, :, s.rows, s.cols][h_idx] for k in ('u', 'v', 'gh')]
    buf = encode_tile(lat0, lon0, res, scale, levels, hours, *sub)
    path.write_bytes(gzip.compress(buf, compresslevel=9, mtime=0))


def build_run(run_id: str, store: Path, fetch=None, fetch_land=None, workers: int = 12) -> Path:
    """Download one run and write all its tiles into store/<run_id>/ (atomically)."""
    fetch = fetch or gfs_fetch.fetch_fields
    fetch_land = fetch_land or gfs_fetch.fetch_land
    store = Path(store)
    tmp = store / f'{run_id}.partial'
    shutil.rmtree(tmp, ignore_errors=True)
    (tmp / 'cruise').mkdir(parents=True)
    (tmp / 'climb').mkdir()

    t0 = time.time()
    gfs_fetch.log(f'Run {run_id}: cruise (1p00)')
    fields = fetch(run_id, RUN_HOURS, CRUISE_LEVELS, '1p00', workers=workers)
    for lat0, lon0 in tile_origins(CRUISE['tileDeg']):
        s = tile_slice(lat0, lon0, CRUISE['tileDeg'], CRUISE['res'])
        for w in range(N_WINDOWS):
            hours = window_hours(w)
            h_idx = [RUN_HOURS.index(h) for h in hours]
            _write_tile(tmp / 'cruise' / f'{lat0}_{lon0}_{w}.bin.gz', lat0, lon0, CRUISE['res'],
                        CRUISE['scale'], CRUISE_LEVELS, hours, fields, h_idx, s)
    del fields

    gfs_fetch.log(f'Run {run_id}: climb (0p25)')
    names = land_tile_names(fetch_land(run_id), CLIMB['tileDeg'], CLIMB['res'])
    fields = fetch(run_id, CLIMB_HOURS, CLIMB_LEVELS, '0p25', workers=workers)
    h_idx = list(range(len(CLIMB_HOURS)))
    for name in names:
        lat0, lon0 = (int(x) for x in name.split('_'))
        s = tile_slice(lat0, lon0, CLIMB['tileDeg'], CLIMB['res'])
        _write_tile(tmp / 'climb' / f'{name}.bin.gz', lat0, lon0, CLIMB['res'], CLIMB['scale'],
                    CLIMB_LEVELS, CLIMB_HOURS, fields, h_idx, s)
    del fields
    (tmp / 'climb' / 'tiles.json').write_text(json.dumps(names))

    (tmp / 'run.json').write_text(json.dumps(run_entry(run_id)))  # marks the run complete
    final = store / run_id
    shutil.rmtree(final, ignore_errors=True)
    os.replace(tmp, final)
    gfs_fetch.log(f'Run {run_id}: {len(names)} climb + {N_WINDOWS * len(tile_names(CRUISE["tileDeg"]))} '
                  f'cruise tiles in {time.time() - t0:.0f} s')
    return final


# --- store and output ------------------------------------------------------------------

def complete_runs(store: Path) -> list[str]:
    """Run ids in the store that finished building, newest first."""
    store = Path(store)
    if not store.is_dir():
        return []
    ids = [p.name for p in store.iterdir()
           if p.is_dir() and RUN_ID.match(p.name) and (p / 'run.json').is_file()]
    return sorted(ids, reverse=True)


def prune_store(store: Path, keep: int = KEEP_RUNS) -> None:
    """Keep only the newest `keep` complete runs; drop partial builds and anything else."""
    store = Path(store)
    if not store.is_dir():
        return
    keep_ids = set(complete_runs(store)[:keep])
    for p in store.iterdir():
        if p.is_dir() and p.name not in keep_ids:
            shutil.rmtree(p)


def publish(store: Path, out: Path) -> list[str]:
    """Copy the store's complete runs to `out` and write manifest.json (newest first)."""
    store, out = Path(store), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for product in ('climb', 'cruise'):
        shutil.rmtree(out / product, ignore_errors=True)
    ids = complete_runs(store)
    runs = []
    for run_id in ids:
        for product in ('climb', 'cruise'):
            shutil.copytree(store / run_id / product, out / product / run_id)
        runs.append(json.loads((store / run_id / 'run.json').read_text()))
    (out / 'manifest.json').write_text(json.dumps({'runs': runs}, separators=(',', ':')))
    return ids


def _dir_stats(path: Path) -> tuple[int, int]:
    files = [p for p in Path(path).rglob('*') if p.is_file()]
    return len(files), sum(p.stat().st_size for p in files)


def main(run_id: str = 'latest', out_dir: str | Path = 'dist/winds',
         store: str | Path = '.winds-store', keep: int = KEEP_RUNS, workers: int = 12) -> int:
    """Add `run_id` (or the latest ready run) to the store, prune, publish to `out_dir`.

    Returns 0 when at least one run was published (even if the new one failed to download),
    1 when there is nothing to publish.
    """
    store, out = Path(store), Path(out_dir)
    store.mkdir(parents=True, exist_ok=True)
    try:
        if run_id == 'latest':
            run_id = gfs_fetch.latest_run()
            gfs_fetch.log(f'Latest ready GFS run: {run_id}')
        if not RUN_ID.match(run_id):
            raise ValueError(f'bad run id {run_id!r}')
        if run_id in complete_runs(store):
            gfs_fetch.log(f'Run {run_id} is already in the store')
        else:
            build_run(run_id, store, workers=workers)
    except Exception as e:  # keep serving cached runs
        traceback.print_exc()
        print(f'::warning title=Wind pipeline::Could not build GFS run {run_id}: {e}. '
              'Publishing the cached runs instead.', flush=True)
    prune_store(store, keep)
    ids = publish(store, out)
    for product in ('climb', 'cruise'):
        for run in ids:
            n, size = _dir_stats(out / product / run)
            gfs_fetch.log(f'  {product}/{run}: {n} files, {size / 1e6:.1f} MB')
    gfs_fetch.log(f'Manifest runs: {ids or "none"}')
    gh_out = os.environ.get('GITHUB_OUTPUT')
    if gh_out:
        with open(gh_out, 'a') as f:
            f.write(f'newest={ids[0] if ids else ""}\n')
    gh_summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if gh_summary:
        with open(gh_summary, 'a') as f:
            f.write(f'## Winds\n\nPublished GFS runs (newest first): {", ".join(ids) or "none"}\n')
    if not ids:
        print('::error title=Wind pipeline::No complete wind run to publish.', flush=True)
        return 1
    return 0


def cli(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--run', default='latest', help="'latest' or YYYYMMDDHH")
    ap.add_argument('--store', default='.winds-store', help='directory that keeps built runs')
    ap.add_argument('--out', default='dist/winds', help='publish directory')
    ap.add_argument('--keep', type=int, default=KEEP_RUNS)
    ap.add_argument('--workers', type=int, default=12)
    a = ap.parse_args(argv)
    return main(a.run, a.out, store=a.store, keep=a.keep, workers=a.workers)


if __name__ == '__main__':
    sys.exit(cli())
