export class TSL_EG {
  constructor({ adapter, ndr, interpreter }) {
    if (!adapter || !ndr || !interpreter) {
      throw new Error("TSL_EG_MISSING_CORE");
    }

    this.adapter = adapter;
    this.ndr = ndr;
    this.interpreter = interpreter;

    // الأثر الوحيد المسموح
    this._lastEffect = null;
  }

  observe(input) {
    let event;
    let effect;

    try {
      // 1) Adapter → نبضة واحدة
      event = this.adapter.adapt(input);

      // 2) NDR → أثر احتواء (container / extension / status)
      effect = this.ndr.extract(event);
    } catch (err) {
      return {
        ok: false,
        phase: "ADAPT_OR_EXTRACT",
        error: err.message
      };
    }

    // أول حدث — لا مقارنة
    if (!this._lastEffect) {
      this._lastEffect = effect;
      return {
        ok: true,
        type: "FIRST_EVENT",
        effect
      };
    }

    // 3) Interpreter → توصيف بنيوي للحالة الحاضرة فقط
    const signal = this.interpreter.interpret(effect);

    // 4) النسيان (استبدال الأثر)
    this._lastEffect = effect;

    return {
      ok: true,
      type: "STRUCTURAL_EVENT",
      effect,
      signal
    };
  }

  reset() {
    this._lastEffect = null;
    return { ok: true };
  }

  meta() {
    return {
      engine: "TSL_EG",
      logic: "CONTAINMENT",
      mode: "STREAMING",
      memory: "LAST_EFFECT_ONLY",
      delta: false,
      decision: false,
      reference: false
    };
  }
}
