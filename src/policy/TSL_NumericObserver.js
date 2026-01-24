// diginetz-api/src/policy/TSL_NumericObserver.js
// ----------------------------------------------------
// TSL Numeric Observer
// ----------------------------------------------------
// Role:
// - Observes numeric pressure ONLY
// - No decisions
// - No thresholds for allow/deny
// - No memory (learning is handled by DCLS)
// - Feeds numeric signals to policy layers
// ----------------------------------------------------
// Principle:
// Numbers observe → Structure decides
// ----------------------------------------------------

export class TSL_NumericObserver {

  constructor(config = {}) {
    this.config = {
      maxDelta: config.maxDelta ?? 1,
      maxAcceleration: config.maxAcceleration ?? 1
    };
  }

  /* ================= OBSERVE ================= */

  observe({ delta, ae }) {
    if (!delta || typeof delta !== "object") {
      return {
        state: "NO_DATA",
        magnitude: 0,
        signals: []
      };
    }

    const signals = [];

    /* ---------- AE SIGNAL ---------- */
    if (ae?.securityFlag === "ALERT") {
      signals.push({
        source: "ae",
        type: "SECURITY_ALERT"
      });
    }

    /* ---------- MAGNITUDE (NO JUDGMENT) ---------- */
    const magnitude =
      Math.abs(delta.densityDelta ?? 0) +
      Math.abs(delta.appearanceDelta ?? 0) +
      Math.abs(delta.localShift ?? 0) +
      Math.abs(delta.scaleShift ?? 0);

    let state = "NORMAL";

    if (magnitude > this.config.maxDelta) {
      state = "HIGH_PRESSURE";
    }

    return {
      state,
      magnitude,
      signals
    };
  }

  /* ================= CONSTRAINTS ================= */

  constraints() {
    return { ...this.config };
  }
}
