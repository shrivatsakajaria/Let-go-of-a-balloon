/**
 * The size of the soft shading behind the chrome's text, shared by the start screen and the HUD.
 *
 * The shading bands (spec 7.1, ruling R54) hold full strength over their first 45% (top) or 55% (bottom),
 * then fall softly to nothing. Each is sized to its text, never shorter than 7.1's figure: the top band so
 * the text's lowest edge sits at 45%; the bottom band so the top of the stack sits at 60%, where the
 * shading is still above 90% (enough for 16 px text at 4.5:1 over snow).
 */
export const SHADE_TOP_FIT = 0.45;
export const SHADE_BOTTOM_FIT = 0.6;
/** The top band for text whose lowest edge is `textBottomPx` from the top of the screen. */
export const shadeTopPx = (textBottomPx: number): number => Math.max(170, Math.ceil(textBottomPx / SHADE_TOP_FIT));
/** The bottom band for a stack `stackPx` tall at the bottom of the screen. */
export const shadeBottomPx = (stackPx: number): number => Math.max(300, Math.ceil(stackPx / SHADE_BOTTOM_FIT));
