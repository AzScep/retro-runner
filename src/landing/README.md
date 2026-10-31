# Landing page (`/welcome/`)

A gamified, retro landing page that sends visitors to the game at `/`.
It is a plain DOM page built by Vite from `welcome/index.html`, and it never imports Phaser.

| Folder              | Owner                      | Contents                                                |
| ------------------- | -------------------------- | ------------------------------------------------------- |
| `content/`          | J1 Story and copy          | All visible text and meta text, as typed data.          |
| `styles/`           | J2 Visual system           | Design tokens, base styles, retro effects, wireframes.  |
| `art/`              | J3 Sprite pipeline         | Game sprites, stadiums and badges rendered for the DOM. |
| `minigame/`         | J4 Playable hero           | The 100 m mini-race vs Pip.                             |
| `sections/`, `hud/` | J5 Sections and game layer | Page sections, score HUD and badges.                    |
| `audio/`            | J6 Sound                   | Opt-in chiptune toggle.                                 |
| `main.ts`           | Integration                | Mounts the sections.                                    |

Page plan, in order: hero with the playable dash, story (the meet ladder), mechanics (three events), rival select (Zyx teased as `???`, never spoiled), modes and records, final CTA.
