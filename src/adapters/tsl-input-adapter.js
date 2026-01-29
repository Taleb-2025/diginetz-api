// diginetz-api/src/adapters/tsl-input-adapter.js
// ----------------------------------------------
// DefaultTSLAdapter (NO NORMALIZATION)
// ----------------------------------------------
// Principles:
// - No scaling
// - No normalization
// - No averaging
// - Preserve raw numeric identity
// ----------------------------------------------

export class DefaultTSLAdapter {

  adapt(input) {
    // Uint8Array (heartbeat / binary)
    if (input instanceof Uint8Array) {
      return Array.from(input);
    }

    // Buffer (Node.js)
    if (Buffer.isBuffer(input)) {
      return Array.from(input);
    }

    // Single number (heartbeat pulse)
    if (typeof input === "number" && Number.isFinite(input)) {
      return [input];
    }

    // Array of numbers
    if (Array.isArray(input)) {
      return input.filter(v => typeof v === "number" && Number.isFinite(v));
    }

    // String (typed stream / text)
    if (typeof input === "string") {
      return Array.from(input).map(ch => ch.charCodeAt(0));
    }

    throw new Error("TSL_ADAPTER_UNSUPPORTED_INPUT");
  }
}
