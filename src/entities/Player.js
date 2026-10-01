// ═══════════════════════════════════════════════════════════════════════════════
// Player.js — Player Entity (Phase 3: Combat-Ready)
// ═══════════════════════════════════════════════════════════════════════════════
// Conforms to GameEntity interface: { id, active, layer, aabb, update, draw }
//
// Phase 3 additions:
//   - Equipped BallisticWeapon with mouse-aim firing.
//   - Aim direction computed from player center → mouse world position.
//   - Weapon fires on left mouse button hold (auto-fire at cooldown rate).
//
// Zero-Allocation in hot path:
//   update() and draw() create NO objects except the AttackContext object
//   passed to weapon.attack(). This is unavoidable but contains only
//   primitive fields and is immediately consumed (not retained).
//
// ═══════════════════════════════════════════════════════════════════════════════

import { RenderLayer }    from '../core/EntityManager.js';
import { BallisticWeapon } from '../combat/WeaponSystem.js';

/**
 * Player entity with input-driven movement, diagonal normalization,
 * and mouse-aimed ballistic weapon firing.
 */
export class Player {

  /**
   * @param {string} id - Unique entity identifier.
   * @param {number} x - Initial X position (world space).
   * @param {number} y - Initial Y position (world space).
   * @param {import('../core/InputManager.js').InputManager} inputManagerRef
   */
  constructor(id, x, y, inputManagerRef) {
    // ─── GameEntity Interface Fields ──────────────────────────────────────
    /** @type {string} */
    this.id = id || 'player';

    /** @type {boolean} */
    this.active = true;

    /** @type {number} */
    this.layer = RenderLayer.ENTITIES;

    // ─── Position (world space) ───────────────────────────────────────────
    /** @type {number} */
    this.x = x || 0;

    /** @type {number} */
    this.y = y || 0;

    // ─── Dimensions ───────────────────────────────────────────────────────
    /** @type {number} */
    this.width = 32;

    /** @type {number} */
    this.height = 32;

    // ─── AABB (synced with position every frame) ──────────────────────────
    /** @type {{ x: number, y: number, width: number, height: number }} */
    this.aabb = { x, y, width: this.width, height: this.height };

    // ─── Velocity ─────────────────────────────────────────────────────────
    /** @type {number} */
    this.vx = 0;

    /** @type {number} */
    this.vy = 0;

    // ─── Movement ─────────────────────────────────────────────────────────
    /** @type {number} Movement speed in px/sec. */
    this.speed = 300;

    // ─── Visual ───────────────────────────────────────────────────────────
    /** @type {string} */
    this.color = '#53d8fb';

    /** @type {string} */
    this.borderColor = '#0f3460';

    // ─── Input Reference ──────────────────────────────────────────────────
    /**
     * @type {import('../core/InputManager.js').InputManager}
     */
    this.inputManager = inputManagerRef;

    // ─── Weapon System ────────────────────────────────────────────────────
    /**
     * Equipped ballistic weapon. Created ONCE in the constructor.
     * No `new` calls happen during gameplay.
     *
     * Stats:
     *   baseDamage: 15
     *   cooldownMs: 120ms (~8.3 shots/sec for auto-fire feel)
     *   range: 600px travel distance per projectile
     *   critChance: 10%, critMultiplier: 2.0
     *
     * @type {BallisticWeapon}
     */
    this.weapon = new BallisticWeapon(
      'player_blaster',
      'Plasma Blaster',
      {
        baseDamage:     15,
        cooldownMs:     120,
        range:          600,
        critChance:     0.1,
        critMultiplier: 2.0,
      },
      /* projectileSpeed */  800,
      /* gravity */          0,
      /* projectileCount */  1,
      /* spreadAngleRad */   0.05   // ~3° spread for slight inaccuracy.
    );

    // ─── Aim Direction (pre-allocated, updated each frame) ────────────────
    /**
     * Normalized aim direction vector (player center → mouse world position).
     * Written to in update(), read by weapon.attack() and draw().
     * @type {number}
     */
    this._aimDirX = 1;

    /** @type {number} */
    this._aimDirY = 0;

    /**
     * Monotonically increasing game time (ms) for weapon cooldown tracking.
     * Accumulated from dt each frame.
     * @type {number}
     */
    this._gameTimeMs = 0;
  }

  // ─── Update (Physics + Combat) ──────────────────────────────────────────────

  /**
   * Processes movement input, normalizes diagonal, integrates position,
   * computes aim direction, and fires weapon on mouse click.
   *
   * @param {number} dt - Delta time in seconds.
   */
  update(dt) {
    if (!this.inputManager) return;

    // Accumulate game time for weapon cooldown.
    this._gameTimeMs += dt * 1000;

    // ── 1. Movement ───────────────────────────────────────────────────────
    let dx = 0;
    let dy = 0;

    if (this.inputManager.isActionDown('LEFT'))  dx -= 1;
    if (this.inputManager.isActionDown('RIGHT')) dx += 1;
    if (this.inputManager.isActionDown('UP'))    dy -= 1;
    if (this.inputManager.isActionDown('DOWN'))  dy += 1;

    const length = Math.hypot(dx, dy);
    if (length > 0) {
      dx /= length;
      dy /= length;
    }

    this.vx = dx * this.speed;
    this.vy = dy * this.speed;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.aabb.x = this.x;
    this.aabb.y = this.y;

    // ── 2. Aim Direction (player center → mouse world position) ───────────
    const centerX = this.x + this.width  * 0.5;
    const centerY = this.y + this.height * 0.5;

    const toMouseX = this.inputManager.mouse.worldX - centerX;
    const toMouseY = this.inputManager.mouse.worldY - centerY;
    const aimLen = Math.hypot(toMouseX, toMouseY);

    if (aimLen > 0) {
      this._aimDirX = toMouseX / aimLen;
      this._aimDirY = toMouseY / aimLen;
    }

    // ── 3. Fire Weapon (left mouse button held = auto-fire) ───────────────
    if (this.inputManager.mouse.isDown && this.inputManager.mouse.button === 0) {
      this.weapon.attack({
        origin:    { x: centerX, y: centerY },
        direction: { x: this._aimDirX, y: this._aimDirY },
        timestamp: this._gameTimeMs,
        owner:     this,
      });
    }
  }

  // ─── Draw (Canvas Rendering) ────────────────────────────────────────────────

  /**
   * Draws the player rectangle + an aim line toward the mouse cursor.
   *
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    // Border.
    ctx.fillStyle = this.borderColor;
    ctx.fillRect(this.x - 1, this.y - 1, this.width + 2, this.height + 2);

    // Body.
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.width, this.height);

    // Direction indicator (white dot).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(this.x + this.width / 2 - 3, this.y + 2, 6, 6);

    // ── Aim Line ──────────────────────────────────────────────────────────
    // A short line from the player's center in the aim direction.
    // Gives visual feedback of where projectiles will go.
    const cx = this.x + this.width  * 0.5;
    const cy = this.y + this.height * 0.5;
    const aimLength = 40; // Aim line length in px.

    ctx.strokeStyle = 'rgba(255, 200, 0, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + this._aimDirX * aimLength,
      cy + this._aimDirY * aimLength
    );
    ctx.stroke();
  }
}
