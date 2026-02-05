// src/analysis/TSL_AE.js

export class TSL_AE {
  constructor() {
    this._awaitingClosure = false;
  }

  observe(previousEffect, currentEffect) {
    if (!previousEffect || !currentEffect) {
      return null;
    }

    // 1) إذا دخلنا مسار تفريغ → نتوقع إغلاقًا لاحقًا
    if (previousEffect.containment === "DRAINING") {
      this._awaitingClosure = true;
    }

    // 2) إذا تحقق الإغلاق → التوقع تحقق
    if (currentEffect.containment === "LAST_TRACE") {
      this._awaitingClosure = false;
      return null;
    }

    // 3) إذا حصل انتقال حاوية قبل الإغلاق → غياب
    if (
      this._awaitingClosure &&
      currentEffect.container !== previousEffect.container
    ) {
      this._awaitingClosure = false;

      return {
        layer: "AE",
        type: "ABSENT_EXECUTION",
        reason: "EXPECTED_CLOSURE_ABSENT",
        effect: "STRUCTURAL_GAP"
      };
    }

    // 4) إذا حصل كسر غير قانوني أثناء انتظار الإغلاق
    if (
      this._awaitingClosure &&
      currentEffect.containment === "ILLEGAL_TRACE"
    ) {
      this._awaitingClosure = false;

      return {
        layer: "AE",
        type: "ABSENT_EXECUTION",
        reason: "PATH_INTERRUPTED_BEFORE_CLOSURE",
        effect: "STRUCTURAL_GAP"
      };
    }

    return null;
  }

  reset() {
    this._awaitingClosure = false;
  }
}
