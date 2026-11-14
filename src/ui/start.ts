/**
 * The start screen chrome (spec 6.1): title, explainer, "From London" (opens the town search),
 * Let go, "Use my location", six featured cities, and "Your balloons" when there are any.
 * It sits over the scene layer (#scene): a sky gradient for the start place's real light until
 * the 3D world takes its place.
 */
import type { SavedBalloon } from '../flight/codec';
import { balloonStatus, store } from '../flight/store';
import type { LatLon } from '../geo/coords';
import { sunPosition } from '../geo/sun';
import { lightFor, parseHex } from '../world/palette';
import { COPY } from './copy';
import { shadeBottomPx, shadeTopPx } from './shade';
import { CREDITS, MAP_LINE, creditHtml } from './credits';
import { featuredCities } from './featured';
import { mountSearch, type Place } from './search';
import { aloftText, positionNow, whereText } from './mine';
import { nearestPlace } from '../geo/gazetteer';
import { countryAt } from '../geo/places';

export type StartKind = 'default' | 'featured' | 'search' | 'gps';
export type StartChoice = { name: string; lat: number; lon: number; kind: StartKind; cityId?: string };

export type StartHandlers = {
  onLetGo(start: StartChoice): void;
  onOpenBalloon(b: SavedBalloon): void;
  /** The start place changed (also called once at mount): the live scene moves there. */
  onStartChange?(start: StartChoice): void;
};

export type StartScreen = {
  readonly start: StartChoice;
  setStart(c: StartChoice): void;
  /**
   * Relative luminance (0..1) of the scene behind the top and bottom text, measured about once a
   * second by whoever draws the scene; it darkens the shading by up to 0.15 when bright.
   */
  setBackdropLuminance(top: number, bottom: number): void;
  /** Read "Your balloons" again (a balloon was just saved). */
  refresh(): void;
  destroy(): void;
};

/** Parliament Square, London: where the first balloon starts. */
export const DEFAULT_START: StartChoice = { name: 'London', lat: 51.5007, lon: -0.1263, kind: 'default', cityId: 'london' };

export const LAST_PLACE_KEY = 'lgoab.lastPlace.v1';
const KINDS: StartKind[] = ['default', 'featured', 'search', 'gps'];

/** The last place used, or Parliament Square. Storage may be missing, full, blocked or junk. */
export function readLastPlace(): StartChoice {
  try {
    const raw = localStorage.getItem(LAST_PLACE_KEY);
    if (!raw) return DEFAULT_START;
    const c = JSON.parse(raw) as Partial<StartChoice> | null;
    if (
      !c || typeof c.name !== 'string' || !c.name || !KINDS.includes(c.kind as StartKind) ||
      typeof c.lat !== 'number' || typeof c.lon !== 'number' || !(Math.abs(c.lat) <= 90) || !(Math.abs(c.lon) <= 180)
    ) return DEFAULT_START;
    const out: StartChoice = { name: c.name, lat: c.lat, lon: c.lon, kind: c.kind as StartKind };
    if (typeof c.cityId === 'string') out.cityId = c.cityId;
    return out;
  } catch {
    return DEFAULT_START;
  }
}

export function writeLastPlace(c: StartChoice): void {
  try {
    localStorage.setItem(LAST_PLACE_KEY, JSON.stringify(c));
  } catch {
    /* private mode or full: the next visit starts from London */
  }
}

/** The tappable line above Let go: "From London", "From your location". */
export function fromLine(c: StartChoice): string {
  return `${COPY.from} ${c.kind === 'gps' ? COPY.yourLocation.toLowerCase() : c.name}`;
}

/**
 * The names in "Your balloons" (2.4.6): a balloon let go from "Your location" goes by its place once that is
 * known (as on its card), and balloons that share a name each say when they were let go ("Bristol · let go
 * 14:05"). `place` is null until looked up (the name stays as it was).
 */
export function mineNames(items: { name: string; place: string | null; letGo: string }[]): string[] {
  const names = items.map((i) => (i.name === COPY.yourLocation && i.place ? i.place : i.name));
  return names.map((n, k) => (items[k].letGo && names.filter((m) => m === n).length > 1 ? `${n} · let go ${items[k].letGo}` : n));
}

