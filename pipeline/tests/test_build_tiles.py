import gzip
import json
import re
from pathlib import Path

import numpy as np
import pytest

import build_tiles
import gfs_fetch
from build_tiles import decode_tile, encode_tile, tile_names, tile_slice
from gfs_fetch import parse_idx, select_ranges, to_global_grid

REPO = Path(__file__).resolve().parents[2]


# --- The brief's four tests, verbatim -------------------------------------------------

def test_round_trip_quantisation():
    u = np.full((21,21), 12.3); v = np.full((21,21), -7.6); gh = np.full((21,21), 1487.0)
    buf = encode_tile(lat0=40, lon0=-20, res=1.0, scale=0.5, levels=[850], hours=[0], u=u[None,None], v=v[None,None], gh=gh[None,None])
    t = decode_tile(buf)
    assert abs(t.u[0,0,5,5] - 12.5) < 0.26 and abs(t.v[0,0,5,5] + 7.5) < 0.26 and t.gh[0,0,5,5] == 1487

def test_values_beyond_range_clip_not_wrap():
    t = decode_tile(encode_tile(lat0=0, lon0=0, res=1.0, scale=1.0, levels=[500], hours=[0], u=np.full((1,1,2,2), 150.0), v=np.zeros((1,1,2,2)), gh=np.zeros((1,1,2,2))))
    assert t.u.max() == 127

def test_tiles_cover_globe_and_wrap():
    names = tile_names(tile_deg=20)
    # Brief had '80_160', which cannot coexist with 9 rows of 20 deg from -90 and south-west-corner
    # keys (R14): lat0 runs -90, -70, ..., 70. The north-east tile is therefore '70_160'.
    assert len(names) == 9*18 and '70_160' in names and '-90_-180' in names

def test_tile_edges_overlap_one_cell():
    # neighbouring tiles share their edge row/column so the browser never samples a gap
    a, b = tile_slice(0, 0, 20, 1.0), tile_slice(0, 20, 20, 1.0)
    assert a.lon_stop == b.lon_start


# --- Extras ----------------------------------------------------------------------------

def test_header_is_packed_little_endian():
    buf = encode_tile(lat0=-10, lon0=170, res=0.25, scale=0.5, levels=[850, 500], hours=[3, 6],
                      u=np.zeros((2, 2, 3, 4)), v=np.zeros((2, 2, 3, 4)), gh=np.zeros((2, 2, 3, 4)))
    assert buf[:4] == b'WIND' and buf[4] == 1 and buf[5] == 2 and buf[6] == 2
    assert buf[7:9] == (3).to_bytes(2, 'little') and buf[9:11] == (4).to_bytes(2, 'little')
    header = 27 + 2 * 2 + 2 * 2
    assert len(buf) == header + 2 * 2 * (12 + 12 + 24)
    assert buf[27:29] == (850).to_bytes(2, 'little')


def test_negative_winds_clip_and_round():
    u = np.array([-200.0, -0.24, 0.26, 63.6]).reshape(1, 1, 2, 2)
    t = decode_tile(encode_tile(lat0=0, lon0=0, res=1.0, scale=0.5, levels=[500], hours=[0],
                                u=u, v=np.zeros_like(u), gh=np.full_like(u, 40000.0)))
    assert t.u.ravel().tolist() == [-63.5, 0.0, 0.5, 63.5]
    assert t.gh.max() == 32767  # int16 clip, not wrap


def test_decode_rejects_bad_magic():
    buf = bytearray(encode_tile(lat0=0, lon0=0, res=1.0, scale=1.0, levels=[500], hours=[0],
                                u=np.zeros((1, 1, 2, 2)), v=np.zeros((1, 1, 2, 2)), gh=np.zeros((1, 1, 2, 2))))
    buf[0:4] = b'HTML'
    with pytest.raises(ValueError):
        decode_tile(bytes(buf))


