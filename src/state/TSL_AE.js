export class TSL_AE {
  constructor() {
    this._expectingDrain = false;
  }

  observe(effect) {
    if (!effect || typeof effect !== "object") return null;

    const { containment } = effect;

    if (containment === "DRAINING" && !this._expectingDrain) {
      this._expectingDrain = true;
      return null;
    }

    if (containment === "LAST_TRACE") {
      this._expectingDrain = false;
      return null;
    }

    if (containment === "ILLEGAL_TRACE" && this._expectingDrain) {
      this._expectingDrain = false;
      return {
        layer: "AE",
        type: "ABSENT_EXECUTION",
        reason: "PATH_INTERRUPTED",
        effect: "STRUCTURAL_GAP"
      };
    }

    return null;
  }

  reset() {
    this._expectingDrain = false;
  }
}
