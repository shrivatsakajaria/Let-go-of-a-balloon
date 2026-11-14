/**
 * The landing card on screen: the postcard as an image over the dimmed scene, with Share card (where
 * the phone can share files), Save image and Copy link, and a way back. In LinkedIn's and X's in-app
 * browsers, where sharing files and downloads are unreliable, the card fills the screen as a plain
 * image with "Press and hold to save" and "Open in your browser" (spec 6.5).
 *
 * It is a modal dialog: the page behind is inert, focus starts on the main action and returns where
 * it was, and Escape closes it. One entrance (a short fade and rise); none with reduced motion.
 */
import { COPY } from './copy';
import { canShareFiles, downloadBlob, openInBrowserHref, shareCard, type CardWords, type ShareEnv } from './card';
import { REDUCED_FADE_S, revealAt, type RevealState } from './revealmath';

/**
 * The reveal (spec 6.5, design A) drawn into the card's frame: each frame `draw` paints the card at that
 * point of the reveal onto a 1080 x 1350 context, its 3D view drawn w x h (the frame's own pixels).
 */
export type CardReveal = { draw(ctx: CanvasRenderingContext2D, st: RevealState, w: number, h: number): void; dispose(): void };


export type CardViewOpts = {
  blob: Blob;
  words: CardWords;
  /** The full link to this balloon. */
  link: string;
  inApp: boolean;
  ua: string;
  /** "Close" by default; the replay passes "Back to live". */
  closeLabel?: string;
  onClose?(): void;
  nav?: ShareEnv['nav'];
  /** False once the visitor has moved on while the card was being got ready: nothing opens. */
  isCurrent?(): boolean;
  /**
   * Where focus goes on closing when what had it before is gone (the page, a hidden button: a card that
   * opened by itself), so a keyboard user is not sent back to the top of the page.
   */
  fallbackFocus?(): HTMLElement | null;
  /** Play the reveal in the card's frame before the still and its buttons show (none in an in-app browser). */
  reveal?: CardReveal;
  /** The card is in: after the reveal ('played'), the reduced-motion cross-fade ('faded'), or straight away ('none'). */
  onRevealed?(how: 'played' | 'faded' | 'none'): void;
};

export type CardView = { readonly el: HTMLElement; close(): void };

const INERT = ['app', 'hud', 'notice', 'scene'];
let current: CardView | null = null;

export function closeCardView(): void {
  current?.close();
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.append(t);
    t.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    t.remove();
    return ok;
  }
}

function button(label: string, cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  return b;
}

