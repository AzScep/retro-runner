// Captures 4x screenshots of the lane prototype into tools/prototype/out/.
// Needs `npx vite --port 5191` running at the repo root. Usage:
//   node tools/prototype/shoot.mjs "layout=P&scene=spread" "layout=B&scene=bunched&hud=heads" ...
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
for (const q of process.argv.slice(2)) {
  await page.goto(`http://localhost:5191/tools/prototype/lanes.html?${q}`);
  await page.waitForSelector('body[data-ready="1"]');
  const name = q.replace(/[=&]/g, (c) => (c === '=' ? '-' : '_'));
  const file = join(out, `lanes_${name}.png`);
  await page.locator('#frame').screenshot({ path: file });
  console.log(file);
}
await browser.close();
