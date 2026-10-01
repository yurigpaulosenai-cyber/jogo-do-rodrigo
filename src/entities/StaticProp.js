// ═══════════════════════════════════════════════════════════════════════════════
// StaticProp.js — Static Environmental Entity (Walls, Rocks, Crates)
// ═══════════════════════════════════════════════════════════════════════════════
// A minimal solid object for collision testing. Does NOT move, does NOT
// update, and has NO AI. Exists purely as a collision obstacle and visual
// element in the world.
//
// Conforms to the GameEntity interface expected by EntityManager:
//   { id, active, layer, aabb, update(dt), draw(ctx) }
//
// ═══════════════════════════════════════════════════════════════════════════════

import { RenderLayer } from '../core/EntityManager.js';

/**
 * Static environmental prop (wall, rock, crate, barrier).
 *
 * Does not participate in physics integration (no velocity).
 * The SpatialGrid indexes it so dynamic entities can collide with it.
 */
export class StaticProp {

  /**
   * @param {string|number} id   - Unique entity identifier.
   * @param {number} x           - X position (world space, left edge).
   * @param {number} y           - Y position (world space, top edge).
   * @param {number} width       - Width in pixels.
   * @param {number} height      - Height in pixels.
   * @param {string} [color='#3a3a5c'] - Fill color for placeholder rendering.
   */
  constructor(id, x, y, width, height, color = '#3a3a5c') {
    /** @type {string|number} */
    this.id = id;

    /** @type {boolean} */
    this.active = true;

    /** @type {number} Render layer — ENTITIES layer for correct z-order. */
    this.layer = RenderLayer.ENTITIES;

    // ─── Position & Dimensions ────────────────────────────────────────────
    /** @type {number} */
    this.x = x;

    /** @type {number} */
    this.y = y;

    /** @type {number} */
    this.width = width;

    /** @type {number} */
    this.height = height;

    // ─── AABB (for SpatialGrid & CollisionResolver) ───────────────────────
    /**
     * Axis-Aligned Bounding Box. For static props, this never changes
     * after construction, so no sync is needed in update().
     * @type {{ x: number, y: number, width: number, height: number }}
     */
    this.aabb = { x, y, width, height };

    // ─── Visual ───────────────────────────────────────────────────────────
    /** @type {string} */
    this.color = color;

    /** @type {string} Border color for depth/contrast. */
    this.borderColor = '#252540';

    /** @type {string} Highlight color for a top-edge bevel effect. */
    this.highlightColor = '#4e4e72';
  }

  // ─── GameEntity Interface ───────────────────────────────────────────────────

  /**
   * No-op for static props — they don't move or think.
   * Satisfies the GameEntity interface so EntityManager can call it uniformly.
   *
   * @param {number} _dt - Unused delta time.
   */
  update(_dt) {
    // Static — intentionally empty.
  }

  /**
   * Draws the prop as a solid rectangle with border and top-edge highlight.
   *
   * Visual breakdown:
   *   1. Dark border (1px inset effect).
   *   2. Main fill (the prop body color).
   *   3. Top-edge highlight (2px lighter strip for subtle 3D bevel).
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas context (already camera-transformed).
   */
  draw(ctx) {
    // Border / shadow (slightly larger).
    ctx.fillStyle = this.borderColor;
    ctx.fillRect(this.x - 1, this.y - 1, this.width + 2, this.height + 2);

    // Main body.
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.width, this.height);

    // Top-edge bevel highlight (2px tall strip).
    ctx.fillStyle = this.highlightColor;
    ctx.fillRect(this.x, this.y, this.width, 2);
  }
}
