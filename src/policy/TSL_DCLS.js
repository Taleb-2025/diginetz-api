export class TSL_DCLS {
  constructor() {
    this.reset();
  }

  observe({ sts, ae }) {
    if (sts) {
      this.#eliminateBySTS(sts);
    }

    if (ae) {
      this.#eliminateByAE(ae);
    }

    return this.constraints();
  }

  #eliminateBySTS(sts) {
    if (sts.level === "DEVIATION") {
      this._constraints.allowContainment = false;
    }

    if (sts.level === "PRESSURE") {
      this._constraints.allowContainment = false;
    }
  }

  #eliminateByAE(ae) {
    if (ae.reason === "EXPECTED_EVENT_ABSENT") {
      this._constraints.allowContainment = false;
    }

    if (ae.reason === "CORRECTION_ABSENT") {
      this._constraints.allowPressure = false;
    }
  }

  constraints() {
    return { ...this._constraints };
  }

  reset() {
    this._constraints = {
      allowContainment: true,
      allowPressure: true,
      allowRupture: true
    };
  }
}
