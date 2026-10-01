// ═══════════════════════════════════════════════════════════════════════════════
// FactoryTickEngine.js — Decoupled Tick Engine for Automation Machines
// ═══════════════════════════════════════════════════════════════════════════════
// Design Pattern: Observer + Command Queue + Fixed-Rate Tick
//
// Rationale:
//   Automation machines (miners, smelters, assemblers, conveyors) must process
//   recipes at a fixed, predictable rate independent of the visual framerate.
//   Running machine logic at 60fps wastes CPU; most recipes take 2–5 seconds.
//
//   Solution: A dedicated setInterval-based tick engine at ~4Hz (250ms/tick).
//   Machine logic runs here, decoupled from the render loop. This saves ~90%
//   of per-machine CPU usage vs. running at 60fps.
//
// Tick Budget:
//   At 4Hz with 250ms between ticks, and targeting ≤10ms per tick to avoid
//   blocking the main thread, we can process up to ~500 simple machines
//   per tick (assuming ~20μs per machine operation).
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} MachineDescriptor
 * @property {string} id          - Unique machine instance ID (e.g., "smelter_042").
 * @property {string} type        - Machine type key (e.g., "smelter", "assembler").
 * @property {Object} inputSlots  - Map of item IDs → quantities in input buffer.
 * @property {Object} outputSlots - Map of item IDs → quantities in output buffer.
 * @property {Object|null} activeRecipe - Currently loaded recipe, or null if idle.
 * @property {number} progress    - Ticks elapsed on current recipe [0, recipe.tickCost].
 * @property {boolean} isActive   - Whether the machine is powered and operational.
 */

/**
 * @typedef {Object} Recipe
 * @property {string} id         - Unique recipe ID.
 * @property {Object} inputs     - Required items: { itemId: quantity, ... }.
 * @property {Object} outputs    - Produced items: { itemId: quantity, ... }.
 * @property {number} tickCost   - Number of ticks to complete (at 4Hz, 4 ticks = 1 sec).
 * @property {string} machineType - Which machine type can execute this recipe.
 */

/**
 * Fixed-rate tick engine that drives all automation/factory gameplay
 * systems independently of the rendering framerate.
 *
 * The engine maintains a registry of machines and processes them
 * sequentially each tick, checking recipe completion, consuming
 * inputs, and producing outputs.
 */
export class FactoryTickEngine {

  /**
   * @param {number} tickRateHz - Ticks per second. Default 4Hz (250ms interval).
   *        Higher rates = more responsive machines but more CPU usage.
   *        Lower rates = less CPU but sluggish machine feel.
   *        4Hz is the sweet spot for Factorio-style automation.
   */
  constructor(tickRateHz = 4) {
    /** @type {number} Milliseconds between ticks. */
    this._tickIntervalMs = 1000 / tickRateHz;

    /** @type {number} Current tick count since engine start (monotonic). */
    this._tickCount = 0;

    /** @type {number|null} Handle returned by setInterval, for cleanup. */
    this._intervalHandle = null;

    /** @type {boolean} */
    this._isRunning = false;

    /**
     * Registry of all active machines, keyed by machine.id.
     * Using Map for O(1) add/remove/lookup.
     * @type {Map<string, MachineDescriptor>}
     */
    this._machines = new Map();

    /**
     * Master recipe database, keyed by recipe.id.
     * Loaded once at init from game data definitions.
     * @type {Map<string, Recipe>}
     */
    this._recipeDatabase = new Map();

    /**
     * Event listeners for machine state changes (e.g., recipe completed,
     * output buffer full, machine stalled).
     * Pattern: Observer — UI and sound systems subscribe without coupling.
     * @type {Map<string, Function[]>}
     */
    this._eventListeners = new Map();
  }

  // ─── Engine Lifecycle ───────────────────────────────────────────────────────

  /**
   * Starts the tick engine via setInterval.
   *
   * Guard: If already running, this is a no-op.
   * The interval callback calls _processTick() each cycle.
   */
  start() {
    // TODO: Guard _isRunning. Set up setInterval → _processTick().
  }

