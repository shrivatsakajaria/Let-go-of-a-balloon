export const CLIMB_RATE_MS = 1.5;
export const CRUISE_ASL_M = 1500;
export const CRUISE_CLEARANCE_M = 600;
export const FLIGHT_HOURS = 72;
export const ROUTE_STEP_MIN = 10;
export const LINK_POINTS = 73;
export const CLIMB_LEVELS = [1000, 975, 950, 925, 900, 850];
export const CRUISE_LEVELS = [850, 800, 750, 700, 600, 500];
export const TERRACE_STEP_M = 10;
export const DPR_CAP = 1.5;
export const REPLAY_SECONDS = 20;
export const CARD_W = 1080;
export const CARD_H = 1350;
export const BALLOON_HEX = '#ff5a12';

/** Mean Earth radius (IUGG), used by haversine and destination. */
export const EARTH_RADIUS_KM = 6371.0088;

/**
 * Terrain sources (Terrarium-encoded elevation, metres = R*256 + G + B/256 - 32768).
 * Mapterhorn tiles are 512 px WebP; CORS is `*` on all of these. Verified 2026-11.
 */
export const TERRAIN_PLANET_PMTILES = 'https://download.mapterhorn.com/planet.pmtiles'; // global, z0-z12
export const TERRAIN_REGIONAL_INDEX = 'https://download.mapterhorn.com/download_urls.json'; // regional z13+ archives
export const TERRAIN_XYZ = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'; // fallback 1
export const TERRAIN_AWS = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'; // fallback 2, 256 px, max z15
export const TERRAIN_PLANET_MAX_ZOOM = 12;
export const TERRAIN_AWS_MAX_ZOOM = 15;
/**
 * Zoom of the tiles the route reads ground height from: the spec's coarse terrain. z5 pixels are
 * ~2.4 km at the equator, so the 3 x 3 max covers ~7 km; a typical route needs ~5 tiles (~0.6 MB)
 * instead of ~15-25 at z7 (1.6-3.3 MB). Mountain peaks read lower than at z7 (Mont Blanc 4352 m vs
 * 4644 m) and valleys higher, which can change the cruise level over high ground.
 */
export const ROUTE_GROUND_ZOOM = 5;
