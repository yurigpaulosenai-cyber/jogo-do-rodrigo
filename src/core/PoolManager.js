// ═══════════════════════════════════════════════════════════════════════════════
// PoolManager.js — Object Pool / Flyweight Recycling System
// ═══════════════════════════════════════════════════════════════════════════════
// Design Pattern: Object Pool + Factory Method
//
// Rationale:
//   In a roguelike with horde mechanics, hundreds of projectiles, enemies, and
//   particles are spawned/destroyed per second. Allocating via `new` on every
//   spawn triggers frequent GC pauses (frame drops). The Pool pre-allocates N
//   instances, keeps a free-list (stack), and recycles objects via acquire/release
//   instead of create/destroy.
//
// Memory Model:
//   ┌─────────────────────────────────────┐
//   │  _pool: Array<T>   (all instances)  │
//   │  _freeStack: Array<T> (available)   │
//   │  _activeSet: Set<T>  (in-use)       │
//   └─────────────────────────────────────┘
//   acquire() → pops from _freeStack, adds to _activeSet
//   release() → removes from _activeSet, pushes back to _freeStack
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @template T
 * Generic object pool that manages reusable instances of any class.
 *
 * The pool eliminates runtime allocation overhead by maintaining a
 * pre-warmed stack of dormant objects. When an entity is "destroyed"
 * in-game, it is merely deactivated and returned to the free-list.
 *
 * Complexity:
 *   acquire(): O(1) — stack pop
 *   release(): O(1) — stack push + set delete
 *   warmUp():  O(n) — one-time pre-allocation cost
 */
export class ObjectPool {

