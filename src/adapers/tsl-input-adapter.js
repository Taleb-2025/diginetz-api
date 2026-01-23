/* ============================================================
 * TSL Input Adapter
 * Enforces: Discrete → Δ → Direction → Structure
 * JavaScript Version
 * ============================================================
 */

/* ---------- Direction Constants ---------- */
export const Direction = {
  UP: "+",
  DOWN: "-",
  SAME: "="
};

/* ---------- Default TSL Adapter ---------- */
export class DefaultTSLAdapter {

  /**
   * Convert raw input into discrete numeric states
   * This is the LAST place where numbers are allowed
   */
  toDiscrete(input) {
    if (!Array.isArray(input)) {
      throw new Error("TSL Adapter: input must be an array");
    }

    for (const v of input) {
      if (typeof v !== "number" || Number.isNaN(v)) {
        throw new Error("TSL Adapter: all discrete values must be numbers");
      }
    }

    return input;
  }

  /**
   * Extract numerical deltas between discrete states
   * Numbers here are transitional only
   */
  toDelta(discrete) {
    if (discrete.length < 2) return [];

    const deltas = [];
    for (let i = 1; i < discrete.length; i++) {
      deltas.push(discrete[i] - discrete[i - 1]);
    }
    return deltas;
  }

  /**
   * Collapse deltas into pure directional form
   * After this step, numbers must not exist
   */
  toDirection(delta) {
    return delta.map(d => {
      if (d > 0) return Direction.UP;
      if (d < 0) return Direction.DOWN;
      return Direction.SAME;
    });
  }
}

/* ---------- Utility Pipeline ---------- */
export function adaptToTSL(adapter, input) {
  const discrete = adapter.toDiscrete(input);
  const delta = adapter.toDelta(discrete);
  return adapter.toDirection(delta);
}