export async function showCardView(o: CardViewOpts): Promise<CardView | null> {
  current?.close();
  const nav = o.nav ?? (navigator as ShareEnv['nav']);
  const src = o.inApp ? await blobToDataUrl(o.blob) : URL.createObjectURL(o.blob);
  if (o.isCurrent && !o.isCurrent()) {
    if (!o.inApp) URL.revokeObjectURL(src);
    return null;
  }
  const before = document.activeElement as HTMLElement | null;

  const el = document.createElement('div');
  el.className = `card-layer${o.inApp ? ' in-app' : ''}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'card-title');

  const say = (text: string) => {
    const st = el.querySelector('[role="status"]');
    if (!st) return;
    st.textContent = '';
    requestAnimationFrame(() => (st.textContent = text));
  };
  const head = document.createElement('div');
  head.className = 'card-head';
  const title = document.createElement('h2');
  title.id = 'card-title';
  title.className = 'sr';
  title.textContent = o.words.sentence;
  const close = button(o.closeLabel ?? COPY.close, 'link card-close');
  head.append(title, close);

  const img = document.createElement('img');
  img.className = 'card-img';
  img.src = src;
  img.alt = o.words.alt;
  img.width = 1080;
  img.height = 1350;
  img.decoding = 'async';
  const frame = document.createElement('div');
  frame.className = 'card-frame';
  frame.append(img);

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  let first: HTMLElement;
  if (o.inApp) {
    const hint = document.createElement('p');
    hint.className = 'card-hint';
    hint.textContent = COPY.pressAndHold;
    const open = document.createElement('a');
    open.className = 'main-action card-open';
    open.href = openInBrowserHref(o.link, o.ua);
    open.textContent = COPY.openInBrowser;
    actions.append(hint, open);
    first = open;
  } else {
    const env: ShareEnv = { nav, download: downloadBlob };
    const sharable = canShareFiles(nav);
    const share = button(COPY.shareCard, 'main-action card-share');
    share.hidden = !sharable;
    share.addEventListener('click', () => void shareCard(o.blob, o.words, o.link, env));
    const save = button(COPY.saveImage, sharable ? 'link card-save' : 'main-action card-save');
    save.addEventListener('click', () => downloadBlob(o.blob, o.words.filename));
    const copy = button(COPY.copyLink, 'link card-copy');
    let reset = 0;
    copy.addEventListener('click', async () => {
      if (!(await copyText(o.link))) {
        // say so, and put the link where it can be selected and copied by hand
        if (!el.querySelector('.card-link')) {
          const note = document.createElement('p');
          note.className = 'card-note';
          note.setAttribute('role', 'alert');
          note.textContent = COPY.copyFailed;
          const field = document.createElement('input');
          field.className = 'card-link';
          field.readOnly = true;
          field.value = o.link;
          field.setAttribute('aria-label', COPY.linkLabel);
          field.addEventListener('focus', () => field.select());
          el.append(note, field);
        }
        (el.querySelector('.card-link') as HTMLInputElement).select();
        return;
      }
      say(COPY.linkCopied);
      copy.textContent = COPY.linkCopied;
      clearTimeout(reset);
      reset = window.setTimeout(() => (copy.textContent = COPY.copyLink), 2500);
    });
    actions.append(share, save, copy);
    first = sharable ? share : save;
  }

  // a polite status region for "Link copied"
  const status = document.createElement('p');
  status.className = 'sr';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  el.append(head, frame, actions, status);
  document.body.append(el);
  const inert = INERT.map((id) => document.getElementById(id)).filter((n): n is HTMLElement => !!n && !n.inert);
  for (const n of inert) n.inert = true;
  document.documentElement.classList.add('card-open');

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      view.close();
    }
  };
  document.addEventListener('keydown', onKey);
  let closed = false;
  let stopReveal = () => {};
  const view: CardView = {
    el,
    close() {
      if (closed) return;
      closed = true;
      stopReveal();
      document.removeEventListener('keydown', onKey);
      for (const n of inert) n.inert = false;
      document.documentElement.classList.remove('card-open');
      el.remove();
      if (!o.inApp) URL.revokeObjectURL(src);
      if (current === view) current = null;
      // back where focus was, if that is still there to take it; otherwise where the caller says
      const usable = (e: HTMLElement | null): e is HTMLElement =>
        !!e && e !== document.body && e.isConnected && (typeof e.checkVisibility !== 'function' || e.checkVisibility({ visibilityProperty: true }));
      const back = usable(before) ? before : o.fallbackFocus?.() ?? null;
      back?.focus?.({ preventScroll: true });
      o.onClose?.();
    },
  };
  close.addEventListener('click', () => view.close());
  current = view;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (o.reveal && !o.inApp && !reduced) {
    stopReveal = playReveal(o.reveal, frame, img, actions, () => {
      // focus moves to the main action as the buttons come, unless the visitor has moved it meanwhile
      if (document.activeElement === close || document.activeElement === document.body) first.focus({ preventScroll: true });
    }, () => o.onRevealed?.('played'));
    close.focus({ preventScroll: true });
  } else if (o.reveal && !o.inApp) {
    // reduced motion: no camera move and no count-up, a short cross-fade to the finished card (the
    // Web Animations API: the page's reduced-motion rule turns CSS animations off)
    o.reveal.dispose();
    for (const n of [frame, actions]) n.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_FADE_S * 1000, easing: 'cubic-bezier(0.22,1,0.36,1)' });
    first.focus({ preventScroll: true });
    o.onRevealed?.('faded');
  } else {
    o.reveal?.dispose();
    first.focus({ preventScroll: true });
    o.onRevealed?.('none');
  }
  return view;
}

/**
 * The reveal in the card's frame: a canvas over the (hidden) still, painted every frame until the
 * end, then the still itself; the buttons come at their moment. Returns a stop (closing mid-way).
 */
function playReveal(r: CardReveal, frame: HTMLElement, img: HTMLImageElement, actions: HTMLElement, onButtons: () => void, onDone: () => void): () => void {
  const c = document.createElement('canvas');
  c.className = 'card-reveal';
  c.width = 1080;
  c.height = 1350;
  c.setAttribute('aria-hidden', 'true');
  frame.append(c);
  frame.classList.add('revealing');
  img.style.visibility = 'hidden';
  actions.style.visibility = 'hidden';
  const ctx = c.getContext('2d');
  let raf = 0;
  let stopped = false;
  let buttons = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    r.dispose();
    c.remove();
    frame.classList.remove('revealing');
    img.style.visibility = '';
    actions.style.visibility = '';
  };
  if (!ctx) {
    stop();
    onButtons();
    onDone();
    return stop;
  }
  // a test page can step the reveal by hand (window.__revealAt = seconds)
  const testClock = () => (window as unknown as { __revealAt?: number }).__revealAt;
  let t0 = -1;
  const tick = (now: number) => {
    if (stopped) return;
    if (t0 < 0) t0 = now;
    const t = testClock() ?? (now - t0) / 1000;
    const st = revealAt(t);
    // the 3D view at the frame's own size (at most 1.5 device pixels a CSS pixel), 1080:1000
    const box = c.getBoundingClientRect();
    const w = Math.max(64, Math.min(1080, Math.round(box.width * Math.min(1.5, window.devicePixelRatio || 1))));
    const h = Math.round((w * 1000) / 1080);
    try {
      r.draw(ctx, st, w, h);
    } catch (e) {
      console.warn('the reveal could not be drawn', e);
      stop();
      onButtons();
      onDone();
      return;
    }
    if (st.buttons && !buttons) {
      buttons = true;
      actions.style.visibility = '';
      actions.animate?.([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.22,1,0.36,1)' });
      onButtons();
    }
    if (st.done) {
      stop();
      onDone();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return stop;
}
