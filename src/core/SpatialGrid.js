// ═══════════════════════════════════════════════════════════════════════════════
// SpatialGrid.js — Spatial Hash Grid for Broad-Phase Collision Detection
// ═══════════════════════════════════════════════════════════════════════════════
// Design Pattern: Spatial Partitioning (Uniform Grid / Hash Grid)
//
// Rationale:
//   Brute-force AABB collision for N entities is O(N²). With 500+ enemies and
//   200+ projectiles in a horde wave, that's 490k+ pair checks per frame.
//   A Spatial Hash Grid divides the world into cells of fixed size and only
//   checks pairs within the same (or neighboring) cells.
//
//   Expected complexity: O(N) insert + O(K) query per entity, where K is the
//   average number of entities in nearby cells (typically 5–20).
//
// Coordinate Mapping:
//   cellX = Math.floor(worldX / cellSize)
//   cellY = Math.floor(worldY / cellSize)
//   hashKey = `${cellX},${cellY}` (or a numeric hash: cellX * PRIME + cellY)
//
// Cell Size Heuristic:
//   cellSize should be ≈ 2× the diameter of the most common entity.
//   Too small → entities span many cells (overhead).
//   Too large → cells contain too many entities (defeats the purpose).
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} AABB
 * @property {number} x      - Left edge (world units).
 * @property {number} y      - Top edge (world units).
 * @property {number} width  - Horizontal extent.
 * @property {number} height - Vertical extent.
 */

/**
 * @typedef {Object} SpatialEntity
 * @property {string|number} id   - Unique identifier for deduplication.
 * @property {AABB}          aabb - Axis-Aligned Bounding Box in world coords.
 */

/**
 * Uniform-grid spatial hash for O(1) cell lookup and broad-phase
 * collision detection of AABB entities in an open world.
 *
 * The grid is unbounded: cells are created lazily via a Map (hash table),
 * so there's no fixed world-size limit. Negative coordinates work natively.
 */
export class SpatialGrid {

  /**
   * @param {number} cellSize - Edge length of each square cell (world units).
   *        Recommended: 2× the largest common entity diameter.
   *        For a game with 32px tile sprites, try cellSize = 64 or 128.
   */
  constructor(cellSize = 128) {
    /** @type {number} */
    this._cellSize = cellSize;

    /** @type {number} Precomputed reciprocal for fast division. */
    this._inverseCellSize = 1 / cellSize;

    /**
     * Hash table mapping cell keys to Sets of entity references.
     * Using Map<string, Set<SpatialEntity>> for O(1) insert/delete per cell.
     * @type {Map<string, Set<SpatialEntity>>}
     */
    this._cells = new Map();

    /**
     * Reverse lookup: entity.id → array of cell keys the entity occupies.
     * Needed for efficient removal without scanning all cells.
     * @type {Map<string|number, string[]>}
     */
    this._entityToCells = new Map();

    /**
     * Reusable array for _getCellKeysForAABB to avoid allocation per call.
     * Cleared and re-populated on each invocation.
     * Max expected size: 4 keys (2×2 cell span for most entities).
     * @type {string[]}
     * @private
     */
    this._keysBuffer = [];
  }

  // ─── Core Hashing ──────────────────────────────────────────────────────────

  /**
   * Converts world coordinates to a cell key string.
   *
   * Math:
   *   cellX = floor(worldX / cellSize)  →  floor(worldX * inverseCellSize)
   *   cellY = floor(worldY / cellSize)
   *   key   = `${cellX}:${cellY}`
   *
   * Using multiplication by the precomputed inverse is ~15% faster than
   * division on V8 (measurable at >10k calls/frame).
   *
   * @param {number} worldX
   * @param {number} worldY
   * @returns {string} Cell hash key.
   * @private
   */
  _hashKey(worldX, worldY) {
    return `${Math.floor(worldX * this._inverseCellSize)}:${Math.floor(worldY * this._inverseCellSize)}`;
  }

