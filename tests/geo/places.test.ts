import { beforeEach, describe, expect, test, vi } from 'vitest';
import { clearGazetteerCache } from '../../src/geo/gazetteer';
import { countryLabel, countryName, overText, placeOver, placeOverAt, withArticle, withCountry } from '../../src/geo/places';
import type { Label } from '../../src/world/meshjob';
import { stubGazetteer } from './helpers';

beforeEach(() => {
  clearGazetteerCache();
  vi.unstubAllGlobals();
  stubGazetteer({}, true);
});

const label = (name: string, kind: string, lat: number, lon: number): Label => ({ name, kind, lat, lon, x: 0, z: 0 });

test('over the sea reads "Over the North Sea"', async () => expect(overText(await placeOver({ lat: 56, lon: 3 }, []))).toBe('Over the North Sea'));

test('over a town reads "Over Leeds"', async () =>
  expect(overText(await placeOver({ lat: 53.8, lon: -1.55 }, [label('Leeds', 'city', 53.8, -1.55)]))).toBe('Over Leeds'));

test('over the town without tile labels uses the gazetteer', async () => expect(await placeOver({ lat: 53.8, lon: -1.55 }, [])).toBe('Leeds'));

test('a water name wins over a town label', async () =>
  expect(await placeOver({ lat: 54.37, lon: -2.93 }, [label('Windermere', 'lake', 54.37, -2.93), label('Bowness', 'town', 54.36, -2.92)])).toBe('Windermere'));

test('a town label further than 5 km is ignored', async () =>
  expect(await placeOver({ lat: 56, lon: 3 }, [label('Leeds', 'city', 56.2, 3)])).toBe('the North Sea'));

test('a park or peak is used when no town is near', async () =>
  expect(await placeOver({ lat: 54.45, lon: -3.1 }, [label('Scafell Pike', 'peak', 54.45, -3.1)])).toBe('Scafell Pike'));

test('the Lake District from the map regions, away from a town', async () => {
  expect(await placeOver({ lat: 54.5, lon: -3.15 }, [])).toBe('the Lake District');
});

test('a gazetteer sea cell off the coast is the sea', async () => {
  expect(await placeOver({ lat: 56.9, lon: -1.2 }, [])).toBe('the North Sea');
});

test('open water and countryside fall back plainly', async () => {
  expect(overText(await placeOver({ lat: 35, lon: -40 }, []))).toBe('Over the Atlantic Ocean');
});

test('article rules', () => {
  expect(withArticle('North Sea', 'sea')).toBe('the North Sea');
  expect(withArticle('Atlantic Ocean', 'ocean')).toBe('the Atlantic Ocean');
  expect(withArticle('Pacific', 'ocean')).toBe('the Pacific');
  expect(withArticle('Lake District', 'region')).toBe('the Lake District');
  expect(withArticle('Scottish Highlands', 'region')).toBe('the Scottish Highlands');
  expect(withArticle('Alps', 'region')).toBe('the Alps');
  expect(withArticle('Bay of Biscay', 'sea')).toBe('the Bay of Biscay');
  expect(withArticle('Gulf of Mexico', 'sea')).toBe('the Gulf of Mexico');
  expect(withArticle('English Channel', 'sea')).toBe('the English Channel');
  expect(withArticle('Persian Gulf', 'sea')).toBe('the Persian Gulf');
  expect(withArticle('Lake Windermere', 'lake')).toBe('Lake Windermere');
  expect(withArticle('Lake Windermere', 'sea')).toBe('Lake Windermere');
  expect(withArticle('Loch Ness', 'lake')).toBe('Loch Ness');
  expect(withArticle('Windermere', 'lake')).toBe('Windermere');
  expect(withArticle('Hudson Bay', 'bay')).toBe('Hudson Bay');
  expect(withArticle('Morecambe Bay', 'bay')).toBe('Morecambe Bay');
  expect(withArticle('Scandinavia', 'region')).toBe('Scandinavia');
  expect(withArticle('Isle of Man', 'region')).toBe('Isle of Man');
  expect(withArticle('Leeds', 'town')).toBe('Leeds');
  expect(withArticle('The Hague', 'town')).toBe('The Hague');
  expect(withArticle('open sea', 'sea')).toBe('the open sea');
});

