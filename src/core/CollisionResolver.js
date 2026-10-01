// ═══════════════════════════════════════════════════════════════════════════════
// CollisionResolver.js — Narrow-Phase AABB Collision Response (Pure Functions)
// ═══════════════════════════════════════════════════════════════════════════════
// Design Pattern: Stateless Utility Module (no class, no state, no allocation)
//
// Rationale:
//   After the SpatialGrid (broad-phase) returns candidate pairs, we need
//   to compute the EXACT overlap and resolve it. This module implements:
//
//   1. AABB overlap test (already in MathUtils as aabbOverlap).
//   2. Minimum Translation Vector (MTV) computation.
//   3. Position correction (push the dynamic entity out of the static one).
//
// MTV Algorithm:
//   Given two overlapping AABBs, compute the overlap on each axis:
//     overlapX = min(a.right, b.right) - max(a.left, b.left)
//     overlapY = min(a.bottom, b.bottom) - max(a.top, b.top)
//
//   The MTV pushes along the axis of LEAST overlap:
//     if overlapX < overlapY → push on X axis
//     else                   → push on Y axis
//
//   Direction is determined by the relative centers of the two AABBs:
//     if a.centerX < b.centerX → push a to the LEFT (negative X)
//     else                     → push a to the RIGHT (positive X)
//
//   This produces smooth "wall sliding" behavior: the player can move
//   along a wall by pressing diagonally into it.
//
// ═══════════════════════════════════════════════════════════════════════════════
// Zero-Allocation:
//   All functions modify the entity's x/y IN PLACE. No objects are created.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { RenderLayer } from './EntityManager.js';
import { StaticProp } from '../entities/StaticProp.js';
import { Projectile } from '../entities/Projectile.js';
import { Enemy } from '../entities/Enemy.js';

/**
 * Tests if two AABBs overlap. Inline version for tight loops.
 *
 * @param {number} ax - A left edge.
 * @param {number} ay - A top edge.
 * @param {number} aw - A width.
 * @param {number} ah - A height.
 * @param {number} bx - B left edge.
 * @param {number} by - B top edge.
 * @param {number} bw - B width.
 * @param {number} bh - B height.
 * @returns {boolean}
 */
function testOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * Resolves collisions between the player and an array of static entities.
 *
 * The player is the ONLY dynamic body. Static entities (walls, rocks, crates)
 * never move — the player is pushed OUT of them.
 *
 * Algorithm:
 *   For each static entity that overlaps the player:
 *     1. Compute overlap on X and Y axes.
 *     2. Push on the axis of minimum overlap (MTV).
 *     3. Update the player's AABB to reflect the new position.
 *        (This is critical: subsequent collisions in the same frame
 *         must see the corrected position, not the original.)
 *
 * Wall Sliding:
 *   Because we resolve one axis at a time and pick the minimum overlap,
 *   the player naturally "slides" along walls when pressing diagonally.
 *   Example: pressing UP+RIGHT into a wall on the right → overlapX is
 *   tiny, overlapY is large → push on X only → player slides UP.
 *
 * @param {{ x: number, y: number, width: number, height: number, aabb: { x: number, y: number, width: number, height: number } }} player
 *        The dynamic entity. Its x, y, and aabb are modified in place.
 * @param {Array<{ aabb: { x: number, y: number, width: number, height: number } }>} statics
 *        Array of static entities from a SpatialGrid query.
 */
