// ═══════════════════════════════════════════════════════════════════════════════
// WeaponSystem.js — Polymorphic Weapon Hierarchy (Strategy + Template Method)
// ═══════════════════════════════════════════════════════════════════════════════
// Design Pattern: Template Method + Strategy + Polymorphism
//
// Rationale:
//   The game features three fundamentally different attack mechanics:
//     1. Melee   → Sweep hitbox (arc-shaped AABB test)
//     2. Ranged  → Ballistic projectile (Euler-integrated velocity vector)
//     3. Energy  → Hitscan raycast (DDA or parametric line-AABB intersection)
//
//   Each type computes damage differently, but shares common concerns:
//   cooldown management, ammo/durability tracking, stat modifiers, and
//   animation triggers. The base Weapon class encodes the shared skeleton
//   (Template Method), while subclasses override the `_executeAttack()` hook
//   (Strategy) to implement type-specific math.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { randomRange } from '../utils/MathUtils.js';

/**
 * @typedef {Object} Vec2
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} WeaponStats
 * @property {number} baseDamage      - Raw damage per hit (before modifiers).
 * @property {number} cooldownMs      - Minimum time between attacks (ms).
 * @property {number} range           - Effective range (world units).
 * @property {number} knockbackForce  - Impulse applied to target on hit.
 * @property {number} critChance      - Critical hit probability [0, 1].
 * @property {number} critMultiplier  - Damage multiplier on crit (e.g., 2.0).
 */

/**
 * @typedef {Object} AttackContext
 * @property {Vec2}   origin     - World position of the attacker.
 * @property {Vec2}   direction  - Normalized aim direction vector.
 * @property {number} timestamp  - Current game time (ms), for cooldown checks.
 * @property {Object} owner      - Reference to the attacking entity.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Abstract Base: Weapon
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abstract base class for all weapon types.
 *
 * Implements the Template Method pattern:
 *   attack(ctx) → [cooldown check] → [durability check] → _executeAttack(ctx)
 *
 * Subclasses MUST override `_executeAttack()` to define their specific
 * damage-dealing mechanism (sweep, projectile, or raycast).
 */
export class Weapon {

  /**
   * @param {string} id   - Unique weapon identifier.
   * @param {string} name - Display name (e.g., "Iron Sword", "Plasma Rifle").
   * @param {WeaponStats} stats - Base stats for this weapon instance.
   */
  constructor(id, name, stats) {
    /** @type {string} */
    this.id = id;

    /** @type {string} */
    this.name = name;

    /** @type {WeaponStats} Mutable — can be modified by buffs/upgrades. */
    this.stats = { ...stats };

    /** @type {number} Timestamp of last attack, for cooldown enforcement. */
    this._lastAttackTime = 0;

    /** @type {number} Current durability. -1 = indestructible. */
    this.durability = -1;

    /** @type {boolean} Whether this weapon is currently equipped. */
    this.isEquipped = false;
  }

  /**
   * Template Method: Attempts to execute an attack.
   *
   * Flow:
   *   1. Check cooldown: if (ctx.timestamp - _lastAttackTime < cooldownMs) → abort.
   *   2. Check durability: if (durability === 0) → abort (weapon broken).
   *   3. Call _executeAttack(ctx) — polymorphic dispatch to subclass.
   *   4. Update _lastAttackTime.
   *   5. Decrement durability (if not indestructible).
   *   6. Return attack result (hits, damage dealt, etc.).
   *
   * @param {AttackContext} ctx - Attack parameters.
   * @returns {Object|null} Attack result or null if on cooldown / broken.
   */
  attack(ctx) {
    // ── 1. Cooldown check ─────────────────────────────────────────────────
    if (ctx.timestamp - this._lastAttackTime < this.stats.cooldownMs) {
      return null; // Still on cooldown.
    }

    // ── 2. Durability check ───────────────────────────────────────────────
    if (this.durability === 0) {
      return null; // Weapon broken.
    }

    // ── 3. Polymorphic dispatch to subclass ────────────────────────────────
    const result = this._executeAttack(ctx);

    // ── 4. Update cooldown timestamp ──────────────────────────────────────
    this._lastAttackTime = ctx.timestamp;

    // ── 5. Decrement durability (if not indestructible) ───────────────────
    if (this.durability > 0) {
      this.durability--;
    }

    return result;
  }

