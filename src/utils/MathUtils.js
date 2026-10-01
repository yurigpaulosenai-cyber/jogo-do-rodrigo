// ═══════════════════════════════════════════════════════════════════════════════
// MathUtils.js — Pure Mathematical Helper Functions (Zero Allocation)
// ═══════════════════════════════════════════════════════════════════════════════
// All functions are stateless, side-effect-free, and allocate NO objects.
// They operate exclusively on primitive numbers.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Linear Interpolation between two values.
 *
 * Math: result = a + (b - a) × t
 *
 * When t = 0 → returns a (start).
 * When t = 1 → returns b (end).
 * When t ∈ (0, 1) → returns a value between a and b.
 *
 * Note: t is NOT clamped internally. Values outside [0, 1] produce
 * extrapolation, which is sometimes intentional (e.g., overshoot easing).
 * Use clamp(t, 0, 1) externally if strict interpolation is needed.
 *
 * @param {number} a - Start value.
 * @param {number} b - End value (target).
 * @param {number} t - Interpolation factor [0, 1].
 * @returns {number} Interpolated value.
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Clamps a value to the inclusive range [min, max].
 *
 * Equivalent to: Math.max(min, Math.min(max, val))
 * but avoids two function calls by using ternary operators,
 * which V8 compiles to branchless cmov instructions on x86.
 *
 * @param {number} val - Value to clamp.
 * @param {number} min - Lower bound (inclusive).
 * @param {number} max - Upper bound (inclusive).
 * @returns {number} Clamped value.
 */
export function clamp(val, min, max) {
  return val < min ? min : val > max ? max : val;
}

/**
 * Generates a pseudo-random floating-point number in the range [min, max).
 *
 * Uses Math.random() internally (Xorshift128+ in V8), which is fast but
 * NOT cryptographically secure. Sufficient for gameplay randomness.
 *
 * @param {number} min - Lower bound (inclusive).
 * @param {number} max - Upper bound (exclusive).
 * @returns {number} Random float in [min, max).
 */
export function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Generates a pseudo-random integer in the range [min, max] (both inclusive).
 *
 * @param {number} min - Lower bound (inclusive).
 * @param {number} max - Upper bound (inclusive).
 * @returns {number} Random integer.
 */
export function randomInt(min, max) {
  return (Math.random() * (max - min + 1) + min) | 0;
}

/**
 * Computes the squared Euclidean distance between two 2D points.
 *
 * Math: (x2 - x1)² + (y2 - y1)²
 *
 * Use this instead of actual distance whenever possible to avoid
 * the expensive Math.sqrt() call. Compare against radius² instead:
 *   distanceSq(ax, ay, bx, by) <= radius * radius
 *
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number} Squared distance (always ≥ 0).
 */
export function distanceSq(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

/**
 * Normalizes an angle to the range [-π, π].
 *
 * Useful for computing the shortest angular difference between
 * two directions (e.g., for sweep arc tests in MeleeWeapon).
 *
 * @param {number} angle - Angle in radians.
 * @returns {number} Normalized angle in [-π, π].
 */
export function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

/**
 * Checks if two AABBs overlap (broad-phase intersection test).
 *
 * Separating Axis Theorem (simplified for axis-aligned boxes):
 *   NO overlap if any of these are true:
 *     a.right  < b.left
 *     a.left   > b.right
 *     a.bottom < b.top
 *     a.top    > b.bottom
 *
 *   Overlap = NOT(any separation axis exists).
 *
 * @param {number} ax - A's left edge.
 * @param {number} ay - A's top edge.
 * @param {number} aw - A's width.
 * @param {number} ah - A's height.
 * @param {number} bx - B's left edge.
 * @param {number} by - B's top edge.
 * @param {number} bw - B's width.
 * @param {number} bh - B's height.
 * @returns {boolean} True if the two AABBs overlap.
 */
export function aabbOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
