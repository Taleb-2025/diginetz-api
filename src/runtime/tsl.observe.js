import { DefaultTSLAdapter } from "../adapters/tsl-input-adapter.js";
import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D } from "../engines/TSL_D.js";
import { TSL_STS } from "../state/TSL_STS.js";
import { TSL_AE } from "../state/TSL_AE.js";
import { TSL_DCLS } from "../policy/TSL_DCLS.js";
import { TSL_Interpreter } from "../interpret/TSL_Interpreter.js";

export function createTSL() {
  const adapter = new DefaultTSLAdapter();
  const ndr = new TSL_NDR();
  const d = new TSL_D();
  const sts = new TSL_STS();
  const ae = new TSL_AE();
  const dcls = new TSL_DCLS();
  const interpreter = new TSL_Interpreter();

  let lastEffect = null;

  return {
    observe(input) {
      let event;
      let currentEffect;

      try {
        event = adapter.adapt(input);
        currentEffect = ndr.extract(event);
      } catch (err) {
        return {
          ok: false,
          phase: "ADAPT_OR_EXTRACT",
          error: err.message
        };
      }

      if (!lastEffect) {
        lastEffect = currentEffect;

        return {
          ok: true,
          type: "FIRST_EVENT",
          event,
          effect: currentEffect,
          delta: null,
          sts: null,
          ae: null,
          constraints: null,
          signal: null
        };
      }

      let delta;

      try {
        delta = d.derive(lastEffect, currentEffect);
      } catch (err) {
        return {
          ok: false,
          phase: "DERIVE",
          error: err.message
        };
      }

      const stsSignal = sts.scan(delta);
      const aeSignal = ae.observe(delta);

      const constraints = dcls.observe({
        delta,
        ae: aeSignal
      });

      const signal = interpreter.interpret({
        delta,
        sts: stsSignal,
        ae: aeSignal
      });

      lastEffect = currentEffect;

      return {
        ok: true,
        type: "STRUCTURAL_EVENT",
        event,
        effect: currentEffect,
        delta,
        sts: stsSignal,
        ae: aeSignal,
        constraints,
        signal
      };
    },

    reset() {
      lastEffect = null;
      return { ok: true };
    }
  };
}
