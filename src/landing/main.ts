/**
 * Entry point of the /welcome/ landing page. A plain DOM page: it must never import Phaser, so the
 * page stays light and loads without the game bundle. Sections mount into #landing in page order.
 * Ownership of each folder: src/landing/README.md.
 */
const root = document.getElementById('landing');
if (!root) throw new Error('#landing missing from welcome/index.html');
