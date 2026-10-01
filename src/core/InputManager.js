// ═══════════════════════════════════════════════════════════════════════════════
// InputManager.js — DOM Input Abstraction Layer (Keyboard + Mouse)
// ═══════════════════════════════════════════════════════════════════════════════
// Design Pattern: Adapter + State Snapshot
//
// Rationale:
//   DOM events fire asynchronously and can arrive mid-frame. Reading
//   event.key directly in update() is unreliable (missed inputs between
//   frames). Instead, we maintain a continuous STATE SNAPSHOT:
//     - keys: { 'w': true, 'ArrowUp': true, ... }
//     - mouse: { x, y, isDown }
//
//   The game loop reads this snapshot synchronously each frame, guaranteeing
//   consistent input state within a single update tick.
//
// Zero-Allocation:
//   Event listeners are arrow functions bound at construction time.
//   The keys object grows lazily (one property per unique key pressed)
//   but never shrinks or reallocates — properties are set to false,
//   not deleted.
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Semantic action names mapped to physical keys.
 * Using a const object allows easy rebinding in a future settings menu.
 * @readonly
 */
const DEFAULT_KEY_BINDINGS = Object.freeze({
  UP:     ['w', 'W', 'ArrowUp'],
  DOWN:   ['s', 'S', 'ArrowDown'],
  LEFT:   ['a', 'A', 'ArrowLeft'],
  RIGHT:  ['d', 'D', 'ArrowRight'],
  ATTACK: [' ', 'Enter'],          // Space or Enter
  DASH:   ['Shift'],
  INTERACT: ['e', 'E'],
  PAUSE:  ['Escape', 'p', 'P'],
});

/**
 * Manages all player input from keyboard and mouse.
 *
 * Usage:
 *   const input = new InputManager(canvas);
 *   // In update loop:
 *   if (input.isActionDown('UP')) player.vy = -1;
 *   const { x, y } = input.mouse; // screen-space cursor position
 */
export class InputManager {

  /**
   * @param {HTMLCanvasElement} canvas - The canvas element to attach
   *        mouse listeners to. Keyboard listeners attach to `window`
   *        so they work even when the canvas doesn't have focus.
   */
  constructor(canvas) {
    /** @type {HTMLCanvasElement} */
    this._canvas = canvas;

    /**
     * Current keyboard state snapshot.
     * Key = event.key string, Value = boolean (true = pressed).
     * Properties are set to false on keyup, never deleted.
     * @type {Object<string, boolean>}
     */
    this.keys = {};

    /**
     * Current mouse state snapshot.
     * x/y are canvas-local (screen) coordinates.
     * worldX/worldY are world-space coordinates (converted via Camera each frame).
     * @type {{ x: number, y: number, worldX: number, worldY: number, isDown: boolean, button: number }}
     */
    this.mouse = {
      x: 0,
      y: 0,
      worldX: 0,
      worldY: 0,
      isDown: false,
      button: 0,   // 0 = left, 2 = right
    };

    /**
     * Scroll intention for zooming.
     * 1 = zoom in (scroll up), -1 = zoom out (scroll down), 0 = idle.
     * @type {number}
     */
    this.scrollDelta = 0;

    /**
     * Reference to the Camera, set via setCameraRef().
     * Used to convert screen→world mouse coordinates each frame.
     * @type {import('./Camera.js').Camera|null}
     * @private
     */
    this._cameraRef = null;

    /**
     * Pre-allocated output object for screenToWorld conversion.
     * Reused every frame — zero allocation.
     * @type {{ x: number, y: number }}
     * @private
     */
    this._worldMouseOut = { x: 0, y: 0 };

    /**
     * Action-to-keys mapping. Can be modified at runtime for rebinding.
     * @type {Object<string, string[]>}
     */
    this.bindings = { ...DEFAULT_KEY_BINDINGS };

    // ─── Bind DOM Listeners ──────────────────────────────────────────────
    // Arrow functions capture `this` lexically — no .bind() needed,
    // and no new function objects are created per event.

    /** @private */
    this._onKeyDown = (e) => {
      // Prevent default for game keys (avoids page scroll on arrow keys).
      if (this._isGameKey(e.key)) e.preventDefault();
      this.keys[e.key] = true;
    };

    /** @private */
    this._onKeyUp = (e) => {
      this.keys[e.key] = false;
    };

    /** @private */
    this._onMouseMove = (e) => {
      // getBoundingClientRect() is called per move event.
      // At 60fps with continuous mouse movement, this is ~60 calls/sec.
      // It's cheap (cached by the browser) and necessary for correct
      // canvas-local coordinates when the canvas is not at (0,0).
      const rect = this._canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
    };

    /** @private */
    this._onMouseDown = (e) => {
      this.mouse.isDown = true;
      this.mouse.button = e.button;
    };

    /** @private */
    this._onMouseUp = (e) => {
      this.mouse.isDown = false;
    };

    // Prevent right-click context menu on the canvas.
    /** @private */
    this._onContextMenu = (e) => {
      e.preventDefault();
    };

    /** @private */
    this._onWheel = (e) => {
      e.preventDefault();
      // Se deltaY < 0, a roda rolou para cima (intenção de aproximar/zoom in).
      // Se deltaY > 0, rolou para baixo (intenção de afastar/zoom out).
      this.scrollDelta = e.deltaY < 0 ? 1 : -1;
    };

    // Attach all listeners.
    this._attach();
  }

