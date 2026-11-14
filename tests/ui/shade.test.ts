import { expect, test } from 'vitest';
import { SHADE_BOTTOM_FIT, SHADE_TOP_FIT, shadeBottomPx, shadeTopPx } from '../../src/ui/shade';

test('the top band is 170 px at the least, and grows so the text ends where its full strength ends', () => {
  expect(shadeTopPx(60)).toBe(170);
  expect(shadeTopPx(76.5)).toBe(170);
  // the two-line replay label ends at 107 px: the band grows to 238 px
  expect(shadeTopPx(107)).toBe(238);
  expect(shadeTopPx(107) * SHADE_TOP_FIT).toBeGreaterThanOrEqual(107);
});

test('the bottom band is 300 px at the least, and puts the top of the stack at 60% of its height', () => {
  expect(shadeBottomPx(120)).toBe(300);
  expect(shadeBottomPx(264)).toBe(440);
  expect(shadeBottomPx(264) * SHADE_BOTTOM_FIT).toBeGreaterThanOrEqual(264);
});
