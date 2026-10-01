// ═══════════════════════════════════════════════════════════════════════════════
// EntityManager.js — Central Entity Lifecycle & Render Pipeline Controller
// ═══════════════════════════════════════════════════════════════════════════════
// Design Pattern: Mediator + Component Registry + Layered Rendering
//
// Rationale:
//   The EntityManager is the central nervous system of the game loop.
//   It owns the master list of all live entities and orchestrates:
//     1. update(dt) calls — physics, AI, state machines (60fps).
//     2. draw(ctx) calls — Canvas rendering in correct z-order.
//     3. Entity lifecycle — spawn (from pool), despawn (to pool), transitions.
//
//   Strict separation: EntityManager does NOT contain rendering code.
//   It calls entity.draw(ctx), where each entity knows how to draw itself.
//   EntityManager only controls the ORDER and CULLING of draw calls.
//
// Layer System:
//   Entities are organized into render layers for correct visual ordering:
//     0: GROUND       (terrain, floor decals)
//     1: SHADOWS      (entity shadows, pre-rendered)
//     2: ENTITIES     (players, enemies, NPCs)
//     3: PROJECTILES  (bullets, arrows, beams)
//     4: PARTICLES    (blood, sparks, smoke)
//     5: UI_WORLD     (health bars, damage numbers, floating text)
//
// ═══════════════════════════════════════════════════════════════════════════════

import { aabbOverlap } from '../utils/MathUtils.js';

/**
 * @typedef {Object} GameEntity
 * @property {string|number} id      - Unique entity identifier.
 * @property {boolean}       active  - If false, skip update and draw.
 * @property {number}        layer   - Render layer index (see Layer System above).
 * @property {AABB}          aabb    - Bounding box for spatial grid and culling.
 * @property {function(number): void} update - Physics/logic tick, receives deltaTime.
 * @property {function(CanvasRenderingContext2D): void} draw - Canvas render call.
 * @property {function(): void} reset  - Reinitialize state (called by pool on acquire).
 */

/**
 * Render layer constants.
 * Using an enum-like object for readability and IDE autocomplete.
 * @readonly
 * @enum {number}
 */
export const RenderLayer = Object.freeze({
  GROUND:      0,
  SHADOWS:     1,
  ENTITIES:    2,
  PROJECTILES: 3,
  PARTICLES:   4,
  UI_WORLD:    5,
});

/**
 * Pre-sorted array of layer indices for deterministic iteration order.
 * Computed once at module load — not per frame.
 * @type {number[]}
 */
const LAYER_ORDER = Object.values(RenderLayer).sort((a, b) => a - b);

/**
 * Central entity management system.
 *
 * Responsibilities:
 *   - Maintains a live entity registry (Map for O(1) lookup by ID).
 *   - Drives the update loop: iterates all active entities, calls update(dt).
 *   - Drives the draw loop: iterates entities by layer, applies camera culling,
 *     calls draw(ctx) only for visible entities.
 *   - Coordinates with SpatialGrid: auto-updates entity positions in the grid.
 *   - Coordinates with PoolManager: routes spawn/despawn through pools.
 */
export class EntityManager {

  /**
   * @param {import('./SpatialGrid.js').SpatialGrid} spatialGrid - Spatial hash for collision.
   * @param {import('./PoolManager.js').PoolManager} [poolManager=null] - Object pool registry (optional in Phase 2).
   */
  constructor(spatialGrid, poolManager = null) {
    /** @type {import('./SpatialGrid.js').SpatialGrid} */
    this._spatialGrid = spatialGrid;

    /** @type {import('./PoolManager.js').PoolManager|null} */
    this._poolManager = poolManager;

    /**
     * Master entity registry. Key = entity.id, Value = entity reference.
     * @type {Map<string|number, GameEntity>}
     */
    this._entities = new Map();

    /**
     * Entities organized by render layer for ordered drawing.
     * Each layer is an array of entity references.
     * @type {Map<number, GameEntity[]>}
     */
    this._layers = new Map();

    // Initialize empty layer arrays.
    for (let i = 0; i < LAYER_ORDER.length; i++) {
      this._layers.set(LAYER_ORDER[i], []);
    }

    /**
     * Deferred operations queue.
     * Entities added/removed during iteration are queued and applied
     * at the end of the frame to avoid concurrent modification bugs.
     * @type {{ action: 'add'|'remove', entity: GameEntity }[]}
     */
    this._deferredQueue = [];

    /**
     * Flag to indicate we are currently iterating (update or draw).
     * While true, add/remove operations are deferred.
     * @type {boolean}
     */
    this._isIterating = false;
  }

  // ─── Entity Lifecycle ───────────────────────────────────────────────────────

