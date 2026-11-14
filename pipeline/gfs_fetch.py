"""Fetch only the GFS wind fields we need from NOAA's public S3 bucket.

For each forecast file we read the small `.idx` text index, find the byte ranges of the
wanted messages (e.g. `UGRD:850 mb`) and download just those with HTTP Range requests,
in parallel. Messages are decoded with ecCodes and returned on the tile grid:
rows south -> north from -90, columns west -> east from -180 to +180 inclusive
(the +180 column duplicates -180).
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import sys
import time
import urllib.error
import urllib.request

import numpy as np

BUCKET = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com'
PRODUCT_RES = {'0p25': 0.25, '1p00': 1.0}
# GRIB short names ecCodes reports for each idx variable (used to double-check the ranges).
SHORT_NAMES = {'UGRD': 'u', 'VGRD': 'v', 'HGT': 'gh', 'LAND': 'lsm'}
FIELD_KEYS = {'UGRD': 'u', 'VGRD': 'v', 'HGT': 'gh'}
USER_AGENT = 'let-go-of-a-balloon-wind-pipeline/1'
# Last forecast hour the site needs (R59): a run is used until it is 48 h old, and a flight lasts
# 72 h, so 48 + 72 = 120. A run is ready once its f120 files exist.
LAST_HOUR = 120


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def file_url(run_id: str, product: str, hour: int) -> str:
    day, cyc = run_id[:8], run_id[8:10]
    return f'{BUCKET}/gfs.{day}/{cyc}/atmos/gfs.t{cyc}z.pgrb2.{product}.f{hour:03d}'


# --- HTTP ------------------------------------------------------------------------------

def http_get(url: str, byte_range: tuple[int, int | None] | None = None,
             retries: int = 5, timeout: float = 60.0) -> bytes:
    """GET with optional byte range, retrying with exponential backoff."""
    headers = {'User-Agent': USER_AGENT}
    if byte_range is not None:
        start, end = byte_range
        headers['Range'] = f'bytes={start}-' + ('' if end is None else str(end))
    delay = 1.0
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
                if byte_range is not None:
                    if resp.status != 206:
                        raise OSError(f'expected 206 for ranged GET, got {resp.status}')
                    start, end = byte_range
                    if end is not None and len(data) != end - start + 1:
                        raise OSError(f'short read: {len(data)} of {end - start + 1} bytes')
                return data
        except urllib.error.HTTPError as e:
            if e.code == 404 or attempt == retries - 1:
                raise
            err: Exception = e
        except (OSError, TimeoutError) as e:
            if attempt == retries - 1:
                raise
            err = e
        log(f'  retry {attempt + 1} for {url.rsplit("/", 1)[-1]}: {err}')
        time.sleep(delay)
        delay *= 2
    raise AssertionError('unreachable')


def http_exists(url: str, timeout: float = 20.0) -> bool:
    try:
        req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200
    except (urllib.error.URLError, OSError):
        return False


# --- idx parsing -----------------------------------------------------------------------

def parse_idx(text: str) -> list[tuple[int, str, str]]:
    """Parse idx lines `n:offset:d=YYYYMMDDHH:VAR:LEVEL:FCST:` into (offset, var, level)."""
    entries = []
    for line in text.splitlines():
        parts = line.split(':')
        if len(parts) < 5 or not parts[1].isdigit():
            continue
        entries.append((int(parts[1]), parts[3], parts[4]))
    return entries


def select_ranges(entries: list[tuple[int, str, str]],
                  wanted: list[tuple[str, str]]) -> dict[tuple[str, str], tuple[int, int | None]]:
    """Byte range (start, end inclusive; None = to end of file) for each wanted (var, level).

    The end byte is the next message's offset minus one. Raises KeyError if one is missing.
    """
    out: dict[tuple[str, str], tuple[int, int | None]] = {}
    want = set(wanted)
    for k, (offset, var, level) in enumerate(entries):
        key = (var, level)
        if key not in want or key in out:
            continue
        end = None
        for nxt, _, _ in entries[k + 1:]:
            if nxt > offset:
                end = nxt - 1
                break
        out[key] = (offset, end)
    missing = [k for k in wanted if k not in out]
    if missing:
        raise KeyError(f'not in idx: {missing}')
    return out


# --- grids -----------------------------------------------------------------------------

def to_global_grid(values: np.ndarray, lat_first: float, lat_last: float,
                   lon_first: float, res: float) -> np.ndarray:
    """Reorder a global regular lat/lon field (nLat, nLon) to the tile grid.

    Output rows go south -> north from -90; columns west -> east from -180 to +180
    inclusive, so the last column duplicates the first.
    """
    nlat, nlon = values.shape
    if abs(nlon * res - 360) > 1e-6 or abs(abs(lat_last - lat_first) - 180) > 1e-6:
        raise ValueError(f'expected a global grid, got {values.shape} at {res} deg')
    if lat_first > lat_last:
        values = values[::-1]
    target = -180 + res * np.arange(nlon + 1)
    cols = np.rint(((target - lon_first) % 360) / res).astype(np.int64) % nlon
    return values[:, cols]


def decode_message(data: bytes, expect_short_name: str | None = None,
                   expect_level: int | None = None) -> np.ndarray:
    """Decode one GRIB2 message to the tile grid (float32)."""
    import eccodes  # imported lazily so the unit tests do not need the library

    gid = eccodes.codes_new_from_message(data)
    try:
        short = eccodes.codes_get(gid, 'shortName')
        if expect_short_name is not None and short != expect_short_name:
            raise ValueError(f'expected {expect_short_name}, got {short}')
        if expect_level is not None and eccodes.codes_get(gid, 'level') != expect_level:
            raise ValueError(f'expected level {expect_level}, got {eccodes.codes_get(gid, "level")}')
        ni, nj = eccodes.codes_get(gid, 'Ni'), eccodes.codes_get(gid, 'Nj')
        res = eccodes.codes_get(gid, 'iDirectionIncrementInDegrees')
        lat1 = eccodes.codes_get(gid, 'latitudeOfFirstGridPointInDegrees')
        lat2 = eccodes.codes_get(gid, 'latitudeOfLastGridPointInDegrees')
        lon1 = eccodes.codes_get(gid, 'longitudeOfFirstGridPointInDegrees')
        vals = eccodes.codes_get_values(gid).astype(np.float32)
        if eccodes.codes_get(gid, 'bitmapPresent'):
            missing = eccodes.codes_get(gid, 'missingValue')
            vals[vals == missing] = np.nan
    finally:
        eccodes.codes_release(gid)
    return to_global_grid(vals.reshape(nj, ni), lat1, lat2, lon1, res)


# --- fetching --------------------------------------------------------------------------

def _download_messages(url: str, wanted: list[tuple[str, str]],
                       pool: cf.Executor) -> dict[tuple[str, str], cf.Future]:
    idx = http_get(url + '.idx').decode('ascii', 'replace')
    ranges = select_ranges(parse_idx(idx), wanted)
    return {k: pool.submit(http_get, url, r) for k, r in ranges.items()}


def fetch_fields(run_id: str, hours: list[int], levels: list[int], product: str,
                 workers: int = 12) -> dict[str, np.ndarray]:
    """Download UGRD, VGRD and HGT at `levels` hPa for each forecast hour.

    Returns {'u', 'v', 'gh'} float32 arrays shaped (hour, level, lat, lon) on the tile grid
    (see `to_global_grid`). (A plain dict instead of an xarray.Dataset: lighter, and the
    grid is fully described by `product`.)
    """
    res = PRODUCT_RES[product]
    nlat, nlon = int(round(180 / res)) + 1, int(round(360 / res)) + 1
    out = {k: np.empty((len(hours), len(levels), nlat, nlon), np.float32) for k in ('u', 'v', 'gh')}
    wanted = [(var, f'{lev} mb') for lev in levels for var in FIELD_KEYS]
    t0 = time.time()
    with cf.ThreadPoolExecutor(workers) as pool:
        idx_jobs = {h: pool.submit(_download_messages, file_url(run_id, product, h), wanted, pool)
                    for h in hours}
        nbytes = 0
        for hi, h in enumerate(hours):
            msgs = idx_jobs.pop(h).result()  # pop so downloaded bytes are freed as we go
            for (var, level), fut in msgs.items():
                data = fut.result()
                nbytes += len(data)
                lev = int(level.split()[0])
                out[FIELD_KEYS[var]][hi, levels.index(lev)] = decode_message(data, SHORT_NAMES[var], lev)
    log(f'  {product}: {len(hours)} hours x {len(wanted)} messages, '
        f'{nbytes / 1e6:.1f} MB in {time.time() - t0:.0f} s')
    return out


def fetch_land(run_id: str, workers: int = 4) -> np.ndarray:
    """GFS land mask (LAND:surface, 0..1) from the 0.25 degree f003 file, on the tile grid."""
    url = file_url(run_id, '0p25', 3)
    with cf.ThreadPoolExecutor(workers) as pool:
        msgs = _download_messages(url, [('LAND', 'surface')], pool)
        data = msgs[('LAND', 'surface')].result()
    return decode_message(data, SHORT_NAMES['LAND'])


def run_is_ready(run_id: str) -> bool:
    """A run is ready when both products have the index of their last needed hour (f120)."""
    return all(http_exists(file_url(run_id, p, LAST_HOUR) + '.idx') for p in ('1p00', '0p25'))


def latest_run(now: dt.datetime | None = None, lookback_cycles: int = 8) -> str:
    """Newest GFS run whose f120 files exist (checks back two days)."""
    now = now or dt.datetime.now(dt.timezone.utc)
    t = now.replace(minute=0, second=0, microsecond=0, hour=now.hour - now.hour % 6)
    for _ in range(lookback_cycles):
        run_id = t.strftime('%Y%m%d%H')
        if run_is_ready(run_id):
            return run_id
        t -= dt.timedelta(hours=6)
    raise RuntimeError(f'no GFS run with f{LAST_HOUR:03d} found in the last two days')
