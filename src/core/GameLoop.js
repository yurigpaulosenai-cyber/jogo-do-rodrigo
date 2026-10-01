// ═══════════════════════════════════════════════════════════════════════════════
// GameLoop.js — Fixed-Timestep Game Loop Harness (requestAnimationFrame)
// ═══════════════════════════════════════════════════════════════════════════════
// Design Pattern: Hollywood Principle ("Don't call us, we'll call you")
//
// This module ONLY manages timing. It does NOT know about entities, cameras,
// or any game-specific logic. It receives generic callbacks and invokes them
// at the correct cadence with a properly computed deltaTime.
//
// Critical Safety:
//   When the browser tab is backgrounded, rAF pauses. On return, the raw dt
//   can be several seconds. Without clamping, physics would tunnel through
//   walls, enemies would teleport, and timers would skip. We clamp dt to
//   MAX_DT (100ms = 10fps equivalent) to guarantee physics stability.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { clamp } from '../utils/MathUtils.js';

/**
 * Maximum allowed delta time in seconds.
 * If actual dt exceeds this (e.g., after tab switch), it is clamped.
 *
 * 0.1s = 100ms → equivalent to simulating at 10fps minimum.
 * This is the industry-standard safety cap for browser games.
 * @const {number}
 */
const MAX_DT = 0.1;

/**
 * Core game loop driven by requestAnimationFrame.
 *
 * Responsibilities:
 *   1. Compute delta time (dt) in seconds per frame.
 *   2. Clamp dt to prevent physics explosions after tab-switch.
 *   3. Call the user-provided `onUpdate(dt)` callback (physics/logic).
 *   4. Call the user-provided `onDraw(dt)` callback (rendering).
 *   5. Track performance metrics (FPS, frame time).
 *
 * Usage:
 *   const loop = new GameLoop({
 *     onUpdate: (dt) => { entityManager.update(dt); },
 *     onDraw:   (dt) => { camera.apply(ctx); entityManager.draw(ctx, cam); camera.restore(ctx); },
 *   });
 *   loop.start();
 */
export class GameLoop {

  /**
   * @param {Object} callbacks
   * @param {function(number): void} callbacks.onUpdate - Called each frame with
   *        clamped dt (seconds). Use for physics, AI, input processing.
   * @param {function(number): void} callbacks.onDraw - Called each frame after
   *        update. Use for all Canvas rendering. Receives the same dt for
   *        animation interpolation if needed.
   */
  constructor({ onUpdate, onDraw }) {
    /**
     * Physics/logic update callback.
     * @type {function(number): void}
     * @private
     */
    this._onUpdate = onUpdate;

    /**
     * Rendering callback.
     * @type {function(number): void}
     * @private
     */
    this._onDraw = onDraw;

    /**
     * Timestamp of the previous frame (from performance.now(), in ms).
     * Initialized on first frame to avoid a massive initial dt.
     * @type {number}
     * @private
     */
    this._lastTimestamp = 0;

    /**
     * Handle returned by requestAnimationFrame, needed for cancellation.
     * @type {number}
     * @private
     */
    this._rafHandle = 0;

    /**
     * Whether the loop is currently running.
     * @type {boolean}
     */
    this.isRunning = false;

    // ─── Performance Metrics ──────────────────────────────────────────────

    /**
     * Smoothed frames-per-second, updated each frame via exponential
     * moving average (EMA) to avoid jitter in the debug overlay.
     *
     * EMA formula: fps = fps × (1 - α) + instantFps × α
     * α = 0.1 → slow smoothing, stable readout.
     * @type {number}
     */
    this.fps = 0;

    /**
     * Raw frame time of the last frame in milliseconds.
     * Useful for profiling spikes.
     * @type {number}
     */
    this.frameTimeMs = 0;

    /**
     * Total number of frames rendered since start().
     * @type {number}
     */
    this.frameCount = 0;

    /**
     * Bound reference to the tick function.
     * Pre-binding in the constructor avoids creating a new closure on
     * every requestAnimationFrame call (zero allocation in the hot path).
     * @type {function(number): void}
     * @private
     */
    this._boundTick = this._tick.bind(this);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Starts the game loop.
   *
   * Initializes _lastTimestamp via performance.now() so the first frame's
   * dt is near-zero (not a massive spike from page load time).
   *
   * Guard: If already running, this is a no-op to prevent double-loops.
   */
  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this._lastTimestamp = performance.now();
    this._rafHandle = requestAnimationFrame(this._boundTick);
  }