export function resolvePlayerEnvironment(player, statics) {
  const pw = player.width;
  const ph = player.height;

  for (let i = 0; i < statics.length; i++) {
    const s = statics[i];

    // Skip self-collision and entities owned by the player (like their own projectiles).
    if (s === player || s.id === player.id || s.owner === player) continue;

    // Skip entities without a solid AABB.
    if (!s.aabb) continue;

    const sx = s.aabb.x;
    const sy = s.aabb.y;
    const sw = s.aabb.width;
    const sh = s.aabb.height;

    // ── 1. Broad overlap test ─────────────────────────────────────────────
    if (!testOverlap(player.x, player.y, pw, ph, sx, sy, sw, sh)) {
      continue; // No collision with this entity.
    }

    // ── 2. Compute overlap on each axis ───────────────────────────────────
    //   overlapX = min(player.right, static.right) - max(player.left, static.left)
    //   overlapY = min(player.bottom, static.bottom) - max(player.top, static.top)
    const overlapX = Math.min(player.x + pw, sx + sw) - Math.max(player.x, sx);
    const overlapY = Math.min(player.y + ph, sy + sh) - Math.max(player.y, sy);

    // Both must be positive for a real overlap (should always be true here).
    if (overlapX <= 0 || overlapY <= 0) continue;

    // ── 3. Determine push direction via center comparison ─────────────────
    //   Player center vs static center determines sign of the push.
    const playerCenterX = player.x + pw * 0.5;
    const playerCenterY = player.y + ph * 0.5;
    const staticCenterX = sx + sw * 0.5;
    const staticCenterY = sy + sh * 0.5;

    // ── 4. Push on the axis of MINIMUM overlap (MTV) ──────────────────────
    if (overlapX < overlapY) {
      // Resolve on X axis.
      if (playerCenterX < staticCenterX) {
        // Player is to the LEFT of the static → push left.
        player.x -= overlapX;
      } else {
        // Player is to the RIGHT → push right.
        player.x += overlapX;
      }
    } else {
      // Resolve on Y axis.
      if (playerCenterY < staticCenterY) {
        // Player is ABOVE the static → push up.
        player.y -= overlapY;
      } else {
        // Player is BELOW → push down.
        player.y += overlapY;
      }
    }

    // This is CRITICAL: subsequent iterations must see the updated position.
    // Without this, the player can be pushed into a second wall by the
    // first resolution, creating jitter or phase-through bugs.
    player.aabb.x = player.x;
    player.aabb.y = player.y;
  }
}

/**
 * Resolves collisions for an enemy against environment, other enemies, and projectiles.
 *
 * @param {Enemy} enemy
 * @param {Array<Object>} nearbyEntities
 */
export function resolveEnemyCollisions(enemy, nearbyEntities) {
  const ew = enemy.width;
  const eh = enemy.height;
  
  for (let i = 0; i < nearbyEntities.length; i++) {
    const s = nearbyEntities[i];
    if (s === enemy || !s.active || !s.aabb) continue;

    if (testOverlap(enemy.x, enemy.y, ew, eh, s.aabb.x, s.aabb.y, s.aabb.width, s.aabb.height)) {
      const overlapX = Math.min(enemy.x + ew, s.aabb.x + s.aabb.width) - Math.max(enemy.x, s.aabb.x);
      const overlapY = Math.min(enemy.y + eh, s.aabb.y + s.aabb.height) - Math.max(enemy.y, s.aabb.y);

      if (overlapX > 0 && overlapY > 0) {
        // 3. Regra de Combate (Projectiles)
        if (s.layer === RenderLayer.PROJECTILES && s.active) {
          if (s.owner !== enemy) {
            enemy.health -= s.damage;
            s.active = false;
            if (enemy.health <= 0) enemy.active = false;
          }
          continue;
        }

        const enemyCenterX = enemy.x + ew * 0.5;
        const enemyCenterY = enemy.y + eh * 0.5;
        const sCenterX = s.aabb.x + s.aabb.width * 0.5;
        const sCenterY = s.aabb.y + s.aabb.height * 0.5;

        // 1. Regra de Parede (Statics)
        if (s instanceof StaticProp) {
          if (overlapX < overlapY) {
            if (enemyCenterX < sCenterX) enemy.x -= overlapX;
            else enemy.x += overlapX;
          } else {
            if (enemyCenterY < sCenterY) enemy.y -= overlapY;
            else enemy.y += overlapY;
          }
          enemy.aabb.x = enemy.x;
          enemy.aabb.y = enemy.y;
        } 
        // 2. Regra de Separação (Soft Collision)
        else if (s instanceof Enemy) {
          const pushX = overlapX * 0.10; // 10% do overlap
          const pushY = overlapY * 0.10; // 10% do overlap

          if (overlapX < overlapY) {
            if (enemyCenterX < sCenterX) {
              enemy.x -= pushX;
              s.x += pushX;
            } else {
              enemy.x += pushX;
              s.x -= pushX;
            }
          } else {
            if (enemyCenterY < sCenterY) {
              enemy.y -= pushY;
              s.y += pushY;
            } else {
              enemy.y += pushY;
              s.y -= pushY;
            }
          }
          enemy.aabb.x = enemy.x;
          enemy.aabb.y = enemy.y;
          s.aabb.x = s.x;
          s.aabb.y = s.y;
        }
      }
    }
  }
}
