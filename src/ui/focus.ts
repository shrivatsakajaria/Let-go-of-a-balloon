/**
 * Where keyboard focus goes in the flight HUD when what had it is gone (the start screen behind a flight,
 * a card that opened by itself): the way back to the card if there is one, else the whole trip, else Pause.
 * In that order of priority, not document order (Pause comes first in the HUD).
 */
export function hudFocusTarget(hud: ParentNode): HTMLElement | null {
  return (
    hud.querySelector<HTMLElement>('.show-card:not([hidden])') ??
    hud.querySelector<HTMLElement>('.trip:not([hidden])') ??
    hud.querySelector<HTMLElement>('.pause')
  );
}
