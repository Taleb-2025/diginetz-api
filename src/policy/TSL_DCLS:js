export class TSL_DCLS {
  constructor(config = {}) {
    this.config = {
      tightenOnCritical: config.tightenOnCritical ?? true,
      tightenFactor: config.tightenFactor ?? 0.9,

      lockOnRepeatedAnomaly: config.lockOnRepeatedAnomaly ?? true,
      anomalyThreshold: config.anomalyThreshold ?? 2,

      forbidTypeChangeOnAlert: config.forbidTypeChangeOnAlert ?? true
    };

    this._anomalyCount = 0;
  }

  adapt(report, constraints) {
    let mutated = false;
    const next = { ...constraints };

    if (
      this.config.tightenOnCritical &&
      report.state === "CRITICAL"
    ) {
      next.maxDelta *= this.config.tightenFactor;
      next.maxAcceleration *= this.config.tightenFactor;
      mutated = true;
    }

    if (report.state === "ANOMALOUS") {
      this._anomalyCount++;
    } else {
      this._anomalyCount = 0;
    }

    if (
      this.config.lockOnRepeatedAnomaly &&
      this._anomalyCount >= this.config.anomalyThreshold
    ) {
      next.maxDelta *= this.config.tightenFactor;
      mutated = true;
    }

    if (
      this.config.forbidTypeChangeOnAlert &&
      report.signals?.some(s => s.source === "ae")
    ) {
      const set = new Set(next.forbiddenChangeTypes ?? []);
      set.add("TYPE_CHANGE");
      next.forbiddenChangeTypes = Array.from(set);
      mutated = true;
    }

    return mutated ? this.#sanitize(next) : null;
  }

  #sanitize(c) {
    return {
      ...c,
      maxDelta: Math.max(c.maxDelta ?? 0, 1e-6),
      maxAcceleration: Math.max(c.maxAcceleration ?? 0, 1e-6)
    };
  }
}
