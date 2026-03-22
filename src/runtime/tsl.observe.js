import { DefaultTSLAdapter } from "../adapters/tsl-input-adapter.js";
import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D } from "../engines/TSL_D.js";
import { TSL_STS } from "../state/TSL_STS.js";
import { TSL_AE } from "../state/TSL_AE.js";
import { TSL_DCLS } from "../policy/TSL_DCLS.js";
import { TSL_Interpreter } from "../interpret/TSL_Interpreter.js";

export function createTSL(config = {}) {

  const adapter = new DefaultTSLAdapter();

  const structure = config.structure || {
    "0": ["A"],
    "1": ["A", "B"]
  };

  const ndr = new TSL_NDR(structure);
  const d = new TSL_D(ndr);
  const sts = new TSL_STS(ndr);
  const ae = new TSL_AE(ndr);
  const dcls = new TSL_DCLS(ndr);
  const interpreter = new TSL_Interpreter();

  let lastEffect = null;

  return {
    observe(input) {
      try {
        const event = adapter.adapt(input);
        const effect = new Set([String(event)]);

        if (!lastEffect) {
          lastEffect = effect;
          return { ok: true, type: "FIRST_EVENT" };
        }

        const delta = d.derive(lastEffect, effect);

        const stsSignal = sts.scan(delta);
        const aeSignal = ae.observe(lastEffect, effect);

        const constraints = dcls.observe({
          delta,
          ae: aeSignal
        });

        const signal = interpreter.interpret({
          delta,
          sts: stsSignal,
          ae: aeSignal
        });

        lastEffect = effect;

        return {
          ok: true,
          delta,
          sts: stsSignal,
          ae: aeSignal,
          constraints,
          signal
        };

      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    reset() {
      lastEffect = null;
      return { ok: true };
    }
  };
}
