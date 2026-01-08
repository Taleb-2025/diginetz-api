// Decision.js
// Structural Containment Decision Layer

export function TSL_Decision({
  deltaContainment,
  deltaProfile,
  stsReport,
  aeReport
}) {

  const signals = [];

  if (deltaContainment === true) {
    signals.push({ source: "structure", state: "contained" });
  } else {
    signals.push({ source: "structure", state: "out-of-scope" });
  }

  if (stsReport?.anomaly === true) {
    signals.push({ source: "sts", state: "temporal-anomaly" });
  }

  if (aeReport?.absenceDetected === true) {
    signals.push({ source: "ae", state: "expected-missing" });
  }

  return {
    decision: deltaContainment ? "ALLOW" : "DENY",
    basis: "containment",
    signals,
    profile: deltaProfile || null
  };
}
