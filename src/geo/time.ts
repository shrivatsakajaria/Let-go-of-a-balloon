import tzlookup from '@photostructure/tz-lookup';
import type { LatLon } from './coords';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Local clock at a place, e.g. "Sun 21:00". Over open sea the zone is an Etc/GMT offset. */
export function localTime(utcMs: number, p: LatLon): { label: string; tz: string } {
  const tz = tzlookup(p.lat, p.lon);
  const parts = formatterFor(tz).formatToParts(new Date(utcMs));
  const get = (type: string): string => parts.find((x) => x.type === type)?.value ?? '';
  return { label: `${get('weekday')} ${get('hour')}:${get('minute')}`, tz };
}
