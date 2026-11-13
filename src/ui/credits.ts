/**
 * Every credit, once (the plan's Global Constraints give the exact text; spec 9 the sources). The map
 * corner shows MAP_CREDIT over the 3D view, the 2D map and the HUD; the Credits page lists CREDITS
 * and ends with "A Still Signal build"; the landing card prints CARD_CREDIT.
 */
import { COPY } from './copy';

/** Plain text, or text linked to the source's attribution page. */
export type CreditPart = string | { text: string; href: string };
export type Credit = CreditPart[];

const OPENFREEMAP = { text: 'OpenFreeMap', href: 'https://openfreemap.org' };
const OPENMAPTILES = { text: '© OpenMapTiles', href: 'https://www.openmaptiles.org/' };
const OSM = { text: 'Data from OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' };
const MAPTERHORN = { text: '© Mapterhorn', href: 'https://mapterhorn.com/attribution' };
const GEONAMES = { text: 'GeoNames', href: 'https://www.geonames.org/' };

/** "OpenFreeMap © OpenMapTiles Data from OpenStreetMap © Mapterhorn", always visible over the map. */
export const MAP_CREDIT: Credit = [OPENFREEMAP, ' ', OPENMAPTILES, ' ', OSM, ' ', MAPTERHORN];

/** The Credits page, one source a line. */
export const CREDITS: Credit[] = [
  ['Map: ', OPENFREEMAP, ' ', OPENMAPTILES, ' ', OSM],
  ['Terrain: ', MAPTERHORN],
  ['© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.'],
  ['Winds: ', { text: 'NOAA GFS', href: 'https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast' }],
  ['Place search: ', { text: 'Open-Meteo.com', href: 'https://open-meteo.com/' }, ' (', GEONAMES, ', ', { text: 'CC BY 4.0', href: 'https://creativecommons.org/licenses/by/4.0/' }, ')'],
  ['Place names: ', GEONAMES],
  ['Sea and region names: ', { text: 'Natural Earth', href: 'https://www.naturalearthdata.com/' }],
  ['Type: Archivo, ', { text: 'SIL Open Font License', href: '/fonts/OFL.txt' }],
];

/** The landing card's footer line. */
export const CARD_CREDIT = `Winds: NOAA GFS · Map: © OpenMapTiles © OpenStreetMap contributors · Terrain: © Mapterhorn · ${COPY.stillSignal}`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function creditText(c: Credit): string {
  return c.map((p) => (typeof p === 'string' ? p : p.text)).join('');
}

/** The credit as HTML, each source a link that opens in a new tab. */
export function creditHtml(c: Credit): string {
  return c.map((p) => (typeof p === 'string' ? esc(p) : `<a href="${esc(p.href)}" target="_blank" rel="noopener">${esc(p.text)}</a>`)).join('');
}