  /**
   * @abstract
   * Polymorphic hook — overridden by each weapon subclass.
   * Contains the type-specific attack math.
   *
   * @param {AttackContext} ctx
   * @returns {Object} Attack result payload (format varies by weapon type).
   * @protected
   */
  _executeAttack(ctx) {
    throw new Error('_executeAttack() must be overridden by subclass.');
  }

  /**
   * Computes final damage with crit roll.
   *
   * Math:
   *   roll = Math.random()
   *   if roll < critChance → damage = baseDamage × critMultiplier
   *   else                 → damage = baseDamage
   *
   * @returns {{ damage: number, isCrit: boolean }}
   * @protected
   */
  _rollDamage() {
    const isCrit = Math.random() < this.stats.critChance;
    const damage = isCrit
      ? this.stats.baseDamage * this.stats.critMultiplier
      : this.stats.baseDamage;
    return { damage, isCrit };
  }

  /**
   * Checks if the weapon is off cooldown and ready to fire.
   *
   * @param {number} currentTimestamp
   * @returns {boolean}
   */
  isReady(currentTimestamp) {
    return (currentTimestamp - this._lastAttackTime) >= this.stats.cooldownMs;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// MeleeWeapon — Sweep Hitbox (Arc-AABB Intersection)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Melee weapons deal damage in a sweep arc emanating from the attacker.
 *
 * Geometry:
 *   The sweep is modeled as a circular sector (pie slice):
 *     center  = attacker.position
 *     radius  = weapon.range
 *     halfArc = sweepAngle / 2  (radians)
 *     forward = atan2(direction.y, direction.x)
 *
 *   For each candidate entity in the spatial grid query:
 *     1. Compute vector from center to entity center.
 *     2. Check distance ≤ radius.
 *     3. Check angle between forward and entity vector ≤ halfArc.
 *        Using: dot(normalize(toEntity), forward) >= cos(halfArc)
 *
 * Examples: Sword, Axe, Spear (narrow arc, longer range).
 */
export class MeleeWeapon extends Weapon {

  /**
   * @param {string} id
   * @param {string} name
   * @param {WeaponStats} stats
   * @param {number} sweepAngleRad - Total sweep arc in radians.
   */
  constructor(id, name, stats, sweepAngleRad = Math.PI / 2) {
    super(id, name, stats);

    /** @type {number} Half-angle of the sweep arc (radians). */
    this.halfArc = sweepAngleRad / 2;

    /** @type {number} Precomputed cosine threshold for arc test. */
    this.cosHalfArc = Math.cos(this.halfArc);
  }

  /**
   * @override
   * @param {AttackContext} ctx
   * @returns {{ hits: Array<{ entityId: string, damage: number, isCrit: boolean }> }}
   */
  _executeAttack(ctx) {
    // TODO (Phase 4): Implement sweep hitbox detection via arc-sector test.
    return { hits: [] };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// BallisticWeapon — Projectile Spawning (Euler Integration Vectors)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ballistic weapons spawn physical projectile entities with velocity vectors.
 *
 * Physics:
 *   The projectile is a point AABB that updates each frame:
 *     position += velocity × dt
 *
 * Projectile spawning delegates to the PoolManager for zero-allocation shots.
 * The weapon does NOT own the projectiles — EntityManager does.
 *
 * Examples: Bow, Crossbow, Shotgun, Grenade Launcher.
 */
export class BallisticWeapon extends Weapon {

  /**
   * @param {string} id
   * @param {string} name
   * @param {WeaponStats} stats
   * @param {number} projectileSpeed - Initial speed (world units/sec).
   * @param {number} gravity - Downward acceleration (0 = straight line).
   * @param {number} projectileCount - Number of projectiles per shot (shotgun = 5).
   * @param {number} spreadAngleRad - Random angular deviation per projectile.
   *        0 = perfectly accurate, π/12 = 15° spread cone.
   */
  constructor(id, name, stats, projectileSpeed = 800, gravity = 0, projectileCount = 1, spreadAngleRad = 0) {
    super(id, name, stats);

    /** @type {number} */
    this.projectileSpeed = projectileSpeed;

    /** @type {number} */
    this.gravity = gravity;

    /** @type {number} */
    this.projectileCount = projectileCount;

    /** @type {number} */
    this.spreadAngleRad = Math.PI / 16; // aprox 11 graus de variação

    /**
     * Reference to the PoolManager. Injected externally after construction.
     * Required for acquiring projectile instances from the pool.
     * @type {import('../core/PoolManager.js').PoolManager|null}
     */
    this.poolManagerRef = null;

    /**
     * Reference to the EntityManager. Injected externally after construction.
     * Required for registering spawned projectiles into the world.
     * @type {import('../core/EntityManager.js').EntityManager|null}
     */
    this.entityManagerRef = null;
  }

  /**
   * Spawns one or more projectiles from the pool.
   *
   * For each projectile i in [0, projectileCount):
   *   1. Compute base angle: atan2(dir.y, dir.x).
   *   2. Add random spread: angle += random(-spread/2, +spread/2).
   *   3. Compute velocity vector:
   *      dirX = cos(angle)
   *      dirY = sin(angle)
   *   4. Roll damage (with crit chance).
   *   5. Acquire projectile from PoolManager.
   *   6. Reset with { x, y, dirX, dirY, speed, damage, owner, gravity }.
   *   7. Add to EntityManager for update/draw integration.
   *
   * @param {AttackContext} ctx
   * @returns {{ spawnedCount: number }}
   * @override
   */
  _executeAttack(ctx) {
    if (!this.poolManagerRef || !this.entityManagerRef) {
      return { spawnedCount: 0 };
    }

    if (window.game && window.game.camera) {
      window.game.camera.addShake(0.1, 2);
    }

    const baseAngle = Math.atan2(ctx.direction.y, ctx.direction.x);
    let spawnedCount = 0;

    for (let i = 0; i < this.projectileCount; i++) {
      // ── 1. Adiciona dispersão ao ângulo base ────────────────────────────────
      const finalAngle = baseAngle + randomRange(-this.spreadAngleRad, this.spreadAngleRad);

      // ── 2. Roll damage with crit ────────────────────────────────────────────
      const { damage, isCrit } = this._rollDamage();

      // ── 3. Acquire from pool (zero-allocation) ──────────────────────────────
      const proj = this.poolManagerRef.acquire('projectile', {
        x:        ctx.origin.x,
        y:        ctx.origin.y,
        dirX:     Math.cos(finalAngle),
        dirY:     Math.sin(finalAngle),
        speed:    this.projectileSpeed,
        damage,
        isCrit,
        gravity:  this.gravity,
        maxRange: this.stats.range,
        owner:    ctx.owner,
      });

      // ── 5. Register in EntityManager ────────────────────────────────────────
      this.entityManagerRef.addEntity(proj);

      spawnedCount++;
    }

    return { spawnedCount };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// EnergyWeapon — Hitscan Raycast (DDA / Parametric Line-AABB)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Energy weapons perform instantaneous line-of-sight damage (hitscan).
 *
 * Examples: Laser Rifle, Tesla Coil, Plasma Beam.
 */
export class EnergyWeapon extends Weapon {

  /**
   * @param {string} id
   * @param {string} name
   * @param {WeaponStats} stats
   * @param {number} penetration - Number of targets the beam can pass through.
   * @param {number} beamWidth - Visual width of the beam (pixels).
   */
  constructor(id, name, stats, penetration = 1, beamWidth = 2) {
    super(id, name, stats);

    /** @type {number} */
    this.penetration = penetration;

    /** @type {number} Visual only — does not affect hit detection. */
    this.beamWidth = beamWidth;
  }

  /**
   * @override
   * @param {AttackContext} ctx
   * @returns {{ hits: Array, rayStart: Vec2, rayEnd: Vec2 }}
   */
  _executeAttack(ctx) {
    // TODO (Phase 4): DDA ray march through SpatialGrid, Slab AABB intersection.
    return {
      hits: [],
      rayStart: { x: ctx.origin.x, y: ctx.origin.y },
      rayEnd: {
        x: ctx.origin.x + ctx.direction.x * this.stats.range,
        y: ctx.origin.y + ctx.direction.y * this.stats.range,
      },
    };
  }
}
