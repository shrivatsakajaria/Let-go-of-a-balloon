/**
 * "Add to calendar" (owner's decision, 14 November 2026, panel review): one event at the expected landing,
 * in UTC, with the balloon's own link and a reminder 15 minutes before. RFC 5545 text: CRLF line ends,
 * TEXT values escaped, lines folded at 75 octets.
 */
import { FLIGHT_HOURS, SITE_URL } from '../config';
import { isInAppBrowser } from './card';

const pad = (n: number) => String(n).padStart(2, '0');

/** "20261117T151100Z": UTC, basic format, to the minute. */
export function icsDate(utcMs: number): string {
  const d = new Date(Math.floor(utcMs / 60e3) * 60e3);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

/** A TEXT value: backslash, semicolon and comma escaped, new lines as \n. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold a content line at 75 octets (CRLF and one space before each continuation), between characters. */
export function icsFold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length ? 74 : 75; // a continuation starts with its space
    if (bytes + n > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export type LandingEventInput = {
  release: number;
  /** The start place as said in a sentence: "London", "your location". */
  home: string;
  /** The visitor's own balloon ("My balloon ...") or someone else's ("A balloon ..."). */
  own: boolean;
  /** The balloon's own link. */
  link: string;
  now: number;
  /** Stable per balloon, so adding it twice updates the one event. */
  uid: string;
};

const EVENT_MIN = 15;
const HOST = new URL(SITE_URL).host;

/** The whole .ics file for the landing. */
export function landingEvent(e: LandingEventInput): string {
  const at = e.release + FLIGHT_HOURS * 3600e3;
  const title = `${e.own ? 'My' : 'A'} balloon from ${e.home} lands`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Let go of a balloon//Landing//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}@${HOST}`,
    `DTSTAMP:${icsDate(e.now)}`,
    `DTSTART:${icsDate(at)}`,
    `DTEND:${icsDate(at + EVENT_MIN * 60e3)}`,
    `SUMMARY:${icsEscape(title)}`,
    `DESCRIPTION:${icsEscape(`See where it comes down: ${e.link}`)}`,
    `URL:${e.link}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(title)}`,
    'TRIGGER:-PT15M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/**
 * How this browser takes the file (review of Task 29). iOS (iPadOS too, which says it is a Mac) opens a
 * text/calendar data URL as "Add to Calendar", where a download would only offer "Save to Files". In-app
 * browsers (LinkedIn, X, Facebook, Instagram) drop both, so the control is not offered there. Everywhere
 * else the file downloads.
 */
export type CalendarWay = 'open' | 'download' | 'none';
export function calendarWay(ua: string, touchPoints = 0): CalendarWay {
  if (isInAppBrowser(ua)) return 'none';
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1) ? 'open' : 'download';
}

/** The file as a data URL, for iOS. */
export function icsDataUrl(text: string): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(text)}`;
}

/** Hand the file to the browser: opened on iOS, downloaded elsewhere (the object URL let go once it has it). */
export function saveIcs(text: string, way: CalendarWay, filename = 'balloon-landing.ics'): void {
  if (way === 'none') return;
  const a = document.createElement('a');
  a.rel = 'noopener';
  a.hidden = true;
  let url = '';
  if (way === 'open') a.href = icsDataUrl(text);
  else {
    url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    a.href = url;
    a.download = filename;
  }
  document.body.append(a);
  a.click();
  a.remove();
  if (url) setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