  /**
   * Computes all cell keys that an AABB overlaps.
   *
   * An AABB at (x, y, w, h) can span multiple cells. We iterate from
   * the cell containing (x, y) to the cell containing (x+w, y+h):
   *
   *   startCellX = floor(x * inv)
   *   endCellX   = floor((x + width) * inv)
   *   (same for Y)
   *
   * For a typical 32×32 sprite in a 128px grid, this yields 1 cell.
   * A large boss (256×256) in a 128px grid yields 4 cells (2×2).
   *
   * @param {AABB} aabb
   * @returns {string[]} Array of cell key strings (reusable internal buffer).
   * @private
   */
  _getCellKeysForAABB(aabb) {
    const inv = this._inverseCellSize;
    const startCellX = Math.floor(aabb.x * inv);
    const startCellY = Math.floor(aabb.y * inv);
    const endCellX   = Math.floor((aabb.x + aabb.width)  * inv);
    const endCellY   = Math.floor((aabb.y + aabb.height) * inv);

    // Reuse the internal buffer to avoid allocating a new array every call.
    // This is safe because the caller processes the keys before the next call.
    this._keysBuffer.length = 0;

    for (let cx = startCellX; cx <= endCellX; cx++) {
      for (let cy = startCellY; cy <= endCellY; cy++) {
        this._keysBuffer.push(`${cx}:${cy}`);
      }
    }

    return this._keysBuffer;
  }

  // ─── Insert / Remove / Update ──────────────────────────────────────────────

  /**
   * Inserts an entity into all cells its AABB overlaps.
   *
   * Steps:
   *   1. Compute cell keys via _getCellKeysForAABB(entity.aabb).
   *   2. For each key, lazily create the cell Set if absent.
   *   3. Add entity to each cell Set.
   *   4. Store the keys in _entityToCells for reverse lookup.
   *
   * @param {SpatialEntity} entity
   */
  insert(entity) {
    const keys = this._getCellKeysForAABB(entity.aabb);

    // We must copy the keys because _keysBuffer is reused.
    // This allocation happens only on insert (not per-frame for static entities).
    const storedKeys = new Array(keys.length);

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      storedKeys[i] = key;

      let cell = this._cells.get(key);
      if (cell === undefined) {
        cell = new Set();
        this._cells.set(key, cell);
      }
      cell.add(entity);
    }

