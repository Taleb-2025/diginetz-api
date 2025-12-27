import { runTSLAutomotive } from "./tslAutomotive.js";
import { runTSLPlugins } from "./tslPlugins.js";

export const engines = {
  "tsl-automotive": runTSLAutomotive,
  "tsl-plugins": runTSLPlugins
};
