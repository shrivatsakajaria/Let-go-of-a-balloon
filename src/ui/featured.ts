/**
 * The six featured cities on the start screen: one sideways row of plain text links, launch batch
 * only. Picked to spread across continents and skies (Europe, North America, East Asia, Oceania,
 * South America) and to end on Cappadocia, the place people know for balloon flights.
 * London is the default start, so it is not repeated here.
 */
import cities from '../../data/cities.json';

export type FeaturedCity = { id: string; name: string; lat: number; lon: number; spot: string };

export const FEATURED_IDS = ['paris', 'new-york', 'tokyo', 'sydney', 'rio-de-janeiro', 'cappadocia-goreme'] as const;

/** Short names where the sheet's city name carries a qualifier. */
const SHORT: Record<string, string> = { 'cappadocia-goreme': 'Cappadocia' };

type Row = { id: string; city: string; launch: { lat: number; lon: number; label: string } };

export function featuredCities(): FeaturedCity[] {
  const list = cities as Row[];
  return FEATURED_IDS.flatMap((id) => {
    const c = list.find((x) => x.id === id);
    return c ? [{ id, name: SHORT[id] ?? c.city, lat: c.launch.lat, lon: c.launch.lon, spot: c.launch.label }] : [];
  });
}

/**
 * Bearing from a featured city's launch spot to its landmark (spec 6.2: in view during the launch), or
 * undefined until the sheet has one (Task 21 confirms the spots; until then the director's fallback).
 */
export function landmarkHeading(cityId: string | undefined): number | undefined {
  if (!cityId) return undefined;
  const c = (cities as { id: string; launch: { headingDeg?: number | null } }[]).find((x) => x.id === cityId);
  const h = c?.launch.headingDeg;
  return typeof h === 'number' && Number.isFinite(h) ? h : undefined;
}
