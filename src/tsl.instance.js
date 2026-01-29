// src/tsl.instance.js

import { createTSL } from "./tsl.observe.js";

/**
 * Single TSL Runtime Instance
 * - Holds lastStructure
 * - Lives as long as the server is running
 * - No re-creation per request
 */

const tsl = createTSL();

export default tsl;