  /**
   * @param {new () => T} ClassConstructor - The constructor/class of pooled objects.
   *        Must support a `reset()` method for state re-initialization.
   * @param {number} initialCapacity - Number of instances to pre-allocate.
   *        Rule of thumb: set to the expected peak concurrency × 1.5.
   * @param {number} growthFactor - Multiplier when the pool is exhausted.
   *        E.g., 2.0 doubles the pool. Use 1.5 for memory-constrained targets.
   */
  constructor(ClassConstructor, initialCapacity = 64, growthFactor = 2.0) {
    /** @type {new () => T} */
    this._ClassConstructor = ClassConstructor;

    /** @type {number} */
    this._growthFactor = growthFactor;

    /**
     * Master array holding every instance ever created by this pool.
     * @type {T[]}
     */
    this._pool = [];

    /**
     * Stack (LIFO) of available instances ready for acquisition.
     * Using a stack ensures cache-locality: recently-released objects
     * are still warm in L1/L2 cache when re-acquired.
     * @type {T[]}
     */
    this._freeStack = [];

    /**
     * Set of all currently active (in-use) instances.
     * Using a Set gives O(1) has/delete and prevents double-release bugs.
     * @type {Set<T>}
     */
    this._activeSet = new Set();

    /** @type {number} Total instances ever created (for diagnostics). */
    this._totalAllocated = 0;

    this._warmUp(initialCapacity);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Pre-allocates `count` instances and pushes them onto the free-stack.
   * Called once in the constructor and again if the pool is exhausted.
   *
   * Math: Total memory ≈ count × sizeof(T). For a Projectile with
   * ~10 numeric fields (x, y, vx, vy, damage, …), each instance is
   * roughly 200–400 bytes, so 256 projectiles ≈ 50–100 KB.
   *
   * @param {number} count - Number of new instances to allocate.
   * @private
   */
  _warmUp(count) {
    for (let i = 0; i < count; i++) {
      const instance = new this._ClassConstructor();
      instance.active = false;
      this._pool.push(instance);
      this._freeStack.push(instance);
    }
    this._totalAllocated += count;
  }

  /**
   * Acquires a dormant instance from the pool.
   *
   * If the free-stack is empty, the pool grows by `_growthFactor`.
   * After popping, the instance is added to _activeSet and its
   * `reset()` method is called to guarantee a clean initial state.
   *
   * @param {Object} [initProps] - Optional properties to pass to reset().
   * @returns {T} A ready-to-use instance with state freshly reset.
   */
  acquire(initProps) {
    // If exhausted, grow the pool.
    if (this._freeStack.length === 0) {
      // Grow by at least 1 to avoid infinite loop when pool is empty.
      const growCount = Math.max(1, Math.floor(this._pool.length * (this._growthFactor - 1)));
      this._warmUp(growCount);
    }

    // Pop from the free-stack (LIFO — cache-warm instances first).
    const instance = this._freeStack.pop();

    // Mark as active.
    instance.active = true;
    this._activeSet.add(instance);

    // Reset state via the entity's own reset method.
    if (typeof instance.reset === 'function') {
      instance.reset(initProps);
    }

    return instance;
  }

  /**
   * Returns an instance back to the pool for future reuse.
   *
   * Guard: If `instance` is not in _activeSet, this is a double-release
   * and is silently ignored to prevent corruption.
   *
   * @param {T} instance - The instance to deactivate and recycle.
   */
  release(instance) {
    // Guard against double-release.
    if (!this._activeSet.has(instance)) return;

    // Deactivate and recycle.
    instance.active = false;
    this._activeSet.delete(instance);
    this._freeStack.push(instance);
  }

  /**
   * Releases ALL active instances back into the pool.
   * Used on scene transitions, wave resets, or full world clear.
   */
  releaseAll() {
    for (const instance of this._activeSet) {
      instance.active = false;
      this._freeStack.push(instance);
    }
    this._activeSet.clear();
  }

  /**
   * Provides iteration over all currently active instances.
   * Used by main.js to iterate projectiles for collision checks
   * WITHOUT creating a new array each frame.
   *
   * @returns {Set<T>} The active set (read-only iteration).
   */
  getActiveSet() {
    return this._activeSet;
  }

  // ─── Diagnostics ────────────────────────────────────────────────────────────

  /**
   * Returns a snapshot of pool utilization metrics.
   * Useful for real-time debug overlays and profiling.
   *
   * @returns {{ total: number, active: number, free: number, utilization: number }}
   *   - utilization is active / total, clamped [0, 1].
   */
  getStats() {
    const total = this._pool.length;
    const active = this._activeSet.size;
    const free = this._freeStack.length;
    return {
      total,
      active,
      free,
      utilization: total > 0 ? active / total : 0,
    };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// PoolManager — Registry of named ObjectPools
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Central registry that maps string keys (e.g., "projectile", "enemy_grunt",
 * "particle_blood") to their respective ObjectPool instances.
 *
 * This avoids scattering pool references across subsystems and provides a
 * single point of configuration for initial capacities.
 *
 * Usage:
 *   poolManager.register('projectile', Projectile, 256);
 *   const bullet = poolManager.acquire('projectile');
 *   poolManager.release('projectile', bullet);
 */
export class PoolManager {

  constructor() {
    /**
     * Map of pool-name → ObjectPool instance.
     * @type {Map<string, ObjectPool>}
     */
    this._pools = new Map();
  }

  /**
   * Registers a new pool under the given key.
   *
   * @param {string} key - Unique identifier (e.g., 'projectile').
   * @param {new () => *} ClassConstructor - Class to pool.
   * @param {number} [initialCapacity=64] - Pre-allocation count.
   * @param {number} [growthFactor=2.0] - Expansion multiplier on exhaustion.
   * @throws {Error} If a pool with `key` already exists.
   */
  register(key, ClassConstructor, initialCapacity = 64, growthFactor = 2.0) {
    if (this._pools.has(key)) {
      throw new Error(`PoolManager: Pool '${key}' is already registered.`);
    }
    this._pools.set(key, new ObjectPool(ClassConstructor, initialCapacity, growthFactor));
  }

  /**
   * Acquires an instance from the pool identified by `key`.
   *
   * @param {string} key
   * @param {Object} [initProps] - Optional props forwarded to reset().
   * @returns {*} A reset, ready-to-use instance.
   * @throws {Error} If no pool is registered under `key`.
   */
  acquire(key, initProps) {
    const pool = this._pools.get(key);
    if (!pool) throw new Error(`PoolManager: No pool registered for '${key}'.`);
    return pool.acquire(initProps);
  }

  /**
   * Returns an instance to the pool identified by `key`.
   *
   * @param {string} key
   * @param {*} instance
   */
  release(key, instance) {
    const pool = this._pools.get(key);
    if (!pool) return;
    pool.release(instance);
  }

  /**
   * Returns the raw ObjectPool for direct iteration (e.g., getActiveSet()).
   *
   * @param {string} key
   * @returns {ObjectPool|undefined}
   */
  getPool(key) {
    return this._pools.get(key);
  }

  /**
   * Returns aggregate stats for all registered pools.
   * @returns {Object<string, { total: number, active: number, free: number }>}
   */
  getAllStats() {
    const result = {};
    for (const [key, pool] of this._pools) {
      result[key] = pool.getStats();
    }
    return result;
  }
}
