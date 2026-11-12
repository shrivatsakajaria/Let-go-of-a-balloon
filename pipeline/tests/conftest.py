import sys
from pathlib import Path

# Make `import build_tiles` / `import gfs_fetch` work when running `pytest pipeline/tests`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
