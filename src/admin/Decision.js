// Decision.js
// Structural Containment Decision Layer (Non-Linear / Explainable)

export function TSL_Decision({
  deltaContainment,   
  deltaProfile,      
  stsReport,          
  aeReport            
}) {

  const signals = [];

  // --- 1) Structural signal (primary) ---
  if (deltaContainment === true) {
    signals.push({ source: "structure", state: "contained" });
  } else {
    signals.push({ source: "structure", state: "out-of-scope" });
  }

  // --- 2) Temporal signal (non-decisive) ---
  if (stsReport?.anomaly === true) {
    signals.push({ source: "sts", state: "temporal-anomaly" });
  }

  // --- 3) Absence signal (non-decisive) ---
  if (aeReport?.absenceDetected === true) {
    signals.push({ source: "ae", state: "expected-missing" });
  }

  // --- 4) Containment-based decision ---
  
  const decision =
    deltaContainment === true
      ? "ALLOW"
      : "DENY";

  // --- 5) Explainable outcome ---
  return {
    decision,          // ALLOW | DENY
    basis: "containment",
    signals,           
    profile: deltaProfile || null
  };
}
