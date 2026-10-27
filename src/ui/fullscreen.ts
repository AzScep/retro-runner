/**
 * True fullscreen (Fullscreen API): the F key and a corner button toggle it on any screen.
 * The button fades out while the mouse is idle so it never sits over the game during a race,
 * and it never takes keyboard focus, so Space/Enter keep driving the game.
 */

/** Pre-16.4 Safari only has the prefixed API. */
interface WebkitDocument {
  readonly webkitFullscreenEnabled?: boolean;
  readonly webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface WebkitElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

const IDLE_HIDE_MS = 2500;

export function fullscreenSupported(): boolean {
  const d = document as Document & WebkitDocument;
  return document.fullscreenEnabled || d.webkitFullscreenEnabled === true;
}

export function isFullscreen(): boolean {
  const d = document as Document & WebkitDocument;
  return (document.fullscreenElement ?? d.webkitFullscreenElement ?? null) !== null;
}

/** Toggle fullscreen on the whole page. Must run inside a user gesture (key press or click). */
export function toggleFullscreen(): void {
  const d = document as Document & WebkitDocument;
  const root = document.documentElement as HTMLElement & WebkitElement;
  // Rejections (gesture missing, permission policy) leave the game windowed, which is harmless.
  const ignore = (p: Promise<void> | void): void => void Promise.resolve(p).catch(() => {});
  if (isFullscreen()) {
    if (document.exitFullscreen) ignore(document.exitFullscreen());
    else if (d.webkitExitFullscreen) ignore(d.webkitExitFullscreen());
  } else if (root.requestFullscreen) {
    ignore(root.requestFullscreen({ navigationUI: 'hide' }));
  } else if (root.webkitRequestFullscreen) {
    ignore(root.webkitRequestFullscreen());
  }
}

// 8x8 pixel-art icons (palette index 8 on index 1), drawn crisp at any size.
const PIXEL_PATHS = {
  // Four corners pointing out.
  enter: 'M0 0h3v1H1v2H0zM5 0h3v3H7V1H5zM0 5h1v2h2v1H0zM7 5h1v3H5V7h2z',
  // Four corners pointing in.
  exit: 'M2 0h1v3H0V2h2zM5 0h1v2h2v1H5zM0 5h3v3H2V6H0zM5 5h3v1H6v2H5z',
} as const;

function icon(kind: keyof typeof PIXEL_PATHS): string {
  return (
    `<svg viewBox="0 0 8 8" width="16" height="16" shape-rendering="crispEdges" aria-hidden="true">` +
    `<path fill="#f4f2ff" d="${PIXEL_PATHS[kind]}"/></svg>`
  );
}

/**
 * Adds the corner button and the global F key. `refocus` returns keyboard focus to the game.
 * Does nothing where the Fullscreen API is unavailable (for example iPhone Safari).
 */
export function installFullscreen(refocus: () => void): void {
  if (!fullscreenSupported()) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'fullscreen-toggle';
  button.tabIndex = -1;
  button.setAttribute('aria-label', 'Toggle fullscreen');
  document.body.append(button);

  const render = (): void => {
    const on = isFullscreen();
    button.innerHTML = icon(on ? 'exit' : 'enter');
    button.title = on ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
  };
  render();
  document.addEventListener('fullscreenchange', render);
  document.addEventListener('webkitfullscreenchange', render);

  // Visible while the mouse moves, hidden after a short idle.
  let hideTimer = 0;
  const reveal = (): void => {
    button.classList.add('visible');
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => button.classList.remove('visible'), IDLE_HIDE_MS);
  };
  window.addEventListener('mousemove', reveal);
  reveal();

  // Keep focus on the game: mousedown would otherwise focus the button.
  button.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('click', () => {
    toggleFullscreen();
    refocus();
  });

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.code === 'KeyF' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) toggleFullscreen();
    },
    { capture: true },
  );
}
