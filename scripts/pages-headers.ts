/**
 * Reads public/_headers the way Cloudflare Pages does, for the tests: a rule is a path pattern on its
 * own line (`*` matches anything, `:name` one path segment) followed by indented `Name: value`
 * lines. Every rule whose pattern matches a path applies to it (Pages joins repeated header names
 * with a comma, which is why the file keeps them disjoint).
 */
export type HeaderRule = { pattern: string; headers: Record<string, string>; match(path: string): boolean };

export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const pattern = line.trim();
      const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/:[A-Za-z]\w*/g, '[^/]+')}$`);
      rules.push({ pattern, headers: {}, match: (p) => re.test(p) });
      continue;
    }
    const rule = rules.at(-1);
    const i = line.indexOf(':');
    if (!rule || i < 0) throw new Error(`_headers: cannot read "${line}"`);
    rule.headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return rules;
}

/** The headers Pages sends for a path (lower-case names; a repeated name joined with ", "). */
export function headersFor(rules: HeaderRule[], path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rules) if (r.match(path)) for (const [k, v] of Object.entries(r.headers)) out[k] = k in out ? `${out[k]}, ${v}` : v;
  return out;
}

/** A Content-Security-Policy value as directive -> sources. */
export function parseCsp(value: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of value.split(';')) {
    const [name, ...src] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = src;
  }
  return out;
}
