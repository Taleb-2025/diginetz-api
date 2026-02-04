export class TSL_AE {
  constructor() {
    this._expected = null;
  }

  observe(signal) {
    if (!signal || typeof signal !== "object") {
      return null;
    }

    const aeSignal = this._detectAbsence(signal);
    this._expected = this._deriveExpectation(signal);

    return aeSignal;
  }

  _deriveExpectation(signal) {
    const { relation_type, structural_state } = signal;

    if (relation_type === "STRUCTURAL_CONTAINMENT") {
      return "CONTAINMENT_CONTINUATION";
    }

    if (structural_state === "STABLE") {
      return "NO_CHANGE_REQUIRED";
    }

    if (structural_state === "DRIFTING") {
      return "CORRECTION_EXPECTED";
    }

    return null;
  }

  _detectAbsence(signal) {
    if (!this._expected) return null;

    const { relation_type, structural_state } = signal;

    if (
      this._expected === "CONTAINMENT_CONTINUATION" &&
      relation_type !== "STRUCTURAL_CONTAINMENT"
    ) {
      return this._absence("CONTAINMENT_BROKEN");
    }

    if (
      this._expected === "CORRECTION_EXPECTED" &&
      structural_state === "DRIFTING"
    ) {
      return this._absence("CORRECTION_ABSENT");
    }

    return null;
  }

  _absence(reason) {
    return {
      type: "ABSENT_EXECUTION",
      reason,
      effect: "STRUCTURAL_GAP"
    };
  }

  reset() {
    this._expected = null;
  }
}
