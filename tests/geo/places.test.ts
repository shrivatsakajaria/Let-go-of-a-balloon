import { beforeEach, expect, test, vi } from 'vitest';
import { clearGazetteerCache } from '../../src/geo/gazetteer';
import { overText, placeOver, withArticle } from '../../src/geo/places';
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

test('far from any town it says what is nearby', async () => {
  expect(await placeOver({ lat: 56.9, lon: -1.2 }, [])).toBe('the North Sea');
});

test('open water and countryside fall back plainly', async () => {
  expect(overText(await placeOver({ lat: 35, lon: -40 }, []))).toBe('Over the North Atlantic Ocean');
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
