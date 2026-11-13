/**
 * Plain-text notices in the bottom of the screen (spec 7.2, 7.4): the winds error with Try again,
 * and the broken-link message. No box, toast or spinner: a sentence and the way on, over the same
 * soft shading as the rest of the chrome. The simulation notice itself lives in the small print of
 * the start screen and the HUD (COPY.notice).
 */
export type NoticeAction = { label: string; onClick(): void; primary?: boolean };

export type Notice = { readonly el: HTMLElement; remove(): void };

export function showNotice(host: HTMLElement, message: string, actions: NoticeAction[]): Notice {
  host.querySelectorAll(':scope > .notice-block').forEach((n) => n.remove());
  const el = document.createElement('div');
  el.className = 'notice-block';
  el.setAttribute('role', 'alert');
  const p = document.createElement('p');
  p.className = 'notice-text';
  p.textContent = message;
  const row = document.createElement('div');
  row.className = 'notice-actions';
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = a.primary ? 'main-action' : 'link';
    b.textContent = a.label;
    b.addEventListener('click', () => a.onClick());
    row.append(b);
  }
  el.append(p, row);
  host.append(el);
  (row.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  return { el, remove: () => el.remove() };
}
