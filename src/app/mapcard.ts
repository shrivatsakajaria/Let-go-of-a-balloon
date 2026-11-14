/**
 * The landing card on the 2D map (spec 6.7: "show a simple 2D fallback of the route and the landing
 * card"). The same card as the 3D flight's, design A's layout and type, over a simple flat map: the
 * real coastline (Fallback.cardMap) with the route fitted into the picture, the card's painter drawing
 * the route, the start ring, the balloon, the names and the panel over it. No reveal (no 3D world), no
 * three.js loaded; the card, its words, sharing and the card view are the 3D flight's own (landingcard.ts).
 */
import type { Fallback } from '../fallback/fallback2d';
import type { Route } from '../flight/route';
import { landingPlace } from '../geo/facts';
import type { CardPicture, CardScene } from '../ui/card';
import { CARD_W, PICTURE_H } from '../ui/cardplace';
import { hudFocusTarget } from '../ui/focus';
import { CONTOUR } from '../world/palette';
import { presentCard } from './landingcard';
import { savedFor } from './world';

let ticket = 0;

/** Where the route goes on the card's map: the start and landing clear of the edges and of the fade into ink. */
const BAND = { left: CARD_W * 0.16, right: CARD_W * 0.84, top: PICTURE_H * 0.2, bottom: PICTURE_H * 0.7 };

/** The map's picture for the card: land and sea, the route projected onto it. */
export function mapScene(f: Pick<Fallback, 'cardMap'>): CardScene {
  return {
    async cardPicture(route: Route): Promise<CardPicture | null> {
      const map = await f.cardMap(CARD_W, PICTURE_H, BAND);
      if (!map) return null;
      const pts = Array.from({ length: map.px.length / 2 }, (_, i) => ({ x: map.px[i * 2], y: map.px[i * 2 + 1], seen: true }));
      return {
        image: map.image,
        sky: { top: CONTOUR.waterDeep, horizon: CONTOUR.waterDeep, night: 0 },
        route: pts,
        routeSec: route.points.map((p) => p.tSec),
        start: pts[0] ?? null,
        landing: pts[pts.length - 1] ?? null,
        horizon: [],
        places: [],
        towns: [],
      };
    },
  };
}

/** The card for the balloon on the map (its onCard, and "Show the card"). */
export async function showMapCard(f: Fallback, route: Route): Promise<void> {
  const fl = f.shown;
  if (!fl || fl.route !== route) return;
  const t = ++ticket;
  f.hud.setCard(() => void showMapCard(f, route));
  await presentCard({
    scene: mapScene(f),
    route,
    saved: savedFor(fl),
    own: fl.own,
    landing: landingPlace(route).catch(() => null),
    isCurrent: () => t === ticket && f.shown?.route === route,
    // the card goes on being made while this balloon is on the map ("Show the card" meanwhile shares it)
    alive: () => f.shown?.route === route,
    fallbackFocus: () => hudFocusTarget(f.hud.el),
  });
}
