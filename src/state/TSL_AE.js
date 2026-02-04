export class TSL_AE {
  constructor() {
    this._activeContainer = null;
    this._expectingCompletion = false;
  }

  observe(effect) {
    if (!effect || typeof effect !== "object") {
      return null;
    }

    const { container, containment } = effect;

    // أول دخول لحاوية
    if (this._activeContainer === null) {
      if (containment === "CONTAINED") {
        this._activeContainer = container;
        this._expectingCompletion = true;
      }
      return null;
    }

    // نفس الحاوية
    if (container === this._activeContainer) {

      // اكتمال طبيعي
      if (containment === "FULL") {
        this._reset();
        return null;
      }

      // كسر قبل الاكتمال → غياب
      if (containment === "BROKEN" && this._expectingCompletion) {
        this._reset();
        return this._absence("MISSING_INTERNAL_EVENT");
      }

      return null;
    }

    // الانتقال لحاوية جديدة
    // إذا غادرنا الحاوية السابقة دون اكتمال → غياب
    if (this._expectingCompletion) {
      const ae = this._absence("UNEXPECTED_CONTAINER_SHIFT");
      this._reset();

      // إعادة التهيئة للحاوية الجديدة إن كانت صالحة
      if (containment === "CONTAINED") {
        this._activeContainer = container;
        this._expectingCompletion = true;
      }

      return ae;
    }

    // لا شيء غير متوقع
    this._activeContainer = null;
    this._expectingCompletion = false;
    return null;
  }

  _absence(reason) {
    return {
      layer: "AE",
      type: "ABSENT_EXECUTION",
      reason,
      effect: "STRUCTURAL_GAP"
    };
  }

  _reset() {
    this._activeContainer = null;
    this._expectingCompletion = false;
  }

  reset() {
    this._reset();
  }
}
