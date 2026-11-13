import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildCities, parseCsv, type City } from '../../scripts/cities';
import cities from '../../data/cities.json';
import { FEATURED_IDS } from '../../src/ui/featured';
import { bearingDeg, haversineKm } from '../../src/geo/coords';

const csv = readFileSync(new URL('../../docs/reference/launch-cities.csv', import.meta.url), 'utf8');

describe('buildCities: hero landmark and launch heading', () => {
  const HEAD = 'Group,Country,City,Tier,Launch spot,Launch lat,Launch lon,Landmarks to model,Animated touch,Notes,Batch,Hero lat,Hero lon,Heading note';
  const row = (batch: string, hero: string) => `Country,X,Town,1,Square,51.50070,-0.12630,Big Tower; Small Bridge,,,${batch},${hero}`;

  test('hero coordinates give hero {name, lat, lon} and the bearing from the spot, to 0.1 degree', () => {
    const [c] = buildCities(`${HEAD}\n${row('Launch batch', '51.50069,-0.12457,')}\n`);
    expect(c.hero).toEqual({ name: 'Big Tower', lat: 51.50069, lon: -0.12457 });
    expect(c.launch.headingDeg).toBe(90.5);
    expect(c.launch.headingNote).toBeUndefined();
  });

  test('a heading note with no hero point gives null and keeps the reason', () => {
    const [c] = buildCities(`${HEAD}\n${row('Launch batch', ',,The landmark is terrain all round')}\n`);
    expect(c.hero).toBeUndefined();
    expect(c.launch).toEqual({ lat: 51.5007, lon: -0.1263, label: 'Square', headingDeg: null, headingNote: 'The landmark is terrain all round' });
  });

  test('a launch-batch row needs a hero point or a reason', () => {
    expect(() => buildCities(`${HEAD}\n${row('Launch batch', ',,')}\n`)).toThrow(/hero landmark point or a heading note/);
  });

  test('later batches may leave the hero point empty for now', () => {
    const [c] = buildCities(`${HEAD}\n${row('Weekly batches', ',,')}\n`);
    expect(c.hero).toBeUndefined();
    expect(c.launch.headingDeg).toBeNull();
  });

  test('a half-filled or impossible hero point is an error', () => {
    expect(() => buildCities(`${HEAD}\n${row('Launch batch', '51.5,,')}\n`)).toThrow(/bad hero landmark coordinates/);
    expect(() => buildCities(`${HEAD}\n${row('Launch batch', '95,0,')}\n`)).toThrow(/bad hero landmark coordinates/);
  });
});

describe('parseCsv', () => {
  test('keeps commas and doubled quotes inside quoted fields', () => {
    expect(parseCsv('a,b,c\n"x, y",2,"say ""hi"""\n')).toEqual([['a', 'b', 'c'], ['x, y', '2', 'say "hi"']]);
  });
  test('handles CRLF and a missing final newline', () => {
    expect(parseCsv('a,b\r\n1,\r\n2,3')).toEqual([['a', 'b'], ['1', ''], ['2', '3']]);
  });
});

