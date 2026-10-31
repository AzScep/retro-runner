/**
 * Dev-only page that mounts the hero dash alone: `npm run dev`, then open
 * /src/landing/minigame/preview.html. Logs every DashEvent under the dash; the tall spacer below
 * lets you scroll the dash away to check the auto-pause.
 */
import '../styles/index.css';
import { mountDash } from './index.ts';

const host = document.getElementById('dash') as HTMLElement;
const log = document.getElementById('events') as HTMLElement;

mountDash(host, (e) => {
  log.textContent = `${log.textContent ?? ''}${JSON.stringify(e)}\n`;
  console.info('dash', e);
});
