export function runTSLPlugins(payload) {
  return {
    engine: "TSL-Plugins",
    received: payload,
    status: "ok"
  };
}
