export class TSL_OBSERVATION_LAYER {
  constructor(options = {}) {

    this.maxLogSize = Number.isFinite(options.maxLogSize)
      ? Number(options.maxLogSize)
      : 100;

    this.values = [];

    this.stats = {
      absences: 0,
      deviations: 0,
      jumps: 0
    };

    this.dclsHistory = [];

    this.eventLog = [];
  }

  reset() {
    this.values = [];
    this.eventLog = [];
    this.dclsHistory = [];

    this.stats = {
      absences: 0,
      deviations: 0,
      jumps: 0
    };
  }

  recordValue(value) {
    this.values.push({
      value,
      timestamp: Date.now()
    });

    if (this.values.length > this.maxLogSize) {
      this.values.shift();
    }
  }

  recordJump(details = {}) {
    this.stats.jumps++;

    this.#pushEvent({
      type: "STRUCTURAL_JUMP",
      details,
      timestamp: Date.now()
    });
  }

  recordAbsence(details = {}) {
    this.stats.absences++;

    this.#pushEvent({
      type: "ABSENCE_EVENT",
      details,
      timestamp: Date.now()
    });
  }

  recordDeviation(details = {}) {
    this.stats.deviations++;

    this.#pushEvent({
      type: "INTERNAL_DEVIATION",
      details,
      timestamp: Date.now()
    });
  }

  recordDCLS(metrics = {}) {

    const entry = {
      trend: metrics.trend || "UNKNOWN",
      trendStrength: metrics.trendStrength || 0,
      avgStep: metrics.avgStep || 0,
      avgAbsStep: metrics.avgAbsStep || 0,
      avgAbsAccel: metrics.avgAbsAccel || 0,
      jumps: metrics.jumps || 0,
      reversals: metrics.reversals || 0,
      deviations: metrics.deviations || 0,
      timestamp: Date.now()
    };

    this.dclsHistory.push(entry);

    if (this.dclsHistory.length > this.maxLogSize) {
      this.dclsHistory.shift();
    }
  }

  #pushEvent(event) {
    this.eventLog.push(event);

    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }
  }

  getStats() {
    return { ...this.stats };
  }

  getValues() {
    return [...this.values];
  }

  getEvents() {
    return [...this.eventLog];
  }

  getDCLSHistory() {
    return [...this.dclsHistory];
  }

  snapshot() {
    return {
      values: this.getValues(),
      stats: this.getStats(),
      events: this.getEvents(),
      dcls: this.getDCLSHistory()
    };
  }
}
