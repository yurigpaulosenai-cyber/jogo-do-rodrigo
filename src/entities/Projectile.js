// ═══════════════════════════════════════════════════════════════════════════════
// Projectile.js — Pool-Managed Ballistic Projectile Entity
// ═══════════════════════════════════════════════════════════════════════════════
// Design Pattern: Flyweight (pooled) + GameEntity Interface
//
// Lifecycle:
//   1. Pre-allocated by ObjectPool (constructor sets dormant defaults).
//   2. Acquired via pool.acquire() → reset(initProps) sets active state.
//   3. update(dt): Euler integration, AABB sync, lifetime/range check.
//   4. draw(ctx): Bright circle with motion trail.
//   5. On collision or expiry → pool.release() → active = false.
//
// Zero-Allocation Guarantee:
//   - Constructor runs ONCE (during pool warm-up).
//   - reset() writes to existing primitive fields and pre-allocated AABB.
//   - update() and draw() create NO objects.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { RenderLayer } from '../core/EntityManager.js';

/** Auto-incrementing ID counter for unique projectile identification. */
let _nextProjectileId = 0;

/**
 * A physical projectile that flies through the world with a velocity vector.
 *
 * Physics:
 *   position.x += vx × dt
 *   position.y += vy × dt
 *   (optional) vy += gravity × dt
 *
 * The projectile tracks its travel distance and self-destructs when
 * it exceeds maxRange (preventing off-screen memory leaks).
 */
export class Projectile {

  /**
   * Default constructor — called ONLY during pool warm-up.
   * Sets all fields to safe dormant values. Real initialization
   * happens in reset() when the projectile is acquired.
   */
  constructor() {
    // ─── GameEntity Interface ─────────────────────────────────────────────
    /** @type {string} Unique ID — reassigned on each reset(). */
    this.id = `proj_${_nextProjectileId++}`;

    /** @type {boolean} Inactive until acquired from pool. */
    this.active = false;

    /** @type {number} */
    this.layer = RenderLayer.PROJECTILES;

    // ─── Position ─────────────────────────────────────────────────────────
    /** @type {number} */
    this.x = 0;

    /** @type {number} */
    this.y = 0;

    // ─── Dimensions (small hitbox for precise collision) ──────────────────
    /** @type {number} */
    this.width = 6;

    /** @type {number} */
    this.height = 6;

    // ─── AABB (pre-allocated, synced in update) ───────────────────────────
    /** @type {{ x: number, y: number, width: number, height: number }} */
    this.aabb = { x: 0, y: 0, width: 6, height: 6 };

    // ─── Velocity ─────────────────────────────────────────────────────────
    /** @type {number} Horizontal velocity (px/sec). */
    this.vx = 0;

    /** @type {number} Vertical velocity (px/sec). */
    this.vy = 0;

    /** @type {number} Initial speed (for reference / UI). */
    this.speed = 0;

    /** @type {number} Downward acceleration (0 = straight line). */
    this.gravity = 0;

    // ─── Combat ───────────────────────────────────────────────────────────
    /** @type {number} Damage dealt on hit. */
    this.damage = 0;

    /** @type {boolean} Whether this was a critical hit. */
    this.isCrit = false;

    /** @type {*} Reference to the entity that fired this projectile. */
    this.owner = null;

    // ─── Lifetime / Range ─────────────────────────────────────────────────
    /** @type {number} Maximum travel distance before auto-despawn. */
    this.maxRange = 800;

    /** @type {number} Distance traveled since spawn (accumulated). */
    this.distanceTraveled = 0;

    /** @type {number} Spawn origin X (for distance calculation). */
    this._originX = 0;

    /** @type {number} Spawn origin Y. */
    this._originY = 0;

    // ─── Visual ───────────────────────────────────────────────────────────
    /** @type {string} Core glow color. */
    this.color = '#ffcc00';

    /** @type {string} Trail/halo color. */
    this.trailColor = 'rgba(255, 160, 0, 0.4)';

    /** @type {number} Radius of the projectile dot (px). */
    this.radius = 3;
  }

