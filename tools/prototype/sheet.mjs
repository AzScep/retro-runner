// Full-page screenshot of the lanes gallery (all layouts) for one query, e.g. "scene=bunched&oblique=8".
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1320, height: 800 } });
for (const q of process.argv.slice(2)) {
  await page.goto(`http://localhost:5191/tools/prototype/lanes.html?${q}`);
  await page.waitForSelector('body[data-ready="1"]');
  const file = join(out, `sheet_${q.replace(/[=&]/g, (c) => (c === '=' ? '-' : '_'))}.png`);
  await page.locator('#app').screenshot({ path: file, timeout: 120000 });
  console.log(file);
}
await browser.close();
