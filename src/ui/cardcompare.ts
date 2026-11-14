/**
 * The card's one quiet line that compares the distance with something familiar ("About the length of
 * Britain"), chosen by the country the balloon was let go in (spec 6.5, design A). Every distance is
 * worked out from the two places' coordinates, in a straight line as the card's own distance is, so the
 * line is honest by construction; it is said only when the trip is within COMPARE_TOLERANCE of one (the
 * most familiar such, each list running from the best known), and left out otherwise.
 */
import { haversineKm, type LatLon } from '../geo/coords';

export type Familiar = { text: string; a: LatLon; b: LatLon } | { text: string; km: number };

/** Within this share either way, "About". */
export const COMPARE_TOLERANCE = 0.12;

const P = {
  landsEnd: { lat: 50.0657, lon: -5.7132 },
  johnOGroats: { lat: 58.6373, lon: -3.0689 },
  london: { lat: 51.5072, lon: -0.1276 },
  edinburgh: { lat: 55.9533, lon: -3.1883 },
  manchester: { lat: 53.4794, lon: -2.2453 },
  brighton: { lat: 50.8225, lon: -0.1372 },
  birmingham: { lat: 52.4862, lon: -1.8904 },
  dover: { lat: 51.1279, lon: 1.3134 },
  grisNez: { lat: 50.8693, lon: 1.5843 },
  paris: { lat: 48.8566, lon: 2.3522 },
  marseille: { lat: 43.2965, lon: 5.3698 },
  lyon: { lat: 45.764, lon: 4.8357 },
  berlin: { lat: 52.52, lon: 13.405 },
  munich: { lat: 48.1351, lon: 11.582 },
  hamburg: { lat: 53.5511, lon: 9.9937 },
  rome: { lat: 41.9028, lon: 12.4964 },
  milan: { lat: 45.4642, lon: 9.19 },
  madrid: { lat: 40.4168, lon: -3.7038 },
  barcelona: { lat: 41.3874, lon: 2.1686 },
  amsterdam: { lat: 52.3676, lon: 4.9041 },
  dublin: { lat: 53.3498, lon: -6.2603 },
  cork: { lat: 51.8985, lon: -8.4756 },
  malinHead: { lat: 55.3817, lon: -7.3742 },
  mizenHead: { lat: 51.4509, lon: -9.8199 },
  oslo: { lat: 59.9139, lon: 10.7522 },
  bergen: { lat: 60.3913, lon: 5.3221 },
  newYork: { lat: 40.7128, lon: -74.006 },
  washington: { lat: 38.9072, lon: -77.0369 },
  chicago: { lat: 41.8781, lon: -87.6298 },
  losAngeles: { lat: 34.0522, lon: -118.2437 },
  sanFrancisco: { lat: 37.7749, lon: -122.4194 },
  toronto: { lat: 43.6532, lon: -79.3832 },
  montreal: { lat: 45.5019, lon: -73.5674 },
  sydney: { lat: -33.8688, lon: 151.2093 },
  melbourne: { lat: -37.8136, lon: 144.9631 },
  perth: { lat: -31.9523, lon: 115.8613 },
  tokyo: { lat: 35.6762, lon: 139.6503 },
  osaka: { lat: 34.6937, lon: 135.5023 },
  sapporo: { lat: 43.0618, lon: 141.3545 },
  auckland: { lat: -36.8485, lon: 174.7633 },
  wellington: { lat: -41.2865, lon: 174.7762 },
  delhi: { lat: 28.6139, lon: 77.209 },
  mumbai: { lat: 19.076, lon: 72.8777 },
};

const UK: Familiar[] = [
  { text: 'the length of Britain', a: P.landsEnd, b: P.johnOGroats },
  { text: 'the distance from London to Edinburgh', a: P.london, b: P.edinburgh },
  { text: 'the distance from London to Manchester', a: P.london, b: P.manchester },
  { text: 'the distance from London to Birmingham', a: P.london, b: P.birmingham },
  { text: 'the distance from London to Brighton', a: P.london, b: P.brighton },
  { text: 'the distance from London to Paris', a: P.london, b: P.paris },
  { text: 'the distance from London to Berlin', a: P.london, b: P.berlin },
  { text: 'the distance from London to Rome', a: P.london, b: P.rome },
  { text: 'the distance from London to New York', a: P.london, b: P.newYork },
  { text: 'the width of the English Channel at Dover', a: P.dover, b: P.grisNez },
];