    this._entityToCells.set(entity.id, storedKeys);
  }

  /**
   * Removes an entity from all cells it currently occupies.
   *
   * Uses _entityToCells reverse map for O(K) removal (K = number of
   * cells the entity spans, typically 1–4).
   *
   * After removal, if a cell Set becomes empty, delete the cell key
   * from _cells to prevent memory leaks in long play sessions.
   *
   * @param {SpatialEntity} entity
   */
  remove(entity) {
    const keys = this._entityToCells.get(entity.id);
    if (keys === undefined) return;

    for (let i = 0; i < keys.length; i++) {
      const cell = this._cells.get(keys[i]);
      if (cell !== undefined) {
        cell.delete(entity);
        // GC empty cells to prevent unbounded Map growth in long sessions.
        if (cell.size === 0) {
          this._cells.delete(keys[i]);
        }
      }
    }

    this._entityToCells.delete(entity.id);
  }

  /**
   * Updates an entity's position in the grid.
   *
   * Optimization: Only re-insert if the entity's cell keys have changed.
   * Compare old keys (from _entityToCells) with new keys (from current AABB).
   * If identical → no-op. Otherwise → remove + insert.
   *
   * This avoids churn for stationary entities (e.g., turrets, factories).
   *
   * @param {SpatialEntity} entity
   */
  update(entity) {
    const oldKeys = this._entityToCells.get(entity.id);

    // Entity not yet in grid → just insert.
    if (oldKeys === undefined) {
      this.insert(entity);
      return;
    }

    // Compute new keys from the current AABB.
    const newKeys = this._getCellKeysForAABB(entity.aabb);

    // Fast comparison: if length differs, keys definitely changed.
    let changed = oldKeys.length !== newKeys.length;

    // If same length, compare each key string.
    if (!changed) {
      for (let i = 0; i < oldKeys.length; i++) {
        if (oldKeys[i] !== newKeys[i]) {
          changed = true;
          break;
        }
      }
    }

    // Only pay the remove+insert cost if the entity crossed a cell boundary.
    if (changed) {
      this.remove(entity);
      this.insert(entity);
    }
  }

  // ─── Queries ────────────────────────────────────────────────────────────────

  /**
   * Returns all entities in cells overlapping the given query AABB.
   *
   * Used for:
   *   - Broad-phase collision: query with an entity's inflated AABB.
   *   - Area-of-effect damage: query with the explosion radius AABB.
   *   - Camera culling: query with the viewport rect to get visible entities.
   *
   * Deduplication: Entities spanning multiple cells would appear multiple
   * times. Use a Set (keyed by entity.id) to deduplicate results.
   *
   * @param {AABB} queryAABB - Region to query.
   * @returns {SpatialEntity[]} Unique entities within the query region.
   */
  query(queryAABB) {
    const inv = this._inverseCellSize;
    const startCellX = Math.floor(queryAABB.x * inv);
    const startCellY = Math.floor(queryAABB.y * inv);
    const endCellX   = Math.floor((queryAABB.x + queryAABB.width)  * inv);
    const endCellY   = Math.floor((queryAABB.y + queryAABB.height) * inv);

    /** @type {SpatialEntity[]} */
    const results = [];

    // Use a Set of entity IDs for deduplication.
    // An entity spanning 2×2 cells would otherwise appear 4 times.
    /** @type {Set<string|number>} */
    const seen = new Set();

    for (let cx = startCellX; cx <= endCellX; cx++) {
      for (let cy = startCellY; cy <= endCellY; cy++) {
        const cell = this._cells.get(`${cx}:${cy}`);
        if (cell === undefined) continue;

        for (const entity of cell) {
          if (!seen.has(entity.id)) {
            seen.add(entity.id);
            results.push(entity);
          }
        }
      }
    }

    return results;
  }

  /**
   * Returns all entities within a circular radius from a point.
   *
   * Converts the circle to an enclosing AABB for the grid query, then
   * applies a secondary distance² filter:
   *   dx = entity.aabb.x + w/2 - cx
   *   dy = entity.aabb.y + h/2 - cy
   *   include if (dx² + dy²) ≤ radius²
   *
   * Avoids sqrt by comparing squared distances.
   *
   * @param {number} cx - Center X (world).
   * @param {number} cy - Center Y (world).
   * @param {number} radius - Search radius (world units).
   * @returns {SpatialEntity[]} Entities whose center falls within the radius.
   */
  queryRadius(cx, cy, radius) {
    // Build enclosing AABB for the circle.
    const queryAABB = {
      x: cx - radius,
      y: cy - radius,
      width: radius * 2,
      height: radius * 2,
    };

    const candidates = this.query(queryAABB);
    const radiusSq = radius * radius;

    /** @type {SpatialEntity[]} */
    const results = [];

    for (let i = 0; i < candidates.length; i++) {
      const e = candidates[i];
      // Compute entity center.
      const ex = e.aabb.x + e.aabb.width  * 0.5;
      const ey = e.aabb.y + e.aabb.height * 0.5;
      // Squared distance check (avoids sqrt).
      const dx = ex - cx;
      const dy = ey - cy;
      if (dx * dx + dy * dy <= radiusSq) {
        results.push(e);
      }
    }

    return results;
  }

  // ─── Maintenance ────────────────────────────────────────────────────────────

  /**
   * Clears ALL cells and reverse-lookup maps.
   * Called on world regeneration or scene transitions.
   */
  clear() {
    this._cells.clear();
    this._entityToCells.clear();
  }

  /**
   * Returns diagnostic metrics for debug overlays.
   * @returns {{ totalCells: number, totalEntities: number, avgPerCell: number }}
   */
  getStats() {
    const totalCells = this._cells.size;
    const totalEntities = this._entityToCells.size;
    const avgPerCell = totalCells > 0
      ? (totalEntities / totalCells)
      : 0;

    return { totalCells, totalEntities, avgPerCell };
  }
}