  /**
   * Stops the tick engine and clears the interval.
   * Machines retain their state (progress, buffers) for later resume.
   */
  stop() {
    // TODO: clearInterval, set _isRunning = false.
  }

  /**
   * Core tick processor. Called every _tickIntervalMs milliseconds.
   *
   * For each registered machine:
   *   1. Skip if machine.isActive === false (unpowered/disabled).
   *   2. If no activeRecipe → attempt to auto-select a valid recipe
   *      from the recipe database based on inputSlots contents.
   *   3. If activeRecipe exists:
   *      a. Check if inputSlots satisfy recipe.inputs (consumption guard).
   *      b. Increment machine.progress.
   *      c. If progress >= recipe.tickCost:
   *         - Consume inputs from inputSlots.
   *         - Add outputs to outputSlots.
   *         - Reset progress to 0, clear activeRecipe.
   *         - Emit 'recipe_complete' event.
   *
   * Performance: Track tick duration via performance.now() for budgeting.
   *
   * @private
   */
  _processTick() {
    // TODO: Increment _tickCount. Iterate _machines.values().
    //       Apply the state machine logic described above.
  }

  // ─── Machine Registry ──────────────────────────────────────────────────────

  /**
   * Registers a new machine instance into the tick engine.
   *
   * @param {MachineDescriptor} machine - Machine to register.
   * @throws {Error} If machine.id is already registered.
   */
  registerMachine(machine) {
    // TODO: Guard duplicate ID. Add to _machines map.
  }

  /**
   * Removes a machine from the tick engine (e.g., player demolished it).
   *
   * @param {string} machineId
   */
  unregisterMachine(machineId) {
    // TODO: Delete from _machines.
  }

  /**
   * Returns a machine descriptor by ID, or null if not found.
   *
   * @param {string} machineId
   * @returns {MachineDescriptor|null}
   */
  getMachine(machineId) {
    // TODO: Lookup in _machines.
  }

  // ─── Recipe Database ────────────────────────────────────────────────────────

  /**
   * Loads recipes into the engine's database.
   * Typically called once during game init with all recipe definitions.
   *
   * @param {Recipe[]} recipes - Array of recipe definitions.
   */
  loadRecipes(recipes) {
    // TODO: Iterate recipes, store each in _recipeDatabase by id.
  }

  /**
   * Attempts to find a valid recipe for a machine given its current inputs.
   *
   * Matching algorithm:
   *   For each recipe where recipe.machineType === machine.type:
   *     Check if ALL recipe.inputs are satisfied by machine.inputSlots
   *     (i.e., inputSlots[itemId] >= recipe.inputs[itemId] for all items).
   *   Return the first matching recipe, or null.
   *
   * @param {MachineDescriptor} machine
   * @returns {Recipe|null}
   * @private
   */
  _findValidRecipe(machine) {
    // TODO: Filter recipes by machineType, check input satisfaction.
  }

  // ─── Event System (Observer) ────────────────────────────────────────────────

  /**
   * Subscribes a callback to a named event.
   *
   * Known events:
   *   'recipe_complete'  → { machineId, recipeId, outputs }
   *   'machine_stalled'  → { machineId, reason }
   *   'output_full'      → { machineId }
   *   'tick_budget_exceeded' → { tickIndex, durationMs }
   *
   * @param {string} eventName
   * @param {Function} callback
   */
  on(eventName, callback) {
    // TODO: Add callback to _eventListeners[eventName] array.
  }

  /**
   * Emits an event to all subscribed listeners.
   *
   * @param {string} eventName
   * @param {Object} payload
   * @private
   */
  _emit(eventName, payload) {
    // TODO: Iterate _eventListeners[eventName], invoke each with payload.
  }

  // ─── Diagnostics ────────────────────────────────────────────────────────────

  /**
   * Returns engine performance and state metrics.
   *
   * @returns {{
   *   tickCount: number,
   *   machineCount: number,
   *   isRunning: boolean,
   *   tickRateHz: number,
   *   avgTickDurationMs: number
   * }}
   */
  getStats() {
    // TODO: Aggregate and return engine metrics.
  }
}