/** Names that need the gazetteer or a time to tell them apart: a "Your location" balloon, or a name shared. */
export function mineNeedsNaming(names: string[]): boolean {
  return names.some((n, k) => n === COPY.yourLocation || names.indexOf(n) !== k);
}

/** WCAG relative luminance of a hex colour. */
export function luminance(hex: string): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseHex(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Extra shading (0 to 0.15) for a backdrop of luminance L: none on dark skies, full from L 0.6. */
export function shadeBoost(L: number): number {
  if (!Number.isFinite(L)) return 0.15;
  return 0.15 * Math.min(1, Math.max(0, (L - 0.25) / 0.35));
}

/** The placeholder sky for a place now: the Contour light at the real sun elevation. */
export function skyFor(p: LatLon, nowMs: number): { top: string; horizon: string } {
  const light = lightFor(sunPosition(nowMs, p).elevationDeg);
  return { top: light.skyTop, horizon: light.skyHorizon };
}

/** Solid worst-case backdrops for the contrast check (?backdrop=noon|snow|sand; test and preview builds only). */
export const TEST_BACKDROPS: Record<string, string> = { noon: '#d6e8f0', snow: '#f4f6f8', sand: '#e6d6a2' };

/**
 * "Location is off" is said once; after a refusal the link only opens the search. A timeout or an
 * unavailable position is not a refusal: it says so and the next tap asks again.
 */
let locationRefused = false;
const SEARCH_WAIT_MS = 600;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Small line icons (stroke in the text colour, hidden from screen readers): a map pin, a chevron, a locate mark. */
const svg = (cls: string, d: string) =>
  `<svg class="icon ${cls}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const PIN = svg('pin', '<path d="M8 14.5s-4.5-4.2-4.5-7.6a4.5 4.5 0 0 1 9 0c0 3.4-4.5 7.6-4.5 7.6z"/><circle cx="8" cy="6.9" r="1.6"/>');
const CHEVRON = svg('chev', '<path d="M4.5 6.5 8 10l3.5-3.5"/>');
const LOCATE = svg('loc', '<circle cx="8" cy="8" r="4.2"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2"/>');
/** "About" opens the one About sheet from anywhere (the flight HUD's small print has one too). */
export const ABOUT_EVENT = 'lgoab:about';

export function mountStart(
  root: HTMLElement,
  handlers: StartHandlers,
  opts: { scene?: HTMLElement | null; backdrop?: string | null; now?: () => number } = {},
): StartScreen {
  const now = opts.now ?? Date.now;
  const scene = opts.scene ?? document.getElementById('scene');
  const cities = featuredCities();
  let start = readLastPlace();
  /** For a searched start: the move to open space, under way or done. */
  let openSpace: Promise<LatLon> | null = null;

  document.querySelectorAll('.shade').forEach((s) => s.remove());
  const shades = ['shade-top', 'shade-bottom ink-bottom'].map((c) => {
    const d = document.createElement('div');
    d.className = `shade ${c}`;
    d.setAttribute('aria-hidden', 'true');
    root.before(d);
    return d;
  });

  root.classList.add('start');
  // owner's decisions, 14 November 2026 (panel review): the place, "Use my location" and the cities look like
  // the controls they are; the small print is one line, and the rest is in the About sheet
  root.innerHTML = `
    <header class="top">
      <div>
        <h1 class="title">${COPY.title}</h1>
        <p class="explainer">${esc(COPY.explainer)}</p>
      </div>
      <button type="button" class="link credits-link about-link" aria-haspopup="dialog">${COPY.about}</button>
    </header>
    <div class="bottom">
      <button type="button" class="chip from"></button>
      <div class="go-row">
        <button type="button" class="letgo">${COPY.letGo}</button>
        <button type="button" class="secondary locate">${COPY.useMyLocation}</button>
      </div>
      <ul class="cities" aria-label="${COPY.featured}">
        ${cities.map((c) => `<li><button type="button" class="chip city" data-city="${c.id}" aria-pressed="false">${esc(c.name)}</button></li>`).join('')}
      </ul>
      <div class="mine" hidden></div>
      <p class="small fineprint"><span class="notice">${COPY.simulation}</span><span class="map-credit">${creditHtml(MAP_LINE)}</span></p>
    </div>
    <dialog class="credits about" aria-labelledby="credits-title">
      <div class="credits-head">
        <h2 id="credits-title">${COPY.about}</h2>
        <button type="button" class="link credits-close">${COPY.close}</button>
      </div>
      <p class="about-text">${esc(COPY.notice)}</p>
      <p class="about-text">${esc(COPY.next)}</p>
      <h3 class="about-sub">${COPY.credits}</h3>
      <footer>
        <ul>${CREDITS.map((c) => `<li>${creditHtml(c)}</li>`).join('')}</ul>
        <p class="sig">${COPY.stillSignal}</p>
      </footer>
    </dialog>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const fromBtn = $<HTMLButtonElement>('.from');
  const letGoBtn = $<HTMLButtonElement>('.letgo');
  const locateBtn = $<HTMLButtonElement>('.locate');
  const setLocate = (label: string) => (locateBtn.innerHTML = `${LOCATE}<span>${esc(label)}</span>`);
  setLocate(COPY.useMyLocation);
  const mine = $<HTMLElement>('.mine');
  const credits = $<HTMLDialogElement>('.credits');
  const bottom = $<HTMLElement>('.bottom');

  // ---- the scene behind ----
  const setBackdropLuminance = (top: number, bot: number) => {
    const b = shadeBoost(Math.max(top, bot));
    document.documentElement.style.setProperty('--boost', b.toFixed(3));
  };
  const paintSky = () => {
    if (!scene || scene.dataset.live) return; // the 3D world measures its own brightness
    if (__LGOAB_TEST_HOOKS__ && opts.backdrop && TEST_BACKDROPS[opts.backdrop]) {
      const c = TEST_BACKDROPS[opts.backdrop];
      scene.style.background = c;
      setBackdropLuminance(luminance(c), luminance(c));
      return;
    }
    const sky = skyFor(start, now());
    scene.style.background = `linear-gradient(to bottom, ${sky.top} 0%, ${sky.horizon} 100%)`;
    setBackdropLuminance(luminance(sky.top), luminance(sky.horizon));
  };
  const sceneTimer = setInterval(paintSky, 60_000);

  // ---- the shading fits the text: each stack sits in its band's full-strength part ----
  const head = $<HTMLElement>('.top');
  const fitShade = () => {
    const root = document.documentElement.style;
    root.setProperty('--shade-bottom-h', `${shadeBottomPx(bottom.getBoundingClientRect().height)}px`);
    root.setProperty('--shade-top-start', `${shadeTopPx(head.getBoundingClientRect().bottom)}px`);
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fitShade) : null;
  ro?.observe(bottom);
  ro?.observe(head);

  // ---- start place ----
  const render = () => {
    fromBtn.innerHTML = `${PIN}<span class="from-text">${COPY.from} <span class="place">${esc(start.kind === 'gps' ? COPY.yourLocation.toLowerCase() : start.name)}</span></span>${CHEVRON}`;
    fromBtn.setAttribute('aria-label', `${fromLine(start)}. Search for a town`);
    root.querySelectorAll<HTMLButtonElement>('.city').forEach((b) => {
      b.setAttribute('aria-pressed', String(start.kind === 'featured' && b.dataset.city === start.cityId));
    });
    paintSky();
  };
  const setStart = (c: StartChoice) => {
    start = c;
    if (c.kind !== 'search') openSpace = null;
    render();
    handlers.onStartChange?.(c);
  };

  // ---- your balloons ----
  let mineRun = 0;
  /** Name the "Your location" balloons by their place (looked up in the background; the code loads on demand). */
  const nameMine = async (list: SavedBalloon[], els: HTMLElement[], run: number) => {
    try {
      const [{ startName }, { localTime }] = await Promise.all([import('./card'), import('../geo/time')]);
      const places = await Promise.all(
        list.map((b) => (b.name === COPY.yourLocation ? nearestPlace(b.start).then((p) => startName(b.start, p), () => startName(b.start, null)) : null)),
      );
      if (run !== mineRun) return;
      const names = mineNames(list.map((b, k) => ({ name: b.name, place: places[k], letGo: localTime(b.release, b.start).label.split(' ').pop() ?? '' })));
      names.forEach((n, k) => {
        if (els[k].textContent !== n) els[k].textContent = n;
      });
    } catch {
      /* the names stay as saved */
    }
  };
  /** Where each balloon is now, looked up in the background (the gazetteer files load on demand). */
  const whereMine = async (list: SavedBalloon[], els: HTMLElement[], run: number) => {
    await Promise.all(
      list.map(async (b, k) => {
        try {
          const t = now();
          const [place, home] = await Promise.all([nearestPlace(positionNow(b, t)).catch(() => null), countryAt(b.start)]);
          if (run !== mineRun) return;
          const text = whereText(place, balloonStatus(b, t).landed, home);
          if (els[k].textContent !== text) els[k].textContent = text;
        } catch {
          /* the row says where it started and how long it has been up */
        }
      }),
    );
  };
  /**
   * Rows shown before "Show all": the newest few, so the middle third stays clear for the person and the balloon
   * (one on a short screen, such as a phone inside an in-app browser; three on a taller one).
   */
  const mineRows = () => ((window.innerHeight || 844) < 760 ? 1 : 3);
  let mineAll = false;
  const renderMine = () => {
    const run = ++mineRun;
    const list = store.list();
    mine.hidden = list.length === 0;
    mine.replaceChildren();
    if (!list.length) return;
    const head = document.createElement('div');
    head.className = 'mine-head';
    const label = document.createElement('h2');
    label.className = 'mine-label';
    label.id = 'mine-label';
    label.textContent = COPY.yourBalloons;
    head.append(label);
    mine.setAttribute('role', 'group');
    mine.setAttribute('aria-labelledby', 'mine-label');
    const ul = document.createElement('ul');
    ul.className = 'mine-list';
    mine.append(head, ul);
    const rows = mineRows();
    const shown = mineAll ? list : list.slice(0, rows);
    const nameEls: HTMLElement[] = [];
    const whereEls: HTMLElement[] = [];
    for (const b of shown) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mine-row';
      // read as "London, Over the North Sea, 14 h aloft"; laid out as name and time, then where
      btn.innerHTML = `<span class="mine-name"></span><span class="sr">, </span><span class="mine-where"></span><span class="sr">, </span><span class="mine-time"></span>${CHEVRON.replace('icon chev', 'icon chev mine-chev')}`;
      const nm = btn.querySelector<HTMLElement>('.mine-name')!;
      nm.textContent = b.name;
      nameEls.push(nm);
      whereEls.push(btn.querySelector<HTMLElement>('.mine-where')!);
      btn.querySelector<HTMLElement>('.mine-time')!.textContent = aloftText(b, now());
      btn.addEventListener('click', () => {
        handlers.onOpenBalloon(b);
      });
      li.append(btn);
      ul.append(li);
    }
    if (list.length > rows) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'link mine-more';
      more.textContent = mineAll ? COPY.showFewer : COPY.showAll(list.length);
      more.setAttribute('aria-expanded', String(mineAll));
      more.addEventListener('click', () => {
        mineAll = !mineAll;
        renderMine();
        fitShade();
        mine.querySelector<HTMLButtonElement>('.mine-more')?.focus({ preventScroll: true });
      });
      head.append(more);
    }
    if (mineNeedsNaming(shown.map((b) => b.name))) void nameMine(shown, nameEls, run);
    void whereMine(shown, whereEls, run);
  };

  // ---- search ----
  const search = mountSearch(document.body, {
    onPick(p: Place) {
      setStart({ name: p.name, lat: p.lat, lon: p.lon, kind: 'search' });
      const picked = start;
      // move the start out of any building while the visitor reaches for Let go
      // the chunk can fail to load (a flaky connection, a new deploy): then the start stays put
      openSpace = import('../flight/startspot')
        .then((m) => m.openSpaceFor({ lat: p.lat, lon: p.lon }))
        .catch(() => ({ lat: p.lat, lon: p.lon }));
      openSpace.then((q) => {
        if (start === picked) {
          start = { ...picked, lat: q.lat, lon: q.lon };
          handlers.onStartChange?.(start);
        }
      });
      letGoBtn.focus({ preventScroll: true });
    },
    onCancel() {},
    onOpenChange(open) {
      root.inert = open; // the start screen sits under the search veil
    },
  });
  const openSearch = (message?: string) => search.open(message);

  fromBtn.addEventListener('click', () => openSearch());

  // ---- let go ----
  letGoBtn.addEventListener('click', async () => {
    if (letGoBtn.getAttribute('aria-busy') === 'true') return;
    let choice = start;
    if (choice.kind === 'search' && openSpace) {
      letGoBtn.setAttribute('aria-busy', 'true');
      try {
        const moved = await Promise.race([openSpace, new Promise<null>((r) => setTimeout(() => r(null), SEARCH_WAIT_MS))]);
        if (moved && start.kind === 'search') choice = { ...start, lat: moved.lat, lon: moved.lon };
      } catch {
        /* keep the searched point */
      } finally {
        letGoBtn.removeAttribute('aria-busy');
      }
    }
    writeLastPlace(choice);
    handlers.onLetGo(choice);
  });

  // ---- my location ----
  const refuse = (e?: { code?: number }) => {
    // 1 is PERMISSION_DENIED; 2 (unavailable) and 3 (timeout) may well work next time
    const denied = !e || e.code === 1 || e.code === undefined;
    if (denied) locationRefused = true;
    setLocate(COPY.useMyLocation);
    locateBtn.removeAttribute('aria-busy');
    openSearch(denied ? COPY.locationOff : COPY.locationTimeout);
  };
  locateBtn.addEventListener('click', () => {
    if (locateBtn.getAttribute('aria-busy') === 'true') return;
    if (locationRefused) {
      openSearch();
      return;
    }
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) {
      refuse();
      return;
    }
    setLocate(COPY.findingYou);
    locateBtn.setAttribute('aria-busy', 'true');
    geo.getCurrentPosition(
      (pos) => {
        setLocate(COPY.useMyLocation);
        locateBtn.removeAttribute('aria-busy');
        // the exact position, never rounded or moved (SK's decision)
        setStart({ name: COPY.yourLocation, lat: pos.coords.latitude, lon: pos.coords.longitude, kind: 'gps' });
        letGoBtn.focus({ preventScroll: true });
      },
      refuse,
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  });

  // ---- featured cities ----
  root.querySelectorAll<HTMLButtonElement>('.city').forEach((b) => {
    b.addEventListener('click', () => {
      const c = cities.find((x) => x.id === b.dataset.city);
      if (c) setStart({ name: c.name, lat: c.lat, lon: c.lon, kind: 'featured', cityId: c.id });
    });
  });

  // ---- credits ----
  const openAbout = () => {
    if (!credits.open) credits.showModal();
  };
  $<HTMLButtonElement>('.credits-link').addEventListener('click', openAbout);
  document.addEventListener(ABOUT_EVENT, openAbout);
  $<HTMLButtonElement>('.credits-close').addEventListener('click', () => credits.close());
  credits.addEventListener('click', (e) => {
    if (e.target === credits) credits.close(); // a tap on the veil itself
  });

  // a phone turned on its side (or back) shows another number of rows
  let rowsShown = mineRows();
  const onResize = () => {
    if (mineRows() === rowsShown) return;
    rowsShown = mineRows();
    renderMine();
    fitShade();
  };
  window.addEventListener('resize', onResize);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === 'lgoab.balloons.v1') renderMine();
  };
  window.addEventListener('storage', onStorage);

  render();
  renderMine();
  fitShade();
  handlers.onStartChange?.(start);

  return {
    get start() {
      return start;
    },
    setStart,
    setBackdropLuminance,
    refresh() {
      renderMine();
      fitShade();
    },
    destroy() {
      clearInterval(sceneTimer);
      ro?.disconnect();
      window.removeEventListener('storage', onStorage);
      document.removeEventListener(ABOUT_EVENT, openAbout);
      window.removeEventListener('resize', onResize);
      search.el.remove();
      shades.forEach((s) => s.remove());
      root.replaceChildren();
    },
  };
}
