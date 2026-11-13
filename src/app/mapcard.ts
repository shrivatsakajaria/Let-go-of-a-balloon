/**
 * The landing card on the 2D map (spec 6.7: "show a simple 2D fallback of the route and the landing
 * card"). The map draws the card's picture (Fallback.mapImage: the real coastline, the route from the
 * start to the landing ring and the balloon there) in place of the 3D view; the card, its words,
 * sharing and the card view are the 3D flight's own (landingcard.ts). No three.js is loaded.
 */
import type { Fallback } from '../fallback/fallback2d';
import type { Route } from '../flight/route';
import { landingPlace } from '../geo/facts';
import type { CardScene } from '../ui/card';
import { CONTOUR } from '../world/palette';
import { presentCard } from './landingcard';
import { savedFor } from './world';

let ticket = 0;

/** The map's picture for the card: the route kept to the part of the picture above the fade into ink. */
export function mapScene(f: Pick<Fallback, 'mapImage'>): CardScene {
  return {
    async cardFrame(_route, w, h) {
      const map = await f.mapImage(w, h, { left: w * 0.1, right: w * 0.9, top: h * 0.12, bottom: h * 0.6 });
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      // land where no coastline tile is in (the map draws over its sky; the card has none)
      ctx.fillStyle = CONTOUR.land[1];
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(map, 0, 0);
      return { image: c, trail: [], landing: null };
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
  });
}
