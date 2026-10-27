/**
 * Custom Phaser build: the `phaser` import resolves here (vite.config.ts), so the bundle carries
 * only the parts of Phaser the game uses instead of the whole prebuilt dist file (no physics,
 * tilemaps, sound, loader file types, input plugins or unused game objects).
 *
 * The namespace keeps the shape of the full `Phaser` export for every member the game touches,
 * so TypeScript keeps using the package's own typings. Adding a game object type means adding
 * its class and factory here; a missing factory fails loudly (`scene.add.x is not a function`).
 *
 * Modules load from phaser/src (CommonJS) through the `phaser-src` alias; vite.config.ts also
 * fixes Phaser's build-time feature flags (WebGL only, no sound, no debug).
 *
 * Some Phaser modules use static helpers that only their namespace index attaches (for example
 * Vignette calls Color.IntegerToColor, set in display/color/index.js), so every index that patches
 * statics onto a class is imported here for its side effect.
 */
import CONST from 'phaser-src/const.js';
import Extend from 'phaser-src/utils/object/Extend.js';
import Animations from 'phaser-src/animations/index.js';
import BlendModes from 'phaser-src/renderer/BlendModes.js';
import Cache from 'phaser-src/cache/index.js';
import Scene2D from 'phaser-src/cameras/2d/index.js';
import Core from 'phaser-src/core/index.js';
import Events from 'phaser-src/events/index.js';
import Filters from 'phaser-src/filters/index.js';
import Game from 'phaser-src/core/Game.js';
import GameObject from 'phaser-src/gameobjects/GameObject.js';
import GameObjectEvents from 'phaser-src/gameobjects/events/index.js';
import DisplayList from 'phaser-src/gameobjects/DisplayList.js';
import UpdateList from 'phaser-src/gameobjects/UpdateList.js';
import GameObjectFactory from 'phaser-src/gameobjects/GameObjectFactory.js';
import GameObjectCreator from 'phaser-src/gameobjects/GameObjectCreator.js';
import Components from 'phaser-src/gameobjects/components/index.js';
import BitmapText from 'phaser-src/gameobjects/bitmaptext/static/BitmapText.js';
import Container from 'phaser-src/gameobjects/container/Container.js';
import Graphics from 'phaser-src/gameobjects/graphics/Graphics.js';
import Image from 'phaser-src/gameobjects/image/Image.js';
import Sprite from 'phaser-src/gameobjects/sprite/Sprite.js';
import TileSprite from 'phaser-src/gameobjects/tilesprite/TileSprite.js';
import 'phaser-src/gameobjects/bitmaptext/static/BitmapTextFactory.js';
import 'phaser-src/gameobjects/container/ContainerFactory.js';
import 'phaser-src/gameobjects/graphics/GraphicsFactory.js';
import 'phaser-src/gameobjects/image/ImageFactory.js';
import 'phaser-src/gameobjects/sprite/SpriteFactory.js';
import 'phaser-src/gameobjects/tilesprite/TileSpriteFactory.js';
import Renderer from 'phaser-src/renderer/index.js';
import Scale from 'phaser-src/scale/index.js';
import ScaleModes from 'phaser-src/renderer/ScaleModes.js';
import Scene from 'phaser-src/scene/Scene.js';
import Scenes from 'phaser-src/scene/index.js';
import Textures from 'phaser-src/textures/index.js';
import Time from 'phaser-src/time/index.js';
import TintModes from 'phaser-src/renderer/TintModes.js';
import 'phaser-src/display/color/index.js';
import 'phaser-src/geom/circle/index.js';
import 'phaser-src/geom/ellipse/index.js';
import 'phaser-src/geom/line/index.js';
import 'phaser-src/geom/polygon/index.js';
import 'phaser-src/geom/rectangle/index.js';
import 'phaser-src/geom/triangle/index.js';
import 'phaser-src/math/easing/linear/index.js';
import 'phaser-src/math/easing/stepped/index.js';

const Phaser = Extend(
  false,
  {
    Animations,
    BlendModes,
    Cache,
    Cameras: { Scene2D },
    Core,
    Events,
    Filters,
    Game,
    GameObjects: {
      Events: GameObjectEvents,
      DisplayList,
      UpdateList,
      GameObjectFactory,
      GameObjectCreator,
      Components,
      GameObject,
      BitmapText,
      Container,
      Graphics,
      Image,
      Sprite,
      TileSprite,
    },
    Renderer,
    Scale,
    ScaleModes,
    Scene,
    Scenes,
    Textures,
    Time,
    TintModes,
  },
  CONST,
);

export default Phaser;