  /**
   * Spawns an entity into the world.
   *
   * If called during iteration (update/draw), the operation is deferred.
   *
   * Steps:
   *   1. Add to _entities map (by id).
   *   2. Insert into the correct _layers array (by entity.layer).
   *   3. Insert into SpatialGrid (for collision queries).
   *
   * @param {GameEntity} entity - Fully initialized entity (id, layer, aabb set).
   */
  addEntity(entity) {
    // Guard against duplicate ID.
    if (this._entities.has(entity.id)) return;

    if (this._isIterating) {
      this._deferredQueue.push({ action: 'add', entity });
      return;
    }

    this._addEntityImmediate(entity);
  }

  /**
   * Immediately adds an entity (not deferred).
   * @param {GameEntity} entity
   * @private
   */
  _addEntityImmediate(entity) {
    this._entities.set(entity.id, entity);

    // Insert into the correct render layer.
    const layerArray = this._layers.get(entity.layer);
    if (layerArray !== undefined) {
      layerArray.push(entity);
    }

    // Insert into the spatial grid for collision queries.
    if (entity.aabb) {
      this._spatialGrid.insert(entity);
    }
  }

  /**
   * Removes an entity from the world (despawns).
   *
   * If called during iteration, the operation is deferred.
   *
   * Steps:
   *   1. Remove from _entities map.
   *   2. Remove from _layers array (splice by reference).
   *   3. Remove from SpatialGrid.
   *
   * @param {string|number} entityId - ID of entity to remove.
   */
  removeEntity(entityId) {
    const entity = this._entities.get(entityId);
    if (entity === undefined) return;

    if (this._isIterating) {
      this._deferredQueue.push({ action: 'remove', entity });
      return;
    }

    this._removeEntityImmediate(entity);
  }

  /**
   * Immediately removes an entity (not deferred).
   * @param {GameEntity} entity
   * @private
   */
  _removeEntityImmediate(entity) {
    this._entities.delete(entity.id);

    // Remove from the render layer array.
    const layerArray = this._layers.get(entity.layer);
    if (layerArray !== undefined) {
      const idx = layerArray.indexOf(entity);
      if (idx !== -1) {
        // Swap with last element and pop — O(1) removal, order within
        // a single layer doesn't matter for correctness.
        layerArray[idx] = layerArray[layerArray.length - 1];
        layerArray.pop();
      }
    }

    // Remove from the spatial grid.
    if (entity.aabb) {
      this._spatialGrid.remove(entity);
    }
  }

  /**
   * Spawns a pooled entity. Acquires from PoolManager, initializes, and adds.
   *
   * @param {string} poolKey - PoolManager key (e.g., 'projectile', 'enemy_grunt').
   * @param {number} layer - Render layer.
   * @param {Object} initProps - Properties to set on the entity after reset().
   * @returns {GameEntity} The spawned entity.
   */
  spawnFromPool(poolKey, layer, initProps = {}) {
    if (!this._poolManager) throw new Error('PoolManager not configured.');

    const entity = this._poolManager.acquire(poolKey);
    entity.layer = layer;

    // Apply initialization properties.
    const propKeys = Object.keys(initProps);
    for (let i = 0; i < propKeys.length; i++) {
      entity[propKeys[i]] = initProps[propKeys[i]];
    }

    this.addEntity(entity);
    return entity;
  }

  /**
   * Despawns and releases a pooled entity back to its pool.
   *
   * @param {string} poolKey - PoolManager key.
   * @param {string|number} entityId
   */
  despawnToPool(poolKey, entityId) {
    if (!this._poolManager) throw new Error('PoolManager not configured.');

    const entity = this._entities.get(entityId);
    if (entity === undefined) return;

    this.removeEntity(entityId);
    this._poolManager.release(poolKey, entity);
  }

  /**
   * Processes the deferred add/remove queue.
   * Called at the end of each update() and draw() cycle.
   * @private
   */
  _flushDeferredQueue() {
    for (let i = 0; i < this._deferredQueue.length; i++) {
      const op = this._deferredQueue[i];
      if (op.action === 'add') {
        this._addEntityImmediate(op.entity);
      } else {
        this._removeEntityImmediate(op.entity);
      }
    }
    // Clear the queue without reallocating the array.
    this._deferredQueue.length = 0;
  }

  // ─── Update Loop (Physics / Logic) ──────────────────────────────────────────

  /**
   * Updates all active entities for the current frame.
   *
   * Flow:
   *   1. Set _isIterating = true.
   *   2. Iterate _entities.values():
   *      a. Skip if entity.active === false.
   *      b. Call entity.update(dt).
   *      c. Update entity's position in SpatialGrid (if it has an aabb).
   *   3. Set _isIterating = false.
   *   4. Flush deferred queue.
   *
   * Performance note:
   *   With 1000 entities at 60fps, this loop runs 60k iterations/sec.
   *   Each entity.update(dt) should be ≤ 0.05ms to stay within 3ms budget.
   *
   * @param {number} dt - Delta time in seconds (e.g., 0.0167 for 60fps).
   * @param {*} [context] - Context to pass to entities (e.g. the player).
   */
  update(dt, context) {
    this._isIterating = true;

    for (const entity of this._entities.values()) {
      if (entity.active === false) continue;

      // Call the entity's own update logic (movement, AI, etc.).
      if (typeof entity.update === 'function') {
        entity.update(dt, context);
      }

      // Sync the entity's current position into the spatial grid.
      // SpatialGrid.update() is a no-op if the entity hasn't crossed
      // a cell boundary, so this is cheap for stationary entities.
      if (entity.aabb) {
        this._spatialGrid.update(entity);
      }
    }

    this._isIterating = false;

    // Sweep: Clean up any entities that died during the update loop.
    for (const [id, entity] of this._entities) {
      if (!entity.active) {
        this.removeEntity(id); // Instantly removes and releases to pool
      }
    }

    this._flushDeferredQueue();
  }

