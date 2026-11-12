"""The committed TS fixture tests/fixtures/wind/tiny.bin must equal what encode_tile writes.

Regenerate with:  WRITE_FIXTURE=1 pytest pipeline/tests/test_fixture.py
"""
import os
from pathlib import Path

import numpy as np

from build_tiles import encode_tile

FIXTURE = Path(__file__).resolve().parents[2] / 'tests' / 'fixtures' / 'wind' / 'tiny.bin'


def tiny_tile() -> bytes:
    # 2 hours x 2 levels x 3 lat x 4 lon; raw value k = h*24 + l*12 + i*4 + j (0..47)
    h, l, i, j = np.meshgrid(range(2), range(2), range(3), range(4), indexing='ij')
    k = h * 24 + l * 12 + i * 4 + j
    return encode_tile(lat0=-10, lon0=170, res=0.25, scale=0.5, levels=[850, 500], hours=[3, 6],
                       u=k * 0.5, v=-k * 0.5, gh=1000 * (l + 1) + 100 * h + i * 4 + j - 5000 * (k == 47))


def test_fixture_matches_encoder():
    buf = tiny_tile()
    if os.environ.get('WRITE_FIXTURE'):
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_bytes(buf)
    assert FIXTURE.read_bytes() == buf
