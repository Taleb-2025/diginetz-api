// tsl.observe.js

import { DefaultTSLAdapter } from "./adapters/tsl-input-adapter.js";
import { TSL_NDR } from "./engines/TSL_NDR.js";
import { TSL_D } from "./engines/TSL_D.js";
import { TSL_Interpreter } from "./interpret/TSL_Interpreter.js";

export function createTSL() {
  const adapter = new DefaultTSLAdapter();
  const ndr = new TSL_NDR();
  const d = new TSL_D();
  const interpreter = new TSL_Interpreter();

  let lastStructure = null; // الأثر الوحيد

  return {
    observe(value) {
      const adapted = adapter.adapt(value);
      const structure = ndr.extract(adapted);

      if (!lastStructure) {
        lastStructure = structure;
        return {
          type: "FIRST_EVENT",
          structure
        };
      }

      const delta = d.derive(lastStructure, structure);
      const signal = interpreter.interpret({ delta });

      // النسيان
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
