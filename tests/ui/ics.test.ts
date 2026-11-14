import { describe, expect, test } from 'vitest';
import { icsDate, icsEscape, icsFold, landingEvent } from '../../src/ui/ics';

const LINK = 'https://let-go-of-a-balloon.pages.dev/#b=AbCdEf-_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

describe('the .ics text', () => {
  test('dates are UTC basic format, seconds dropped', () => {
    expect(icsDate(Date.UTC(2026, 10, 17, 9, 5, 42))).toBe('20261117T090500Z');
  });

  test('text escapes backslash, semicolon, comma and new lines', () => {
    expect(icsEscape('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });

  test('lines fold at 75 octets with CRLF and a space, never inside a UTF-8 character', () => {
    const line = `SUMMARY:${'é'.repeat(80)}`;
    const folded = icsFold(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const [i, p] of parts.entries()) {
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
      if (i) expect(p.startsWith(' ')).toBe(true);
    }
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
    expect(icsFold('SHORT:1')).toBe('SHORT:1');
  });

  const release = Date.UTC(2026, 10, 14, 15, 11, 0);
  const ics = landingEvent({ release, home: 'London', own: true, link: LINK, now: Date.UTC(2026, 10, 14, 15, 40, 7), uid: '29598-2026111412-515007,-1263' });
  const unfolded = ics.replace(/\r\n /g, '');
  const lines = unfolded.split('\r\n');

  test('one event at the expected landing (72 h after release), in UTC, 15 minutes long', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines).toContain('DTSTART:20261117T151100Z');
    expect(lines).toContain('DTEND:20261117T152600Z');
    expect(lines).toContain('DTSTAMP:20261114T154000Z');
    expect(lines).toContain('UID:29598-2026111412-515007,-1263@let-go-of-a-balloon.pages.dev');
  });

  test('titled "My balloon from London lands", with the balloon\'s own link in the description and URL', () => {
    expect(lines).toContain('SUMMARY:My balloon from London lands');
    expect(lines).toContain(`URL:${LINK}`);
    expect(lines).toContain(`DESCRIPTION:See where it comes down: ${LINK}`);
  });

  test('a reminder 15 minutes before', () => {
    const alarm = lines.slice(lines.indexOf('BEGIN:VALARM'), lines.indexOf('END:VALARM') + 1);
    expect(alarm).toContain('ACTION:DISPLAY');
    expect(alarm).toContain('TRIGGER:-PT15M');
    expect(alarm).toContain('DESCRIPTION:My balloon from London lands');
  });

  test('every line is CRLF-terminated and no longer than 75 octets', () => {
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  test('someone else\'s balloon, and names with commas, are said and escaped plainly', () => {
    const other = landingEvent({ release, home: 'Washington, D.C.', own: false, link: LINK, now: release, uid: 'x' }).replace(/\r\n /g, '');
    expect(other).toContain('SUMMARY:A balloon from Washington\\, D.C. lands');
  });
});
