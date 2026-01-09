export function TSL_Decision({
  deltaContainment,
  deltaProfile,
  stsReport,
  aeReport
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

  const magnitude =
    Math.abs(deltaProfile?.densityDelta ?? 0) +
    Math.abs(deltaProfile?.appearanceDelta ?? 0) +
    Math.abs(deltaProfile?.localShift ?? 0) +
    Math.abs(deltaProfile?.scaleShift ?? 0);

  if (deltaContainment === true) {
    return {
      decision: "ALLOW",
      basis: "structural-containment",
      magnitude,
      signals
    };
  }

  return {
    decision: "DENY",
    basis: "out-of-structure",
    magnitude,
    signals
  };
}
