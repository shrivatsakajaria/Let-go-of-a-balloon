# Gazetteer sources

These files are generated. Do not edit the JSON by hand. Generated 2026-11-13.
Regenerate with `npm run gazetteer` (needs network and `unzip`); the script keeps this file.

- Towns: GeoNames `cities5000`, https://download.geonames.org/export/dump/cities5000.zip. Licence CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Attribution: "Place names: GeoNames".
- Sea and ocean names: Natural Earth 1:10m marine polygons, `ne_10m_geography_marine_polys`, public domain. https://github.com/nvkelso/natural-earth-vector
- Region names (ranges, plateaus, deserts, islands): Natural Earth 1:10m `ne_10m_geography_regions_polys`, public domain. Same repository.
- Coast mask: Natural Earth 1:10m `ne_10m_land`, public domain. Same repository.
- The Lake District, Peak District, Snowdonia and Scottish Highlands (`EXTRA_REGIONS` in `scripts/gazetteer.ts`) are our own rough outlines, not from any source dataset.

Each file `<z>_<x>_<y>.json` is a zoom-5 Web Mercator tile. The format is described at the top of the script.