  /**
   * Stops the game loop.
   *
   * Cancels the pending requestAnimationFrame. The loop can be resumed
   * later by calling start() again (dt will be re-initialized cleanly).
   */
  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    cancelAnimationFrame(this._rafHandle);
    this._rafHandle = 0;
  }

  // ─── Internal Tick ──────────────────────────────────────────────────────────

  /**
   * Core frame callback invoked by requestAnimationFrame.
   *
   * Timeline per frame:
   *   ┌──────────────────────────────────────────────────┐
   *   │ 1. Compute raw dt (ms → seconds)                │
   *   │ 2. Clamp dt to MAX_DT (safety cap)              │
   *   │ 3. onUpdate(dt) — physics, AI, input            │
   *   │ 4. onDraw(dt) — canvas rendering                │
   *   │ 5. Update FPS metrics                           │
   *   │ 6. Schedule next frame via rAF                  │
   *   └──────────────────────────────────────────────────┘
   *
   * @param {DOMHighResTimeStamp} timestamp - High-resolution timestamp
   *        provided by requestAnimationFrame (milliseconds since origin).
   * @private
   */
  _tick(timestamp) {
    // If stopped between scheduling and execution, bail out.
    if (!this.isRunning) return;

    // ── 1. Compute raw delta time in seconds ─────────────────────────────
    // performance.now() / rAF timestamp gives ms; divide by 1000 for seconds.
    const rawDtMs = timestamp - this._lastTimestamp;
    this._lastTimestamp = timestamp;

    // ── 2. Clamp dt ──────────────────────────────────────────────────────
    // After tab-switch, rawDtMs can be 5000+ ms.
    // clamp to MAX_DT (0.1s) prevents physics tunneling, timer skips, etc.
    const dt = clamp(rawDtMs / 1000, 0, MAX_DT);

    // ── 3. Update (physics / logic) ──────────────────────────────────────
    this._onUpdate(dt);

    // ── 4. Draw (rendering) ──────────────────────────────────────────────
    this._onDraw(dt);

    // ── 5. Performance metrics ───────────────────────────────────────────
    this.frameTimeMs = rawDtMs;
    this.frameCount++;

    // Exponential moving average for smooth FPS readout.
    // instantFps = 1000 / rawDtMs (avoid division by zero on first frame).
    if (rawDtMs > 0) {
      const instantFps = 1000 / rawDtMs;
      // α = 0.1 → 90% old value + 10% new value = smooth, low-jitter.
      this.fps = this.fps * 0.9 + instantFps * 0.1;
    }

    // ── 6. Schedule next frame ───────────────────────────────────────────
    this._rafHandle = requestAnimationFrame(this._boundTick);
  }

  // ─── Diagnostics ────────────────────────────────────────────────────────────

  /**
   * Returns a snapshot of loop performance metrics.
   * Useful for real-time debug overlays.
   *
   * @returns {{
   *   fps: number,
   *   frameTimeMs: number,
   *   frameCount: number,
   *   isRunning: boolean
   * }}
   */
  getStats() {
    return {
      fps: this.fps | 0,             // Truncate to integer for display.
      frameTimeMs: this.frameTimeMs,
      frameCount: this.frameCount,
      isRunning: this.isRunning,
    };
  }
}