  // ─── Draw Loop (Canvas Rendering) ──────────────────────────────────────────

  /**
   * Renders all visible entities to the canvas, sorted by render layer.
   *
   * Flow:
   *   1. Set _isIterating = true.
   *   2. For each layer in ascending order (GROUND → UI_WORLD):
   *      For each entity in that layer:
   *        a. Skip if entity.active === false.
   *        b. Frustum cull: skip if entity.aabb is outside camera viewport.
   *        c. Call entity.draw(ctx).
   *   3. Set _isIterating = false.
   *   4. Flush deferred queue.
   *
   * Camera Culling (AABB intersection with viewport):
   *   visible = !(entity.right < cam.left || entity.left > cam.right ||
   *               entity.bottom < cam.top || entity.top > cam.bottom)
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas 2D rendering context.
   * @param {{ x: number, y: number, width: number, height: number }} cameraViewport
   *        The camera's visible region in world coordinates.
   */
  draw(ctx, cameraViewport) {
    this._isIterating = true;

    const cvx = cameraViewport.x;
    const cvy = cameraViewport.y;
    const cvw = cameraViewport.width;
    const cvh = cameraViewport.height;

    // Iterate layers in sorted order (GROUND=0 first → UI_WORLD=5 last).
    for (let li = 0; li < LAYER_ORDER.length; li++) {
      const layerArray = this._layers.get(LAYER_ORDER[li]);
      if (layerArray === undefined) continue;

      for (let i = 0; i < layerArray.length; i++) {
        const entity = layerArray[i];

        // Skip inactive entities.
        if (entity.active === false) continue;

        // Frustum culling: only draw if the entity's AABB overlaps the viewport.
        if (entity.aabb) {
          if (!aabbOverlap(
            entity.aabb.x, entity.aabb.y, entity.aabb.width, entity.aabb.height,
            cvx, cvy, cvw, cvh
          )) {
            continue; // Entity is off-screen — skip draw call entirely.
          }
        }

        // Entity is visible → delegate rendering.
        entity.draw(ctx);
      }
    }

    this._isIterating = false;
    this._flushDeferredQueue();
  }

  // ─── Queries ────────────────────────────────────────────────────────────────

  /**
   * Returns an entity by ID, or null if not found.
   *
   * @param {string|number} entityId
   * @returns {GameEntity|null}
   */
  getEntity(entityId) {
    return this._entities.get(entityId) || null;
  }

  /**
   * Returns all entities matching a filter predicate.
   *
   * @param {function(GameEntity): boolean} predicate
   * @returns {GameEntity[]}
   */
  queryEntities(predicate) {
    /** @type {GameEntity[]} */
    const results = [];
    for (const entity of this._entities.values()) {
      if (predicate(entity)) results.push(entity);
    }
    return results;
  }

  /**
   * Returns all entities within a world-space AABB (via SpatialGrid).
   *
   * @param {{ x: number, y: number, width: number, height: number }} region
   * @returns {GameEntity[]}
   */
  getEntitiesInRegion(region) {
    return this._spatialGrid.query(region);
  }

  /**
   * Returns all entities within a circular radius (via SpatialGrid).
   *
   * @param {number} cx
   * @param {number} cy
   * @param {number} radius
   * @returns {GameEntity[]}
   */
  getEntitiesInRadius(cx, cy, radius) {
    return this._spatialGrid.queryRadius(cx, cy, radius);
  }

  // ─── Diagnostics ────────────────────────────────────────────────────────────

  /**
   * Returns entity count metrics for debug overlay.
   *
   * @returns {{
   *   total: number,
   *   active: number,
   *   perLayer: Object<number, number>,
   *   deferredQueueSize: number
   * }}
   */
  getStats() {
    let active = 0;
    for (const entity of this._entities.values()) {
      if (entity.active !== false) active++;
    }

    const perLayer = {};
    for (let i = 0; i < LAYER_ORDER.length; i++) {
      const layer = LAYER_ORDER[i];
      const arr = this._layers.get(layer);
      perLayer[layer] = arr ? arr.length : 0;
    }

    return {
      total: this._entities.size,
      active,
      perLayer,
      deferredQueueSize: this._deferredQueue.length,
    };
  }
}
