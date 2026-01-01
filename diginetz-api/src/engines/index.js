import { TSL_NDR_D } from "./TSL_NDR_D.js";

export const engines = {
  "tsl-ndr-d": (input) => {
    const engine = new TSL_NDR_D();
    return engine.extract(input);
  }
};
