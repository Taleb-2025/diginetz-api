// src/runtime/tsl.observe.js

import { DefaultTSLAdapter } from "../adapters/tsl-input-adapter.js";
import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D } from "../engines/TSL_D.js";
import { TSL_Interpreter } from "../interpret/TSL_Interpreter.js";
import { TSL_STS } from "../state/TSL_STS.js";
import { TSL_AE } from "../state/TSL_AE.js";
import { TSL_DCLS } from "../analysis/TSL_DCLS.js";

export function createTSL() {
  const adapter = new DefaultTSLAdapter();
  const ndr = new TSL_NDR();
  const d = new TSL_D();
  const interpreter = new TSL_Interpreter();
  const sts = new TSL_STS();
  const ae = new TSL_AE();
  const dcls = new TSL_DCLS();

  let lastEffect = null;

  return {
    observe(input) {
      const event = adapter.adapt(input);
      const currentEffect = ndr.extract(event);

      if (!lastEffect) {
        lastEffect = currentEffect;
        return {
          type: "FIRST_EVENT",
          effect: currentEffect
        };
      }

      const delta = d.derive(lastEffect, currentEffect);

      const signal = interpreter.interpret({
        previous: lastEffect,
        current: currentEffect,
        delta
      });

      const stsSignal = sts.scan(lastEffect, currentEffect);
      const aeSignal = ae.observe(currentEffect);

      const constraints = dcls.observe({
        sts: stsSignal,
        ae: aeSignal
      });

      lastEffect = currentEffect;

      return {
        type: "STRUCTURAL_EVENT",
        event,
        effect: currentEffect,
        delta,
        signal,
        sts: stsSignal,
        ae: aeSignal,
        constraints
      };
    },

    reset() {
      lastEffect = null;
      sts.reset();
      ae.reset();
      dcls.reset();
      return { ok: true };
    }
  };
}
