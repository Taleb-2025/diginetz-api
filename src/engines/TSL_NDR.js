// diginetz-api/src/engines/TSL_NDR.js
// ----------------------------------------------
// TSL_NDR (FINAL — PURE STRUCTURAL)
// ----------------------------------------------
// Structural Laws (FINAL):
// 1. LENGTH        → عدد الذرات
// 2. ORDER         → اتجاه التغيّر (+ / - / =)
// 3. CONTINUITY    → تتابع الاتجاهات
// 4. BOUNDARIES    → بداية ونهاية الاتجاه
// 5. STEP_SHAPE    → شكل القفزات (القيم المطلقة فقط)
// ----------------------------------------------
// مبدأ حاكم:
// - لا قيمة عددية
// - لا مقياس
// - لا دلالة
// - الشكل فقط
// ----------------------------------------------

export class TSL_NDR {
  constructor(options = {}) {
    this.minLength = options.minLength ?? 2;
  }

  extract(input) {
    if (!Array.isArray(input)) {
      throw new Error("TSL_NDR: input must be number[]");
    }

    if (input.length < this.minLength) {
      throw new Error("TSL_NDR: insufficient data length");
    }

    for (const v of input) {
      if (typeof v !== "number" || Number.isNaN(v)) {
        throw new Error("TSL_NDR: invalid numeric input");
      }
    }

    const length      = input.length;
    const order       = this.#deriveOrder(input);
    const continuity  = this.#deriveContinuity(order);
    const boundaries  = this.#deriveBoundaries(order);
    const stepShape   = this.#deriveStepShape(input);

    const fingerprint = this.#fingerprint({
      length,
      order,
      continuity,
      boundaries,
      stepShape
    });

    return {
      engine: "TSL_NDR",

      length,
      order,
      continuity,
      boundaries,
      stepShape,

      fingerprint
    };
  }

  /* ================= LAW 2: ORDER ================= */

  #deriveOrder(arr) {
    const order = [];
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] > arr[i - 1]) order.push("+");
      else if (arr[i] < arr[i - 1]) order.push("-");
      else order.push("=");
    }
    return order;
  }

  /* ================= LAW 3: CONTINUITY ================= */

  #deriveContinuity(order) {
    if (order.length === 0) return [];

    const runs = [];
    let current = order[0];
    let len = 1;

    for (let i = 1; i < order.length; i++) {
      if (order[i] === current) {
        len++;
      } else {
        runs.push({ dir: current, len });
        current = order[i];
        len = 1;
      }
    }

    runs.push({ dir: current, len });
    return runs;
  }

  /* ================= LAW 4: BOUNDARIES ================= */

  #deriveBoundaries(order) {
    if (order.length === 0) {
      return { start: null, end: null };
    }

    return {
      start: order[0],
      end: order[order.length - 1]
    };
  }

  /* ================= LAW 5: STEP_SHAPE ================= */
  // القيم المطلقة فقط — الشكل دون قيمة

  #deriveStepShape(arr) {
    const shape = [];

    for (let i = 1; i < arr.length; i++) {
      shape.push(Math.abs(arr[i] - arr[i - 1]));
    }

    return shape;
  }

  /* ================= FINGERPRINT ================= */

  #fingerprint(structure) {
    const stable = this.#stableStringify(structure);
    let h = 2166136261;

    for (let i = 0; i < stable.length; i++) {
      h ^= stable.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }

    return (h >>> 0).toString(16);
  }

  #stableStringify(obj) {
    if (obj === null || typeof obj !== "object") {
      return String(obj);
    }

    if (Array.isArray(obj)) {
      return "[" + obj.map(v => this.#stableStringify(v)).join(",") + "]";
    }

    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys.map(k => `${k}:${this.#stableStringify(obj[k])}`).join(",") +
      "}"
    );
  }
}
