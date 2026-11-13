/**
 * Town search: Open-Meteo's free place-name search, called from the visitor's browser, behind
 * an accessible combobox (WAI-ARIA 1.2: input role=combobox with aria-expanded, aria-controls and
 * aria-activedescendant over a listbox of options; arrow keys, Enter and Escape).
 */
import { COPY } from './copy';

export type Place = { name: string; admin1?: string; admin2?: string; country: string; lat: number; lon: number };

export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const SEARCH_DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

export function searchUrl(q: string): string {
  return `${GEOCODING_URL}?name=${encodeURIComponent(q)}&count=8&language=en`;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Places from an Open-Meteo response; entries without a name or usable coordinates are dropped. */
export function parsePlaces(json: unknown): Place[] {
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: Place[] = [];
  for (const r of results as Record<string, unknown>[]) {
    const name = text(r?.name);
    const lat = r?.latitude, lon = r?.longitude;
    if (!name || typeof lat !== 'number' || typeof lon !== 'number' || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) continue;
    out.push({ name, admin1: text(r.admin1), admin2: text(r.admin2), country: text(r.country) ?? '', lat, lon });
  }
  return out;
}

function join(parts: (string | undefined)[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (out.some((o) => o.toLowerCase() === p.toLowerCase())) continue; // "Singapore, Singapore"
    out.push(p);
  }
  return out.join(', ');
}

/** "Windermere, England, United Kingdom": name, region and country, missing or repeated parts left out. */
export function placeLabel(p: Place): string {
  return join([p.name, p.admin1, p.country]);
}

/** Labels for a result list; places that would share a label also show their district. */
export function placeLabels(ps: Place[]): string[] {
  const base = ps.map(placeLabel);
  return ps.map((p, i) => (base.indexOf(base[i]) !== base.lastIndexOf(base[i]) ? join([p.name, p.admin2, p.admin1, p.country]) : base[i]));
}

export async function searchPlaces(q: string, signal: AbortSignal): Promise<Place[]> {
  const res = await fetch(searchUrl(q), { signal });
  if (!res.ok) throw new Error(`place search ${res.status}`);
  return parsePlaces(await res.json());
}

export type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching'; q: string }
  | { kind: 'results'; q: string; places: Place[] }
  | { kind: 'empty'; q: string; message: string }
  | { kind: 'error'; q: string; message: string };

/** Debounced search: one request per pause in typing, the previous one aborted on every keystroke. */
export function createSearcher(
  fetcher: (q: string, signal: AbortSignal) => Promise<Place[]>,
  onState: (s: SearchState) => void,
  delayMs = SEARCH_DEBOUNCE_MS,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctrl: AbortController | undefined;
  const stop = () => {
    clearTimeout(timer);
    ctrl?.abort();
    ctrl = undefined;
  };
  return {
    input(raw: string) {
      stop();
      const q = raw.trim();
      if (q.length < MIN_CHARS) {
        onState({ kind: 'idle' });
        return;
      }
      timer = setTimeout(() => {
        const mine = new AbortController();
        ctrl = mine;
        onState({ kind: 'searching', q });
        fetcher(q, mine.signal).then(
          (places) => {
            if (ctrl !== mine) return; // a newer request owns the list
            onState(places.length ? { kind: 'results', q, places } : { kind: 'empty', q, message: COPY.noPlaces });
          },
          () => {
            if (ctrl !== mine || mine.signal.aborted) return;
            onState({ kind: 'error', q, message: COPY.searchFailed });
          },
        );
      }, delayMs);
    },
    cancel: stop,
  };
}

// ---- the combobox ------------------------------------------------------------

export type SearchUi = {
  el: HTMLElement;
  /** Open the search; `message` (e.g. "Location is off") is shown and announced in its status line. */
  open(message?: string): void;
  close(): void;
  readonly isOpen: boolean;
};

let uid = 0;

/**
 * The search layer. Hidden until opened; `onPick` gets the chosen place, `onCancel` fires on
 * Cancel or Escape with the list closed. Focus returns to whatever opened it.
 */
export function mountSearch(
  host: HTMLElement,
  opts: { onPick(p: Place, label: string): void; onCancel(): void; onOpenChange?(open: boolean): void; fetcher?: typeof searchPlaces },
): SearchUi {
  const id = `place-${++uid}`;
  const el = document.createElement('div');
  el.className = 'search';
  el.hidden = true;
  el.innerHTML = `
    <div class="search-bar">
      <label class="sr" for="${id}-input">${COPY.searchPlaceholder}</label>
      <input id="${id}-input" class="search-input" type="text" role="combobox" aria-autocomplete="list"
        aria-expanded="false" aria-controls="${id}-list" aria-describedby="${id}-status" autocomplete="off" autocapitalize="words"
        autocorrect="off" spellcheck="false" enterkeyhint="search" placeholder="${COPY.searchPlaceholder}">
      <button type="button" class="link cancel">${COPY.cancel}</button>
    </div>
    <ul id="${id}-list" class="search-list" role="listbox" aria-label="${COPY.searchPlaceholder}"></ul>
    <p id="${id}-status" class="search-status" role="status"></p>`;
  host.append(el);

  const input = el.querySelector('input')!;
  const list = el.querySelector('ul')!;
  const status = el.querySelector('.search-status') as HTMLElement;
  const cancel = el.querySelector('.cancel') as HTMLButtonElement;
  let places: Place[] = [];
  let labels: string[] = [];
  let active = -1;
  let returnFocus: HTMLElement | null = null;

  const setExpanded = (on: boolean) => {
    input.setAttribute('aria-expanded', String(on));
    list.hidden = !on;
    if (!on) setActive(-1);
  };
  const setActive = (i: number) => {
    active = i;
    list.querySelectorAll<HTMLElement>('[role="option"]').forEach((o, k) => o.setAttribute('aria-selected', String(k === i)));
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', `${id}-opt-${i}`);
      document.getElementById(`${id}-opt-${i}`)?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const say = (msg: string) => {
    status.textContent = msg;
    status.hidden = !msg;
  };

  const render = (s: SearchState) => {
    el.dataset.state = s.kind;
    if (s.kind === 'results') {
      places = s.places;
      labels = placeLabels(places);
      list.replaceChildren(...places.map((p, i) => {
        const li = document.createElement('li');
        li.id = `${id}-opt-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        const name = document.createElement('span');
        name.className = 'opt-name';
        name.textContent = p.name;
        li.append(name);
        const rest = labels[i].slice(p.name.length);
        if (rest) {
          const r = document.createElement('span');
          r.className = 'opt-rest';
          r.textContent = rest;
          li.append(r);
        }
        return li;
      }));
      say('');
      setExpanded(true);
    } else {
      places = [];
      labels = [];
      list.replaceChildren();
      setExpanded(false);
      say(s.kind === 'searching' ? COPY.searching : s.kind === 'idle' ? '' : s.message);
    }
  };

  const searcher = createSearcher(opts.fetcher ?? searchPlaces, render);
  const pick = (i: number) => {
    const p = places[i];
    if (!p) return;
    const label = labels[i];
    ui.close();
    opts.onPick(p, label);
  };

  input.addEventListener('input', () => searcher.input(input.value));
  // on the whole layer, so Escape also works from Cancel; arrows and Enter belong to the input
  el.addEventListener('keydown', (e) => {
    const n = places.length;
    const inInput = e.target === input;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (inInput && !list.hidden) setExpanded(false);
      else {
        ui.close();
        opts.onCancel();
      }
      return;
    }
    if (!inInput) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!n) return;
      e.preventDefault();
      if (list.hidden) setExpanded(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(active < 0 ? (step > 0 ? 0 : n - 1) : (active + step + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (n && !list.hidden) pick(active >= 0 ? active : 0);
    }
  });
  // keep focus in the input while choosing with a pointer
  list.addEventListener('pointerdown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('[role="option"]');
    if (li) pick(Number(li.id.slice(`${id}-opt-`.length)));
  });
  cancel.addEventListener('click', () => {
    ui.close();
    opts.onCancel();
  });

  const ui: SearchUi = {
    el,
    open(message?: string) {
      if (!el.hidden) return;
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.hidden = false;
      document.documentElement.classList.add('searching');
      opts.onOpenChange?.(true);
      input.value = '';
      render({ kind: 'idle' });
      input.focus({ preventScroll: true });
      // set the text a frame after the region is shown and focus has moved, so it is announced
      if (message) {
        requestAnimationFrame(() => {
          if (!el.hidden && el.dataset.state === 'idle' && !input.value) say(message);
        });
      }
    },
    close() {
      if (el.hidden) return;
      searcher.cancel();
      el.hidden = true;
      document.documentElement.classList.remove('searching');
      opts.onOpenChange?.(false);
      returnFocus?.focus({ preventScroll: true });
    },
    get isOpen() {
      return !el.hidden;
    },
  };
  return ui;
}