test('a fountain or pond is not what the balloon is over, and a lake only counts close by', async () => {
  const p = { lat: 51.5007, lon: -0.1263 };
  const labels = [label('Jubilee Fountain', 'lake', 51.5009, -0.126), label('London', 'city', 51.507, -0.1277)];
  expect(await placeOver(p, labels)).toBe('London');
  const lake = [label('Serpentine', 'lake', 51.505, -0.165), label('London', 'city', 51.507, -0.1277)];
  expect(await placeOver(p, lake)).toBe('London'); // 2.7 km away: not under the balloon
  expect(await placeOver({ lat: 51.5055, lon: -0.166 }, lake)).toBe('Serpentine');
});

test('country names read naturally aloud: "the" where English uses it, and CLDR\'s long forms tidied', () => {
  expect(countryName('United Kingdom')).toBe('the United Kingdom');
  expect(countryName('United States')).toBe('the United States');
  expect(countryName('Netherlands')).toBe('the Netherlands');
  expect(countryName('Philippines')).toBe('the Philippines');
  expect(countryName('Solomon Islands')).toBe('the Solomon Islands');
  expect(countryName('France')).toBe('France');
  expect(countryName('Norway')).toBe('Norway');
  expect(countryName('Congo - Brazzaville')).toBe('the Republic of the Congo');
  expect(countryName('Congo - Kinshasa')).toBe('the Democratic Republic of the Congo');
  expect(countryName('Myanmar (Burma)')).toBe('Myanmar');
  expect(countryName('Hong Kong SAR China')).toBe('Hong Kong');
  expect(countryName('Macao SAR China')).toBe('Macao');
  expect(countryName('St. Lucia')).toBe('St Lucia');
  expect(countryName('U.S. Virgin Islands')).toBe('the US Virgin Islands');
  expect(countryName('Bosnia & Herzegovina')).toBe('Bosnia and Herzegovina');
  expect(countryName('Trinidad & Tobago')).toBe('Trinidad and Tobago');
  expect(countryName('Palestinian Territories')).toBe('the Palestinian Territories');
});

describe('countries people can place (owner\'s decision, 14 November 2026, panel review)', () => {
  test('countryLabel is the tidy name with no article', () => {
    expect(countryLabel('United Kingdom')).toBe('United Kingdom');
    expect(countryLabel('Congo - Kinshasa')).toBe('Democratic Republic of the Congo');
    expect(countryLabel('Bosnia & Herzegovina')).toBe('Bosnia and Herzegovina');
  });

  test('withCountry adds the country only when it is not the start\'s', () => {
    expect(withCountry('Strzelce Krajeńskie', 'Poland', 'Germany')).toBe('Strzelce Krajeńskie, Poland');
    expect(withCountry('Tillingham', 'United Kingdom', 'United Kingdom')).toBe('Tillingham');
    // unknown either side: left alone (the start's country is not known yet, or the place has none)
    expect(withCountry('Tillingham', 'United Kingdom', null)).toBe('Tillingham');
    expect(withCountry('the North Sea', undefined, 'United Kingdom')).toBe('the North Sea');
    // generic names stay lower case and alone (R56); a name that is the country is not said twice
    expect(withCountry('open countryside', 'France', 'United Kingdom')).toBe('open countryside');
    expect(withCountry('Luxembourg', 'Luxembourg', 'Belgium')).toBe('Luxembourg');
  });
});

describe('the country comes from the same source as the name (review of Task 29)', () => {
  // between Enschede and Gronau, on the Dutch-German border
  const border = { lat: 52.218, lon: 6.955 };

  test('a town label takes the country of the gazetteer town of that name, never the nearest town\'s', async () => {
    const at = await placeOverAt(border, [label('Enschede', 'city', 52.2215, 6.8937)]);
    expect(at).toEqual({ name: 'Enschede', country: 'Netherlands' });
    expect(withCountry(at.name, at.country, 'Germany')).toBe('Enschede, Netherlands');
    expect(withCountry(at.name, at.country, 'Netherlands')).toBe('Enschede');
  });

  test('water, parks and peaks name no country', async () => {
    expect(await placeOverAt({ lat: 53.4, lon: 6.0 }, [label('Wadden Sea', 'sea', 53.41, 6.0)])).toEqual({ name: 'the Wadden Sea' });
    expect(await placeOverAt(border, [label('Rutbeek', 'park', 52.22, 6.95)])).toEqual({ name: 'Rutbeek' });
  });

  test('a town label with no gazetteer town of its name names no country', async () => {
    expect(await placeOverAt(border, [label('Nowhereville', 'village', 52.218, 6.955)])).toEqual({ name: 'Nowhereville' });
  });

  test('a gazetteer town names its own country', async () => {
    expect(await placeOverAt({ lat: 53.8, lon: -1.55 }, [])).toEqual({ name: 'Leeds', country: 'United Kingdom' });
  });
});
