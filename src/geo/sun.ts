import type { LatLon } from './coords';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const norm360 = (d: number): number => ((d % 360) + 360) % 360;

/** Sun/moon elevation is geometric (no atmospheric refraction); sunrise uses -0.833 deg to cover it. */
const SUN_HORIZON_DEG = -0.833;

const julianDay = (utcMs: number): number => utcMs / 86400000 + 2440587.5;
const julianCentury = (utcMs: number): number => (julianDay(utcMs) - 2451545.0) / 36525;

/** Greenwich mean sidereal time in degrees. */
function gmstDeg(utcMs: number): number {
  const d = julianDay(utcMs) - 2451545.0;
  const T = d / 36525;
  return norm360(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T);
}

/** Equatorial (RA, Dec in degrees) to horizontal coordinates for an observer. */
function horizontal(raDeg: number, decDeg: number, utcMs: number, p: LatLon) {
  const H = (gmstDeg(utcMs) + p.lon - raDeg) * RAD;
  const dec = decDeg * RAD;
  const lat = p.lat * RAD;
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const elevationDeg = Math.asin(Math.max(-1, Math.min(1, sinEl))) * DEG;
  // azimuth clockwise from north
  const azimuthDeg = norm360(
    Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) * DEG + 180,
  );
  return { elevationDeg, azimuthDeg };
}

/** NOAA solar position: apparent ecliptic longitude, declination and right ascension. */
function solarCoords(utcMs: number) {
  const T = julianCentury(utcMs);
  const L0 = norm360(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = norm360(357.52911 + T * (35999.05029 - 0.0001537 * T));
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * RAD;
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const trueAnom = M + C;
  const R = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(trueAnom * RAD)); // AU
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decDeg = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) * DEG;
  const raDeg = norm360(
    Math.atan2(Math.cos(eps * RAD) * Math.sin(lambda * RAD), Math.cos(lambda * RAD)) * DEG,
  );
  return { lambdaDeg: norm360(lambda), decDeg, raDeg, R };
}

export function sunPosition(utcMs: number, p: LatLon): { elevationDeg: number; azimuthDeg: number } {
  const s = solarCoords(utcMs);
  return horizontal(s.raDeg, s.decDeg, utcMs, p);
}

/** Low-precision lunar position (Astronomical Almanac), within about 0.3 deg. */
export function moonPosition(
  utcMs: number,
  p: LatLon,
): { elevationDeg: number; azimuthDeg: number; illumination: number } {
  const T = julianCentury(utcMs);
  const s = (a: number, b: number) => Math.sin((a + b * T) * RAD);
  const c = (a: number, b: number) => Math.cos((a + b * T) * RAD);
  const lambda =
    218.32 + 481267.881 * T +
    6.29 * s(135.0, 477198.87) - 1.27 * s(259.3, -413335.36) + 0.66 * s(235.7, 890534.22) +
    0.21 * s(269.9, 954397.74) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.5, 966404.03);
  const beta =
    5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) -
    0.17 * s(217.6, -407332.21);
  const parallaxDeg =
    0.9508 + 0.0518 * c(135.0, 477198.87) + 0.0095 * c(259.3, -413335.36) +
    0.0078 * c(235.7, 890534.22) + 0.0028 * c(269.9, 954397.74);

  const lam = lambda * RAD;
  const bet = beta * RAD;
  const eps = (23.439291 - 0.0130042 * T) * RAD;
  const x = Math.cos(bet) * Math.cos(lam);
  const y = Math.cos(eps) * Math.cos(bet) * Math.sin(lam) - Math.sin(eps) * Math.sin(bet);
  const z = Math.sin(eps) * Math.cos(bet) * Math.sin(lam) + Math.cos(eps) * Math.sin(bet);
  const raDeg = norm360(Math.atan2(y, x) * DEG);
  const decDeg = Math.asin(z) * DEG;

  const h = horizontal(raDeg, decDeg, utcMs, p);
  // topocentric correction: the moon is close enough that parallax shifts it up to ~1 deg
  const elevationDeg = h.elevationDeg - parallaxDeg * Math.cos(h.elevationDeg * RAD);

  const sun = solarCoords(utcMs);
  const cosPsi = Math.cos(bet) * Math.cos(lam - sun.lambdaDeg * RAD);
  const illumination = (1 - Math.max(-1, Math.min(1, cosPsi))) / 2;
  return { elevationDeg, azimuthDeg: h.azimuthDeg, illumination };
}

const STEP_MS = 10 * 60e3;
const DAY_MS = 24 * 3600e3;
const TOLERANCE_MS = 30e3;

/** Next sunrise or sunset within 24 h, evaluated along `route` when given. */
export function nextSunEvent(
  utcMs: number,
  p: LatLon,
  route?: (t: number) => LatLon,
): { kind: 'sunrise' | 'sunset'; utcMs: number } | null {
  const f = (t: number): number =>
    sunPosition(t, route ? route(t) : p).elevationDeg - SUN_HORIZON_DEG;
  let t0 = utcMs;
  let f0 = f(t0);
  for (let t1 = utcMs + STEP_MS; t1 <= utcMs + DAY_MS + STEP_MS; t1 += STEP_MS) {
    const f1 = f(t1);
    if ((f0 < 0) !== (f1 < 0)) {
      let lo = t0;
      let hi = t1;
      const flo = f0 < 0;
      while (hi - lo > TOLERANCE_MS / 2) {
        const mid = (lo + hi) / 2;
        if ((f(mid) < 0) === flo) lo = mid;
        else hi = mid;
      }
      const t = (lo + hi) / 2;
      if (t > utcMs + DAY_MS) return null;
      return { kind: f0 < 0 ? 'sunrise' : 'sunset', utcMs: t };
    }
    t0 = t1;
    f0 = f1;
  }
  return null;
}
