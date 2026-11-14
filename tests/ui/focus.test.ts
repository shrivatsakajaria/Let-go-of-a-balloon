import { expect, test } from 'vitest';
import { hudFocusTarget } from '../../src/ui/focus';

/** A HUD holding the buttons that match these selectors (selector -> a name for the button). */
const hud = (present: Record<string, string>) =>
  ({ querySelector: (sel: string) => (sel in present ? { name: present[sel] } : null) }) as unknown as ParentNode;
const name = (el: HTMLElement | null) => (el as unknown as { name: string } | null)?.name ?? null;

test('the way back to the card first, then the whole trip, then Pause: priority, not document order', () => {
  const pause = { '.pause': 'pause' };
  const trip = { ...pause, '.trip:not([hidden])': 'trip' };
  expect(name(hudFocusTarget(hud({ ...trip, '.show-card:not([hidden])': 'card' })))).toBe('card');
  expect(name(hudFocusTarget(hud(trip)))).toBe('trip');
  expect(name(hudFocusTarget(hud(pause)))).toBe('pause');
  expect(hudFocusTarget(hud({}))).toBeNull();
});
