import { expect, test } from 'vitest';
import { COPY } from '../../src/ui/copy';
import { CARD_CREDIT, CREDITS, MAP_CREDIT, creditHtml, creditText } from '../../src/ui/credits';

const text = CREDITS.map((c) => creditText(c));

test('the map corner credit is the exact text, each source linked', () => {
  expect(creditText(MAP_CREDIT)).toBe(COPY.mapCredit);
  expect(creditText(MAP_CREDIT)).toBe('OpenFreeMap © OpenMapTiles Data from OpenStreetMap © Mapterhorn');
  expect(creditHtml(MAP_CREDIT).match(/<a /g)).toHaveLength(4);
});

test('the credits list every source with the exact text of the plan', () => {
  const all = text.join('\n');
  for (const want of [
    'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
    '© Mapterhorn',
    '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.',
    'Winds: NOAA GFS',
    'Place search: Open-Meteo.com (GeoNames, CC BY 4.0)',
    'Place names: GeoNames',
  ])
    expect(all).toContain(want);
});

test('the AWS terrain fallback (Mapzen Terrain Tiles) is credited, with its sources linked', () => {
  const c = CREDITS.find((x) => creditText(x).startsWith('Terrain fallback: '));
  expect(c && creditText(c)).toBe('Terrain fallback: Terrain Tiles by Mapzen, on AWS (sources)');
  expect(creditHtml(c!)).toContain('href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md"');
});

test('the card credit line is the plan text, with Natural Earth (the card\'s region tiles and sea names)', () => {
  expect(CARD_CREDIT).toBe('Winds: NOAA GFS · Map: © OpenMapTiles © OpenStreetMap contributors · Natural Earth · Terrain: © Mapterhorn · A Still Signal build');
});

test('links open in a new tab without handing over the page, and text is escaped', () => {
  const html = creditHtml([{ text: 'A <b> & "c"', href: 'https://example.org/?a=1&b=2' }]);
  expect(html).toBe('<a href="https://example.org/?a=1&amp;b=2" target="_blank" rel="noopener">A &lt;b&gt; &amp; &quot;c&quot;</a>');
});