/** By the start's country, as the gazetteer names it. */
const BY_COUNTRY: Record<string, Familiar[]> = {
  'United Kingdom': UK,
  Ireland: [
    { text: 'the length of Ireland', a: P.malinHead, b: P.mizenHead },
    { text: 'the distance from Dublin to Cork', a: P.dublin, b: P.cork },
    { text: 'the distance from Dublin to London', a: P.dublin, b: P.london },
  ],
  France: [
    { text: 'the distance from Paris to Marseille', a: P.paris, b: P.marseille },
    { text: 'the distance from Paris to Lyon', a: P.paris, b: P.lyon },
    { text: 'the distance from Paris to London', a: P.paris, b: P.london },
    { text: 'the distance from Paris to Berlin', a: P.paris, b: P.berlin },
    { text: 'the width of the English Channel at Calais', a: P.dover, b: P.grisNez },
  ],
  Germany: [
    { text: 'the distance from Berlin to Munich', a: P.berlin, b: P.munich },
    { text: 'the distance from Berlin to Hamburg', a: P.berlin, b: P.hamburg },
    { text: 'the distance from Berlin to Paris', a: P.berlin, b: P.paris },
  ],
  Netherlands: [
    { text: 'the distance from Amsterdam to Paris', a: P.amsterdam, b: P.paris },
    { text: 'the distance from Amsterdam to Berlin', a: P.amsterdam, b: P.berlin },
  ],
  Spain: [{ text: 'the distance from Madrid to Barcelona', a: P.madrid, b: P.barcelona }],
  Italy: [{ text: 'the distance from Rome to Milan', a: P.rome, b: P.milan }],
  Norway: [{ text: 'the distance from Oslo to Bergen', a: P.oslo, b: P.bergen }],
  'United States': [
    { text: 'the distance from New York to Washington', a: P.newYork, b: P.washington },
    { text: 'the distance from Los Angeles to San Francisco', a: P.losAngeles, b: P.sanFrancisco },
    { text: 'the distance from New York to Chicago', a: P.newYork, b: P.chicago },
    { text: 'the distance from New York to Los Angeles', a: P.newYork, b: P.losAngeles },
  ],
  Canada: [{ text: 'the distance from Toronto to Montreal', a: P.toronto, b: P.montreal }],
  Australia: [
    { text: 'the distance from Sydney to Melbourne', a: P.sydney, b: P.melbourne },
    { text: 'the distance from Sydney to Perth', a: P.sydney, b: P.perth },
  ],
  Japan: [
    { text: 'the distance from Tokyo to Osaka', a: P.tokyo, b: P.osaka },
    { text: 'the distance from Tokyo to Sapporo', a: P.tokyo, b: P.sapporo },
  ],
  'New Zealand': [{ text: 'the distance from Auckland to Wellington', a: P.auckland, b: P.wellington }],
  India: [{ text: 'the distance from Delhi to Mumbai', a: P.delhi, b: P.mumbai }],
};

/** Everywhere: what anyone knows. */
const ANYWHERE: Familiar[] = [{ text: 'a marathon', km: 42.195 }];

export const familiarKm = (f: Familiar): number => ('km' in f ? f.km : haversineKm(f.a, f.b));

/** The comparison for a trip of `km` let go in `country` ("About the length of Britain"), or null. */
export function compareLine(km: number, country: string | null | undefined): string | null {
  if (!(km > 0)) return null;
  const list = [...(country ? BY_COUNTRY[country] ?? [] : []), ...ANYWHERE];
  // the lists run from the most familiar: the first one close enough
  const hit = list.find((f) => Math.abs(km / familiarKm(f) - 1) <= COMPARE_TOLERANCE);
  return hit ? `About ${hit.text}` : null;
}

/** Every entry (for checks). */
export const FAMILIAR = { BY_COUNTRY, ANYWHERE };