  // ─── Pool Reset ─────────────────────────────────────────────────────────────

  /**
   * Reinitializes the projectile for a new life cycle.
   * Called by ObjectPool.acquire() after popping from the free-stack.
   *
   * All fields are written to — no stale state from previous use.
   *
   * @param {Object} [props={}]
   * @param {number} [props.x=0]      - Spawn X (world).
   * @param {number} [props.y=0]      - Spawn Y (world).
   * @param {number} [props.dirX=1]   - Aim direction X (will be normalized).
   * @param {number} [props.dirY=0]   - Aim direction Y.
   * @param {number} [props.speed=800] - Speed in px/sec.
   * @param {number} [props.damage=10] - Damage on hit.
   * @param {boolean} [props.isCrit=false]
   * @param {number} [props.gravity=0]
   * @param {number} [props.maxRange=800]
   * @param {*}      [props.owner=null]
   */
  reset(props = {}) {
    // Position.
    this.x = props.x || 0;
    this.y = props.y || 0;

    // Direction normalization.
    // The caller may pass a non-normalized direction vector.
    let dirX = props.dirX || 1;
    let dirY = props.dirY || 0;
    const len = Math.hypot(dirX, dirY);
    if (len > 0) {
      dirX /= len;
      dirY /= len;
    }

    // Velocity.
    this.speed   = props.speed   || 800;
    this.vx      = dirX * this.speed;
    this.vy      = dirY * this.speed;
    this.gravity  = props.gravity  || 0;

    // Combat.
    this.damage  = props.damage  || 10;
    this.isCrit  = props.isCrit  || false;
    this.owner   = props.owner   || null;

    // Range tracking.
    this.maxRange        = props.maxRange || 800;
    this.distanceTraveled = 0;
    this._originX        = this.x;
    this._originY        = this.y;

    // Sync AABB.
    this.aabb.x      = this.x - this.width  * 0.5;
    this.aabb.y      = this.y - this.height * 0.5;
    this.aabb.width  = this.width;
    this.aabb.height = this.height;

    // Activate.
    this.active = true;
  }

  // ─── Update (Physics) ───────────────────────────────────────────────────────

  /**
   * Euler-integrates position and checks range expiry.
   *
   * Physics:
   *   vy += gravity × dt  (if gravity != 0)
   *   x  += vx × dt
   *   y  += vy × dt
   *   distanceTraveled = √((x - originX)² + (y - originY)²)
   *   if distanceTraveled >= maxRange → deactivate (main.js will release).
   *
   * @param {number} dt - Delta time in seconds.
   */
  update(dt) {
    // Apply gravity (arcing projectiles like grenades).
    if (this.gravity !== 0) {
      this.vy += this.gravity * dt;
    }

    // Euler integration.
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Sync AABB (centered on position).
    this.aabb.x = this.x - this.width  * 0.5;
    this.aabb.y = this.y - this.height * 0.5;

    // Range check (squared distance to avoid sqrt, but we already
    // need the actual distance for HUD display, so use hypot once).
    const dx = this.x - this._originX;
    const dy = this.y - this._originY;
    this.distanceTraveled = Math.sqrt(dx * dx + dy * dy);

    if (this.distanceTraveled >= this.maxRange) {
      this.active = false; // Signals main.js to release back to pool.
    }
  }

  // ─── Draw (Canvas Rendering) ────────────────────────────────────────────────

  /**
   * Draws the projectile as a glowing circle with a motion trail.
   *
   * Visual layers:
   *   1. Trail halo (larger, translucent circle behind).
   *   2. Core glow (small, bright circle).
   *   3. Center dot (white, 1px for sparkle).
   *
   * All drawing uses pre-set color strings — no allocation per frame.
   *
   * @param {CanvasRenderingContext2D} ctx - Camera-transformed context.
   */
  draw(ctx) {
    // 1. Trail halo (subtle glow behind the projectile).
    ctx.fillStyle = this.trailColor;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 2. Core body.
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // 3. Center sparkle (1px white dot for crispness).
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, 1, 0, Math.PI * 2);
    ctx.fill();
  }
}
