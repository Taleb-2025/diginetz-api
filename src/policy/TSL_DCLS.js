export class TSL_DCLS {
  constructor() {
    this.reset();
  }

  observe({ sts, ae }) {
    // لا AE → لا إقصاء
    if (!ae) {
      return this.constraints();
    }

    // AE يعني: المسار لم يعد ممكنًا وجوديًا
    if (ae.type === "ABSENT_EXECUTION") {
      this._constraints.allowContainment = false;
    }

    return this.constraints();
  }

  constraints() {
    return { ...this._constraints };
  }

  reset() {
    this._constraints = {
      allowContainment: true
    };
  }
}
