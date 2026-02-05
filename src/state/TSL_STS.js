// src/analysis/TSL_STS.js

export class TSL_STS {
  scan(previousEffect, currentEffect) {
    if (!previousEffect || !currentEffect) {
      return null;
    }

    const prev = previousEffect;
    const curr = currentEffect;

    // 1) نفس الحاوية → المسار سليم دائمًا
    if (curr.container === prev.container) {
      return this.#state("STABLE", "CONTAINER_CONTINUITY");
    }

    // 2) انتقال حاوية بعد إغلاق صحيح
    if (
      curr.container !== prev.container &&
      prev.containment === "LAST_TRACE"
    ) {
      return this.#state("STABLE", "CLOSED_CONTAINER_TRANSITION");
    }

    // 3) انتقال حاوية بدون إغلاق → انحراف
    if (
      curr.container !== prev.container &&
      prev.containment !== "LAST_TRACE"
    ) {
      return this.#state("DEVIATION", "JUMP_WITHOUT_COMPLETION");
    }

    // 4) حالة احتياطية (لا يجب الوصول لها)
    return this.#state("DEVIATION", "UNCLASSIFIED_SHIFT");
  }

  #state(level, reason) {
    return {
      layer: "STS",
      level,
      reason
    };
  }

  reset() {}
}
