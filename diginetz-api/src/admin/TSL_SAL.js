// TSL_SAL.js
// Structural Access Layer
// Decision-only layer (ALLOW / DENY / ALERT)

export class TSL_SAL {
  constructor(config = {}) {
    this.thresholds = {
      density: config.density ?? 1e-6,
      appearance: config.appearance ?? 0,
      local: config.local ?? 0,
      scale: config.scale ?? 0
    };

    this.onAlert = config.onAlert;
  }

  decide(structuralResult, executionReport, stsReport) {
    // 1. Absent Execution has absolute priority
    if (executionReport && executionReport.securityFlag === "ALERT") {
      this._alert("ABSENT_EXECUTION", executionReport);
      return this._deny("ABSENT_EXECUTION");
    }

    // 2. Structural mismatch (NDR-D)
    if (structuralResult && structuralResult.delta) {
      const d = structuralResult.delta;
      const violated =
        Math.abs(d.densityDelta) > this.thresholds.density ||
        Math.abs(d.appearanceDelta) > this.thresholds.appearance ||
        Math.abs(d.localShift) > this.thresholds.local ||
        Math.abs(d.scaleShift) > this.thresholds.scale;

      if (violated) {
        return this._deny("STRUCTURAL_MISMATCH");
      }
    }

    // 3. Structural Trace System (STS) misalignment
    if (stsReport) {
      const misaligned =
        !stsReport.short.aligned ||
        !stsReport.mid.aligned ||
        !stsReport.long.aligned;

      if (misaligned) {
        return this._alert("STRUCTURAL_DRIFT");
      }
    }

    // 4. Everything structurally consistent
    return this._allow();
  }

  _allow() {
    return {
      decision: "ALLOW",
      timestamp: Date.now()
    };
  }

  _deny(reason) {
    return {
      decision: "DENY",
      reason,
      timestamp: Date.now()
    };
  }

  _alert(reason, context) {
    const payload = {
      decision: "ALERT",
      reason,
      timestamp: Date.now(),
      context
    };
    if (this.onAlert) this.onAlert(payload);
    return payload;
  }
}
