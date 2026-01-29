// src/runtime/tsl.observe.js

import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D } from "../engines/TSL_D.js";
import { TSL_Interpreter } from "../interpret/TSL_Interpreter.js";

export function createTSL() {
  const ndr = new TSL_NDR();
  const d = new TSL_D();
  const interpreter = new TSL_Interpreter();

  // الأثر الوحيد (آخر بنية فقط)
  let lastStructure = null;

  return {
    observe(value) {
      // 🔴 لا Adapter — القيم الخام كما هي
      if (!Array.isArray(value) && !(value instanceof Uint8Array)) {
        throw new Error("INVALID_INPUT");
      }

      const numeric =
        value instanceof Uint8Array ? Array.from(value) : value;

      // استخراج البنية مباشرة من القيم الزمنية
      const structure = ndr.extract(numeric);

      // أول حدث
      if (!lastStructure) {
        lastStructure = structure;
        return {
          type: "FIRST_EVENT",
          structure
        };
      }

      // دلتا بنيوية حقيقية
      const delta = d.derive(lastStructure, structure);
      const signal = interpreter.interpret({ delta });

      // النسيان (استبدال الأثر)
      lastStructure = structure;

      return {
        type: "STRUCTURAL_SIGNAL",
        signal
      };
    },

    reset() {
      lastStructure = null;
    }
  };
}
