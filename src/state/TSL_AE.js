export class TSL_AE {
  constructor() {
    this._expecting = null;
  }

  observe(effect) {
    if (!effect || typeof effect !== "object") {
      return null;
    }

    const { containment } = effect;

    // 1) بناء التوقع البنيوي من الحاضر فقط
    // CONTAINED أو PRESSURE ⇒ المسار يجب أن يكتمل
    if (containment === "CONTAINED" || containment === "PRESSURE") {
      this._expecting = "COMPLETION";
      return null;
    }

    // 2) اكتمال طبيعي ⇒ مسح التوقع
    if (containment === "FULL") {
      this._expecting = null;
      return null;
    }

    // 3) كسر أثناء وجود توقع ⇒ غياب بنيوي
    if (containment === "BROKEN" && this._expecting === "COMPLETION") {
      this._expecting = null;
      return this._absence("EXPECTED_COMPLETION_ABSENT");
    }

    // 4) أي حالة أخرى لا تعني غيابًا
    return null;
  }

  reset() {
    this._expecting = null;
  }

  _absence(reason) {
    return {
      layer: "AE",
      type: "ABSENT_EXECUTION",
      reason,
      effect: "STRUCTURAL_GAP"
    };
  }
}