def test_cruise_windows_are_inclusive_24h():
    assert build_tiles.window_hours(0) == [0, 3, 6, 9, 12, 15, 18, 21, 24]
    assert build_tiles.window_hours(3) == [72, 75, 78, 81, 84, 87, 90, 93, 96]
    assert build_tiles.window_hours(4) == [96, 99, 102, 105, 108, 111, 114, 117, 120]
    assert all(len(build_tiles.window_hours(w)) == 9 for w in range(5))


def test_runs_reach_f120_so_a_run_carries_a_whole_flight_for_48_h():
    """R59: the site uses a run up to 48 h old, so its winds must reach 48 + 72 = 120 h."""
    src = (REPO / 'src' / 'config.ts').read_text()
    flight_hours = int(re.search(r'export const FLIGHT_HOURS = (\d+);', src).group(1))
    assert build_tiles.RUN_HOURS == list(range(0, 121, 3))
    assert build_tiles.RUN_HOURS[-1] - flight_hours == 48
    assert build_tiles.N_WINDOWS == 5
    assert build_tiles.window_hours(build_tiles.N_WINDOWS - 1)[-1] == build_tiles.RUN_HOURS[-1]


def test_a_run_is_ready_only_once_its_f120_files_exist(monkeypatch):
    asked = []
    monkeypatch.setattr(gfs_fetch, 'http_exists', lambda url, **kw: asked.append(url) or True)
    assert gfs_fetch.run_is_ready('2026111218')
    assert {u.split('.pgrb2.')[1] for u in asked} == {'1p00.f120.idx', '0p25.f120.idx'}


def test_tile_slices_have_shared_edges_and_reach_poles_and_dateline():
    s = tile_slice(0, 0, 20, 1.0)
    assert (s.rows.stop - s.rows.start, s.cols.stop - s.cols.start) == (21, 21)
    c = tile_slice(50, -5, 5, 0.25)
    assert (c.rows.stop - c.rows.start, c.cols.stop - c.cols.start) == (21, 21)
    north = tile_slice(70, 160, 20, 1.0)       # northernmost, easternmost cruise tile
    assert north.rows.stop == 181 and north.cols.stop == 361
    assert tile_slice(85, 175, 5, 0.25).rows.stop == 721
    assert tile_slice(85, 175, 5, 0.25).cols.stop == 1441
    assert len(tile_names(5)) == 36 * 72 and '85_175' in tile_names(5)


def _gfs_ordered(res):
    """A synthetic GFS-ordered field: rows 90 -> -90, columns 0 -> 360-res, value = lat*1000 + lon."""
    lats = np.arange(90, -90 - res / 2, -res)
    lons = np.arange(0, 360, res)
    return lats, lons, lats[:, None] * 1000 + lons[None, :]


def test_gfs_grid_flips_to_south_north_and_west_east():
    lats, lons, field = _gfs_ordered(1.0)
    g = to_global_grid(field, lat_first=90.0, lat_last=-90.0, lon_first=0.0, res=1.0)
    assert g.shape == (181, 361)
    # row 0 is -90, column 0 is -180 (GFS 180)
    assert g[0, 0] == -90 * 1000 + 180
    # (53N, -2E) -> GFS lon 358
    assert g[53 + 90, -2 + 180] == 53 * 1000 + 358
    # (0, 0) and (90, 179)
    assert g[90, 180] == 0
    assert g[180, 359] == 90 * 1000 + 179


def test_180_column_duplicates_minus_180():
    _, _, field = _gfs_ordered(0.25)
    g = to_global_grid(field, lat_first=90.0, lat_last=-90.0, lon_first=0.0, res=0.25)
    assert g.shape == (721, 1441)
    assert np.array_equal(g[:, -1], g[:, 0])


def test_grid_already_south_north_is_not_flipped():
    lats, lons, field = _gfs_ordered(1.0)
    g = to_global_grid(field[::-1], lat_first=-90.0, lat_last=90.0, lon_first=0.0, res=1.0)
    assert g[0, 180] == -90 * 1000


def test_extract_tile_matches_slice():
    _, _, field = _gfs_ordered(1.0)
    g = to_global_grid(field, lat_first=90.0, lat_last=-90.0, lon_first=0.0, res=1.0)
    s = tile_slice(40, -20, 20, 1.0)
    t = g[s.rows, s.cols]
    assert t.shape == (21, 21)
    assert t[0, 0] == 40 * 1000 + 340 and t[-1, -1] == 60 * 1000 + 0