  // ─── Semantic Action Queries ────────────────────────────────────────────────

  /**
   * Checks if ANY key bound to the given action is currently pressed.
   *
   * Example:
   *   input.isActionDown('UP')   → true if 'w' OR 'W' OR 'ArrowUp' is held.
   *   input.isActionDown('ATTACK') → true if Space or Enter is held.
   *
   * Complexity: O(K) where K = number of keys bound to the action (typically 2–3).
   *
   * @param {string} action - Semantic action name (e.g., 'UP', 'ATTACK').
   * @returns {boolean} True if any bound key is currently pressed.
   */
  isActionDown(action) {
    const boundKeys = this.bindings[action];
    if (!boundKeys) return false;

    for (let i = 0; i < boundKeys.length; i++) {
      if (this.keys[boundKeys[i]] === true) return true;
    }
    return false;
  }

  /**
   * Checks if a specific raw key is currently pressed.
   *
   * @param {string} key - The event.key string (e.g., 'w', 'ArrowLeft', ' ').
   * @returns {boolean}
   */
  isKeyDown(key) {
    return this.keys[key] === true;
  }

  // ─── Camera Integration ─────────────────────────────────────────────────────

  /**
   * Injects the camera reference for screen→world mouse conversion.
   * Called once during initialization in main.js.
   *
   * @param {import('./Camera.js').Camera} camera
   */
  setCameraRef(camera) {
    this._cameraRef = camera;
  }

  /**
   * Updates worldX/worldY from the current screen mouse position.
   * Called once per frame in the update loop (before player reads input).
   *
   * Uses Camera.screenToWorld() which applies the inverse camera transform:
   *   worldX = (screenX - halfW) / zoom + halfW + camX
   *   worldY = (screenY - halfH) / zoom + halfH + camY
   *
   * Zero-allocation: writes to pre-allocated _worldMouseOut object.
   */
  updateWorldMouse() {
    if (!this._cameraRef) return;

    this._cameraRef.screenToWorld(
      this.mouse.x,
      this.mouse.y,
      this._worldMouseOut
    );

    this.mouse.worldX = this._worldMouseOut.x;
    this.mouse.worldY = this._worldMouseOut.y;
  }

  // ─── Internal Helpers ───────────────────────────────────────────────────────

  /**
   * Checks if a key is one of the game-bound keys (to prevent default behavior).
   *
   * @param {string} key
   * @returns {boolean}
   * @private
   */
  _isGameKey(key) {
    // Check all binding arrays for this key.
    for (const action in this.bindings) {
      if (this.bindings[action].includes(key)) return true;
    }
    return false;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Attaches all DOM event listeners.
   * Called once in the constructor.
   * @private
   */
  _attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this._canvas.addEventListener('mousemove', this._onMouseMove);
    this._canvas.addEventListener('mousedown', this._onMouseDown);
    this._canvas.addEventListener('mouseup', this._onMouseUp);
    this._canvas.addEventListener('contextmenu', this._onContextMenu);
    this._canvas.addEventListener('wheel', this._onWheel, { passive: false });
  }

  /**
   * Detaches all DOM event listeners.
   * Call this on scene teardown or game exit to prevent memory leaks.
   */
  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this._canvas.removeEventListener('mousemove', this._onMouseMove);
    this._canvas.removeEventListener('mousedown', this._onMouseDown);
    this._canvas.removeEventListener('mouseup', this._onMouseUp);
    this._canvas.removeEventListener('contextmenu', this._onContextMenu);
    this._canvas.removeEventListener('wheel', this._onWheel);
  }
}
