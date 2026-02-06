export class TSL_D {
  derive(previous, current) {
    if (!previous || !current) {
      throw new Error("TSL_D_MISSING_STATE");
    }

    const prev = previous.containment;
    const curr = current.containment;

    return {
      from: prev,
      to: curr,
      effect: this.#effect(prev, curr)
    };
  }

  #effect(prev, curr) {
    if (prev === "DRAINING" && curr === "DRAINING") {
      return "CONTINUITY";        // السير على الطريق
    }

    if (prev === "DRAINING" && curr === "LAST_TRACE") {
      return "COMPLETION";        // وصول للأثر الأخير
    }

    if (prev === "LAST_TRACE" && curr === "DRAINING") {
      return "RESET_FLOW";        // عودة غير طبيعية
    }

    if (curr === "ILLEGAL_TRACE") {
      return "RUPTURE";           // انقطاع المسار
    }

    return "TRANSITION";
  }
}