def test_land_tiles_any_cell():
    land = np.zeros((721, 1441))
    land[(53 + 90) * 4, (-2 + 180) * 4] = 1.0           # a point in north-west England
    land[(0 + 90) * 4, (20 + 180) * 4] = 0.3             # a point on a 5-degree corner (shared by 4 tiles)
    names = build_tiles.land_tile_names(land, tile_deg=5, res=0.25)
    assert '50_-5' in names
    assert {'-5_15', '-5_20', '0_15', '0_20'} <= set(names)
    assert len(names) == 5


IDX = """1:0:d=2026111218:PRMSL:mean sea level:96 hour fcst:
2:100:d=2026111218:HGT:850 mb:96 hour fcst:
3:250:d=2026111218:UGRD:850 mb:96 hour fcst:
4:400:d=2026111218:VGRD:850 mb:96 hour fcst:
5:520:d=2026111218:UGRD:800 mb:96 hour fcst:
6:700:d=2026111218:LAND:surface:96 hour fcst:
"""


def test_idx_ranges_use_next_offset_minus_one():
    entries = parse_idx(IDX)
    assert len(entries) == 6
    r = select_ranges(entries, [('HGT', '850 mb'), ('VGRD', '850 mb'), ('LAND', 'surface')])
    assert r[('HGT', '850 mb')] == (100, 249)
    assert r[('VGRD', '850 mb')] == (400, 519)
    assert r[('LAND', 'surface')] == (700, None)  # last message: open-ended range
    with pytest.raises(KeyError):
        select_ranges(entries, [('VGRD', '800 mb')])


def test_levels_match_site_config():
    src = (REPO / 'src' / 'config.ts').read_text()
    def levels(name):
        m = re.search(rf'export const {name} = \[([^\]]*)\]', src)
        return [int(x) for x in m.group(1).split(',')]
    assert levels('CLIMB_LEVELS') == build_tiles.CLIMB_LEVELS
    assert levels('CRUISE_LEVELS') == build_tiles.CRUISE_LEVELS


# --- Store, pruning and manifest (R15) --------------------------------------------------

def _fake_complete_run(store, run_id):
    d = store / run_id
    (d / 'climb').mkdir(parents=True)
    (d / 'cruise').mkdir(parents=True)
    (d / 'climb' / '50_-5.bin.gz').write_bytes(gzip.compress(b'x'))
    (d / 'cruise' / '40_-20_0.bin.gz').write_bytes(gzip.compress(b'y'))
    (d / 'run.json').write_text(json.dumps(build_tiles.run_entry(run_id)))


def test_manifest_lists_newest_four_complete_runs(tmp_path):
    store, out = tmp_path / 'store', tmp_path / 'out'
    for r in ['2026111100', '2026111106', '2026111112', '2026111118', '2026111200']:
        _fake_complete_run(store, r)
    (store / '2026111206.partial' / 'climb').mkdir(parents=True)   # interrupted build: never listed
    build_tiles.prune_store(store, keep=4)
    runs = build_tiles.publish(store, out)
    m = json.loads((out / 'manifest.json').read_text())
    ids = [r['id'] for r in m['runs']]
    assert ids == ['2026111200', '2026111118', '2026111112', '2026111106'] == runs
    assert not (store / '2026111100').exists() and not (store / '2026111206.partial').exists()
    assert (out / 'climb' / '2026111200' / '50_-5.bin.gz').exists()
    assert (out / 'cruise' / '2026111106' / '40_-20_0.bin.gz').exists()
    assert not (out / 'climb' / '2026111100').exists()


def test_run_entry_shape():
    e = build_tiles.run_entry('2026111218')
    assert e == {
        'id': '2026111218', 'issued': '2026-11-12T18:00:00Z', 'hours': list(range(0, 121, 3)),
        'climb': {'tileDeg': 5, 'res': 0.25, 'hours': [3, 6, 9, 12, 15, 18, 21, 24], 'scale': 0.5},
        'cruise': {'tileDeg': 20, 'res': 1.0, 'windowHours': 24, 'scale': 1.0},
    }