describe('cities.json', () => {
  const list = cities as City[];

  test('is what the script builds from the CSV (run npm run cities after editing the CSV)', () => {
    expect(list).toEqual(buildCities(csv));
  });

  test('cities.json has 120 entries, 24 in launch batch', () => {
    expect(list).toHaveLength(120);
    expect(list.filter((c) => c.batch === 'launch')).toHaveLength(24);
    expect(new Set(list.map((c) => c.id)).size).toBe(120);
  });

  test('launch batch comes first', () => {
    expect(list.slice(0, 24).every((c) => c.batch === 'launch')).toBe(true);
  });

  test('fields: quoted labels, split landmarks, rights notes, hero landmark and heading', () => {
    const nyc = list.find((c) => c.city === 'New York')!;
    expect(nyc.launch).toEqual({ lat: 40.6906, lon: -74.046, label: 'Flagpole Plaza, Liberty Island', headingDeg: 140.8 });
    expect(nyc.hero).toEqual({ name: 'Statue of Liberty', lat: 40.68925, lon: -74.04455 });
    expect(nyc.landmarks).toEqual(['Statue of Liberty', 'Empire State Building', 'One World Trade Center', 'Brooklyn Bridge', 'Chrysler Building']);
    expect(nyc.animated).toBe('Torch flame flickers; Empire State tower lights at dusk');
    expect(nyc.notes).toBeUndefined();
    const paris = list.find((c) => c.city === 'Paris')!;
    expect(paris.notes).toMatch(/^Do not recreate the Eiffel Tower night light show \(protected\); leave out the Louvre Pyramid/);
    expect(paris.tier).toBe(1);
    const london = list.find((c) => c.id === 'london')!;
    expect(london.launch).toMatchObject({ lat: 51.5007, lon: -0.1263, label: 'Parliament Square' }); // = DEFAULT_START
    for (const c of list) {
      expect(Math.abs(c.launch.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.launch.lon)).toBeLessThanOrEqual(180);
      expect(c.landmarks.every((l) => l.length > 0 && l === l.trim())).toBe(true);
    }
  });

  /**
   * Rough city centres (Nominatim, or the city core where the boundary's centre lies far out, as in
   * Mumbai, Tokyo and Dubai) and how far from them a launch spot may be.
   */
  const CENTRES: Record<string, [lat: number, lon: number, km: number]> = {
    'new-york': [40.71273, -74.00602, 8], mumbai: [18.94, 72.835, 8], 'rio-de-janeiro': [-22.91101, -43.20937, 10],
    london: [51.50745, -0.12777, 5], manchester: [53.4808, -2.2426, 3], edinburgh: [55.95335, -3.18837, 3],
    birmingham: [52.4797, -1.9026, 3], glasgow: [55.86115, -4.25017, 3], liverpool: [53.4084, -2.9916, 3],
    belfast: [54.59639, -5.93018, 3], cardiff: [51.48165, -3.17919, 3], bristol: [51.4545, -2.5879, 5],
    oxford: [51.75201, -1.25785, 3], dublin: [53.34938, -6.26056, 3], cork: [51.89851, -8.47264, 3],
    galway: [53.27441, -9.04906, 3], limerick: [52.66125, -8.63012, 3], paris: [48.85889, 2.32004, 6],
    barcelona: [41.38258, 2.17707, 6], tokyo: [35.68, 139.77, 12], sydney: [-33.86984, 151.20828, 3],
    'cappadocia-goreme': [38.64209, 34.82962, 3], dubai: [25.1972, 55.2744, 3], singapore: [1.2903, 103.852, 4],
  };

  describe('launch batch: spots confirmed against OpenStreetMap (Task 21)', () => {
    const launch = list.filter((c) => c.batch === 'launch');

    test('every launch-batch city has a heading to its hero landmark, or null with a reason', () => {
      for (const c of launch) {
        if (c.launch.headingDeg === null) {
          expect(c.hero, c.id).toBeUndefined();
          expect(c.launch.headingNote?.trim().length, c.id).toBeGreaterThan(10);
        } else {
          expect(Number.isFinite(c.launch.headingDeg), c.id).toBe(true);
          expect(c.launch.headingDeg, c.id).toBeGreaterThanOrEqual(0);
          expect(c.launch.headingDeg, c.id).toBeLessThan(360);
          expect(c.hero?.name, c.id).toBe(c.landmarks[0]);
        }
      }
      // every launch-batch city now has a point to face (Cappadocia: its fairy-chimney model)
      expect(launch.filter((c) => c.launch.headingDeg === null).map((c) => c.id)).toEqual([]);
    });

    test('the heading is the bearing from the launch spot to the hero landmark, within 1 degree', () => {
      for (const c of launch) {
        if (!c.hero || c.launch.headingDeg === null) continue;
        const want = bearingDeg(c.launch, c.hero);
        const diff = Math.abs(((c.launch.headingDeg - want + 540) % 360) - 180);
        expect(diff, c.id).toBeLessThanOrEqual(1);
      }
    });

    test('the hero landmark is in sight range: not on top of the spot, not over 1.2 km away', () => {
      for (const c of launch) {
        if (!c.hero) continue;
        const m = haversineKm(c.launch, c.hero) * 1000;
        expect(m, c.id).toBeGreaterThan(30);
        expect(m, c.id).toBeLessThan(1200);
      }
    });

    test('spots and hero landmarks are inside their city', () => {
      expect(Object.keys(CENTRES).sort()).toEqual(launch.map((c) => c.id).sort());
      for (const c of launch) {
        const [lat, lon, km] = CENTRES[c.id];
        expect(haversineKm(c.launch, { lat, lon }), c.id).toBeLessThan(km);
        if (c.hero) expect(haversineKm(c.hero, { lat, lon }), c.id).toBeLessThan(km);
      }
    });

    test('launch views re-aimed at their landmark models (Task 21c)', () => {
      const get = (id: string) => list.find((c) => c.id === id)!;
      // Cappadocia faces the fairy-chimney cluster west of Sunset Point
      const cap = get('cappadocia-goreme');
      expect(cap.hero).toEqual({ name: 'Fairy chimneys (terrain)', lat: 38.64016, lon: 34.8291 });
      expect(cap.launch.headingDeg).toBeCloseTo(283, 0);
      expect(cap.launch.headingNote).toBeUndefined();
      // Galway: from the Long Walk, in front of the arches (they face south-east, 135 deg)
      const gal = get('galway');
      expect(gal.launch).toMatchObject({ lat: 53.26907, lon: -9.05281, label: 'The Long Walk, facing the Spanish Arch' });
      expect(Math.abs(gal.launch.headingDeg! - 315)).toBeLessThan(5);
      // Edinburgh faces the Gatehouse; Cardiff the south wall between the gate and the Clock Tower
      expect(get('edinburgh').hero).toMatchObject({ lat: 55.94853, lon: -3.19855 });
      expect(get('edinburgh').launch.headingDeg).toBeCloseTo(250.3, 1);
      expect(get('cardiff').hero).toMatchObject({ lat: 51.48144, lon: -3.18129 });
      expect(get('cardiff').launch.headingDeg).toBeGreaterThanOrEqual(315);
      expect(get('cardiff').launch.headingDeg).toBeLessThanOrEqual(320);
      // Rio: SK's choice (13 Nov 2026), Corcovado beside Christ the Redeemer
      const rio = get('rio-de-janeiro');
      expect(rio.launch).toMatchObject({ lat: -22.9522, lon: -43.2103, label: 'Corcovado, below Christ the Redeemer' });
      expect(rio.landmarks.slice(0, 2)).toEqual(['Christ the Redeemer', 'Sugarloaf Mountain and cable car']);
      expect(rio.hero).toEqual({ name: 'Christ the Redeemer', lat: -22.95192, lon: -43.21049 });
      expect(rio.notes).toMatch(/13 Nov 2026/);
    });

    test('coordinates are given to 5 decimal places at most (about 1 m)', () => {
      const fine = (x: number) => Math.abs(Math.round(x * 1e5) / 1e5 - x) < 1e-9;
      for (const c of launch) {
        expect(fine(c.launch.lat) && fine(c.launch.lon), c.id).toBe(true);
        if (c.hero) expect(fine(c.hero.lat) && fine(c.hero.lon), c.id).toBe(true);
      }
    });
  });

  test('the six featured cities are launch-batch cities', () => {
    expect(FEATURED_IDS).toHaveLength(6);
    for (const id of FEATURED_IDS) expect(list.find((c) => c.id === id)?.batch).toBe('launch');
  });
});

test('landmark heading for the launch camera: none until the sheet has one, a number when it does', async () => {
  const { landmarkHeading } = await import('../../src/ui/featured');
  expect(landmarkHeading(undefined)).toBeUndefined();
  expect(landmarkHeading('no-such-city')).toBeUndefined();
  expect(landmarkHeading('london')).toBe(90.5); // Parliament Square to Elizabeth Tower, due east
  expect(landmarkHeading('cappadocia-goreme')).toBeCloseTo(283, 0); // the fairy-chimney model, west of Sunset Point
});
