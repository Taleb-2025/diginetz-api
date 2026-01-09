export function TSL_Decision({
  deltaContainment,
  deltaProfile = {},
  stsReport,
  aeReport
}) {
  const signals = [];

  if (stsReport?.anomaly === true) {
    signals.push({ source: "sts", state: "temporal-anomaly" });
  }

  if (aeReport?.absenceDetected === true) {
    signals.push({ source: "ae", state: "expected-missing" });
  }

  const magnitude =
    Math.abs(deltaProfile.densityDelta ?? 0) +
    Math.abs(deltaProfile.appearanceDelta ?? 0) +
    Math.abs(deltaProfile.localShift ?? 0) +
    Math.abs(deltaProfile.scaleShift ?? 0);

  const ACCEPT_ZONE = 0.05;
  const TOLERANT_ZONE = 0.15;

  if (deltaContainment === true) {
    return {
      decision: "ALLOW",
      mode: "STRICT",
      basis: "structural-containment",
      signals,
      magnitude
    };
  }

  if (
    deltaContainment === false &&
    magnitude <= TOLERANT_ZONE &&
    signals.length === 0
  ) {
    return {
      decision: "ALLOW",
      mode: "TOLERANT",
      basis: "boundary-tolerance",
      signals,
      magnitude
    };
  }

  return {
    decision: "DENY",
    mode: "REJECT",
    basis: "out-of-scope",
    signals,
    magnitude
  };
}
