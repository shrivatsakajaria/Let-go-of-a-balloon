#!/usr/bin/env bash
# Rebuild public/fonts/archivo-subset.woff2 from the OFL variable Archivo in google/fonts.
# Needs: pip install fonttools brotli. Keeps both axes, limited to what the interface uses
# (wdth 62-100, wght 400-700), Latin + Latin-1 + common Latin Extended-A letters for place names,
# the punctuation the copy uses (· – — ’ “ ” …) and the kern, liga and tnum features.
set -euo pipefail
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl -sSL -o "$work/Archivo.ttf" "https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf"
python3 -I -m fontTools.varLib.instancer "$work/Archivo.ttf" wdth=62:100 wght=400:700 -o "$work/lim.ttf"
pyftsubset "$work/lim.ttf" \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201A,U+201C-201E,U+2026,U+20AC,U+2192,U+2212" \
  --text="ĀāĂăĄąĆćČčĎďĐđĒēĘęĚěĞğĪīİıŁłŃńŇňŌōŐőŒœŘřŚśŞşŠšŢţŤťŪūŮůŰűŹźŻżŽž" \
  --layout-features=kern,liga,tnum --flavor=woff2 --no-hinting \
  --output-file=public/fonts/archivo-subset.woff2
ls -l public/fonts/archivo-subset.woff2
