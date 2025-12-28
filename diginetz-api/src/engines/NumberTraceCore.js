// ==========================================================
// Number Trace Core — Structural Numeric Drift Engine
// ==========================================================
// Purpose:
// - Track numeric evolution without history storage
// - Extract drift, momentum, and stability patterns
// - Act as neutral numeric core usable by DigiNetz & TSL
// ==========================================================

export class NumberTraceCore {

  constructor(config = {}) {
    this.alpha = config.alpha ?? 0.85;   // smoothing
    this.beta  = config.beta  ?? 0.15;   // drift sensitivity

    this.state = {
      current: null,
      previous: null,
      trace: 0,
      velocity: 0,
      acceleration: 0
    };
  }

  // -------------------- Ingest --------------------
  ingest(value) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new Error("NumberTraceCore expects numeric input");
    }

    const s = this.state;

    if (s.current === null) {
      s.current = value;
      s.previous = value;
      return this.snapshot();
    }

    const delta = value - s.current;
    const newVelocity = delta;
    const newAcceleration = newVelocity - s.velocity;

    const trace =
      this.alpha * s.trace +
      this.beta  * delta;

    this.state = {
      previous: s.current,
      current: value,
      trace,
      velocity: newVelocity,
      acceleration: newAcceleration
    };

    return this.snapshot();
  }

  // -------------------- Metrics --------------------
  metrics() {
    const { trace, velocity, acceleration } = this.state;

    const magnitude =
      Math.abs(trace) +
      Math.abs(velocity) * 0.6 +
      Math.abs(acceleration) * 0.3;

    const stability =
      Math.exp(-magnitude);

    const direction =
      trace > 0 ? "positive"
      : trace < 0 ? "negative"
      : "neutral";

    return {
      trace,
      velocity,
      acceleration,
      stability,
      direction
    };
  }

  // -------------------- Snapshot --------------------
  snapshot() {
    return {
      timestamp: Date.now(),
      state: { ...this.state },
      metrics: this.metrics()
    };
  }

}
