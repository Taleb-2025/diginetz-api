// diginetz-api/src/adapters/tsl-input-adapter.js

export class DefaultTSLAdapter {
  adapt(input) {
    if (input == null) {
      throw new Error("TSL_ADAPTER_NULL_INPUT");
    }

    let value;

    if (input instanceof Uint8Array) {
      if (input.length === 0) throw new Error("TSL_ADAPTER_EMPTY_STREAM");
      value = input[input.length - 1];
    }
    else if (Buffer.isBuffer(input)) {
      if (input.length === 0) throw new Error("TSL_ADAPTER_EMPTY_STREAM");
      value = input[input.length - 1];
    }
    else if (Array.isArray(input)) {
      if (input.length === 0) throw new Error("TSL_ADAPTER_EMPTY_STREAM");
      value = input[input.length - 1];
    }
    else if (typeof input === "string") {
      if (input.length === 0) throw new Error("TSL_ADAPTER_EMPTY_STRING");
      value = input.charCodeAt(input.length - 1);
    }
    else if (typeof input === "number") {
      value = input;
    }
    else {
      throw new Error("TSL_ADAPTER_UNSUPPORTED_INPUT");
    }

    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("TSL_ADAPTER_NON_NUMERIC_VALUE");
    }

    return value;
  }
}
