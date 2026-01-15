// TSL_EventDropper.js
// Frame-level primitive
// Determines whether a change qualifies as an evaluable event

export class TSL_EventDropper {
  constructor(config = {}) {
    this.config = {
      minDeltaWeight: config.minDeltaWeight ?? 0.0,
      minStructuralDistance: config.minStructuralDistance ?? 0.0,
      allowEmptyDelta: config.allowEmptyDelta ?? false
    };
  }

  /**
   * @param {Object|null} deltaReport  Output of TSL_D (or null)
   * @returns {Object} { dropped: boolean, reason?: string }
   */
  evaluate(deltaReport) {
    // No delta → no event
    if (!deltaReport) {
      return this.#drop("NO_DELTA");
    }

    // Explicitly empty change set
    if (
      Array.isArray(deltaReport.changes) &&
      deltaReport.changes.length === 0
    ) {
      return this.config.allowEmptyDelta
        ? this.#pass()
        : this.#drop("EMPTY_CHANGESET");
    }

    // Structural distance too small
    if (
      typeof deltaReport.metrics?.structuralDistance === "number" &&
      deltaReport.metrics.structuralDistance <
        this.config.minStructuralDistance
    ) {
      return this.#drop("BELOW_STRUCTURAL_THRESHOLD");
    }

    // Total delta weight too small
    const totalWeight = deltaReport.changes?.reduce(
      (s, c) => s + (c.weight ?? 0),
      0
    );

    if (
      typeof totalWeight === "number" &&
      totalWeight < this.config.minDeltaWeight
    ) {
      return this.#drop("INSUFFICIENT_DELTA_WEIGHT");
    }

    // Otherwise → valid event
    return this.#pass();
  }

  /* ================= INTERNAL ================= */

  #drop(reason) {
    return {
      dropped: true,
      reason
    };
  }

  #pass() {
    return {
      dropped: false
    };
  }
}