def test_failed_download_still_publishes_cached_runs(tmp_path, monkeypatch):
    store, out = tmp_path / 'store', tmp_path / 'out'
    _fake_complete_run(store, '2026111212')

    def boom(*a, **k):
        raise OSError('NOAA unreachable')
    monkeypatch.setattr(build_tiles, 'build_run', boom)
    rc = build_tiles.main('2026111218', out, store=store)
    assert rc == 0
    m = json.loads((out / 'manifest.json').read_text())
    assert [r['id'] for r in m['runs']] == ['2026111212']


def test_no_runs_at_all_fails(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise OSError('NOAA unreachable')
    monkeypatch.setattr(build_tiles, 'build_run', boom)
    rc = build_tiles.main('2026111218', tmp_path / 'o', store=tmp_path / 's')
    assert rc == 1
    assert json.loads((tmp_path / 'o' / 'manifest.json').read_text()) == {'runs': []}


def test_build_run_with_synthetic_fields(tmp_path):
    """End-to-end tile writing with fake fetchers (no network)."""
    def fake_fields(run_id, hours, levels, product, **kw):
        res = 0.25 if product == '0p25' else 1.0
        nlat, nlon = int(round(180 / res)) + 1, int(round(360 / res)) + 1
        lat = np.linspace(-90, 90, nlat)[:, None]
        base = np.broadcast_to(lat, (nlat, nlon)).astype(np.float32)
        shape = (len(hours), len(levels), nlat, nlon)
        hrs = np.array(hours, dtype=np.float32)[:, None, None, None]
        lev = np.array(levels, dtype=np.float32)[None, :, None, None]
        return {'u': np.broadcast_to(hrs / 3, shape), 'v': np.broadcast_to(base / 10, shape),
                'gh': np.broadcast_to(10000 - lev * 10 + 0 * base, shape)}

    def fake_land(run_id, **kw):
        land = np.zeros((721, 1441), dtype=np.float32)
        land[(53 + 90) * 4 + 2, (-2 + 180) * 4 + 2] = 1
        return land

    path = build_tiles.build_run('2026111218', tmp_path, fetch=fake_fields, fetch_land=fake_land)
    assert path == tmp_path / '2026111218'
    climb = sorted(p.name for p in (path / 'climb').glob('*.bin.gz'))
    assert climb == ['50_-5.bin.gz']
    assert json.loads((path / 'climb' / 'tiles.json').read_text()) == ['50_-5']
    assert len(list((path / 'cruise').glob('*.bin.gz'))) == 9 * 18 * 5
    t = decode_tile(gzip.decompress((path / 'cruise' / '50_-20_3.bin.gz').read_bytes()))
    assert t.hours.tolist() == build_tiles.window_hours(3)
    assert t.levels.tolist() == build_tiles.CRUISE_LEVELS
    assert (t.lat0, t.lon0, t.res, t.scale) == (50, -20, 1.0, 1.0)
    assert t.u[0, 0, 0, 0] == 24 and t.u[8, 0, 0, 0] == 32            # hour 72 / 3, hour 96 / 3
    t4 = decode_tile(gzip.decompress((path / 'cruise' / '50_-20_4.bin.gz').read_bytes()))
    assert t4.hours.tolist() == build_tiles.window_hours(4)
    assert t4.u[8, 0, 0, 0] == 40                                       # hour 120 / 3
    assert t.v[0, 0, 3, 0] == 5 and t.gh[0, 1, 0, 0] == 10000 - 8000  # lat 53 / 10; level 800
    c = decode_tile(gzip.decompress((path / 'climb' / '50_-5.bin.gz').read_bytes()))
    assert c.u.shape == (8, 6, 21, 21) and c.scale == 0.5 and c.res == 0.25
    assert json.loads((path / 'run.json').read_text()) == build_tiles.run_entry('2026111218')
