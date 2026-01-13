export function TSL_Decision({
  deltaContainment,
  deltaProfile,
  stsReport,
  aeReport,
  history = []
}) {
  const signals = [];

  if (stsReport?.short && !stsReport.short.aligned) {
    signals.push({ source: "sts", scope: "short" });
  }

  if (stsReport?.mid && !stsReport.mid.aligned) {
    signals.push({ source: "sts", scope: "mid" });
  }

  if (stsReport?.long && !stsReport.long.aligned) {
    signals.push({ source: "sts", scope: "long" });
  }

  if (aeReport?.securityFlag === "ALERT") {
    signals.push({ source: "ae", reason: aeReport.reason });
  }

  const instantMagnitude =
    Math.abs(deltaProfile?.densityDelta ?? 0) +
    Math.abs(deltaProfile?.appearanceDelta ?? 0) +
    Math.abs(deltaProfile?.localShift ?? 0) +
    Math.abs(deltaProfile?.scaleShift ?? 0);

  const window = history.slice(-5);
  const cumulativeMagnitude =
    window.reduce((s, h) => s + (h.magnitude ?? 0), 0) +
    instantMagnitude;

  const anomalyPressure =
    window.filter(h => h.state === "ANOMALOUS").length;

  const policy = DecisionPolicy({
    deltaContainment,
    instantMagnitude,
    cumulativeMagnitude,
    anomalyPressure,
    signals
  });

  return {
    decision: policy.decision,
    state: policy.state,
    basis: policy.basis,
    magnitude: instantMagnitude,
    cumulativeMagnitude,
    signals
  };
}

function DecisionPolicy({
  deltaContainment,
  instantMagnitude,
  cumulativeMagnitude,
  anomalyPressure,
  signals
}) {
  if (
    deltaContainment === true &&
    instantMagnitude <= 0.05 &&
    cumulativeMagnitude <= 0.1
  ) {
    return {
      decision: "ALLOW",
      state: "STABLE",
      basis: "contained-low-pressure"
    };
  }

  if (
    deltaContainment === false &&
    instantMagnitude <= 0.15 &&
    cumulativeMagnitude <= 0.25 &&
    signals.length === 0
  ) {
    return {
      decision: "ALLOW",
      state: "DRIFTING",
      basis: "tolerant-structural-drift"
    };
  }

  if (
    instantMagnitude <= 0.3 &&
    anomalyPressure <= 2
  ) {
    return {
      decision: "ALLOW",
      state: "ANOMALOUS",
      basis: "accumulated-anomaly"
    };
  }

  return {
    decision: "DENY",
    state: "CRITICAL",
    basis: "structural-instability"
  };
}
