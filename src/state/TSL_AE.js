export class TSL_AE {
  constructor() {
    this._cycleClosed = false; // أثر وجودي فقط
  }

  observe(effect) {
    if (!effect || typeof effect !== "object") {
      return null;
    }

    const { containment } = effect;

    // 1) عند اكتمال الحاوية → تسجيل أثر وجودي
    if (containment === "FULL") {
      this._cycleClosed = true;
      return null;
    }

    // 2) إذا كان المسار قد اكتمل سابقًا
    //    لكننا عدنا لنفس الحاوية دون اكتمال
    if (this._cycleClosed && containment === "CONTAINED") {
      return this.#absence("EXPECTED_COMPLETION_ABSENT");
    }

    // 3) عند الانكسار → إنهاء الأثر (نسيان حقيقي)
    if (containment === "BROKEN") {
      this._cycleClosed = false;
      return null;
    }

    return null;
  }

  reset() {
    this._cycleClosed = false;
  }

  #absence(reason) {
    return {
      layer: "AE",
      type: "ABSENT_EXECUTION",
      reason,
      effect: "STRUCTURAL_GAP"
    };
  }
}
