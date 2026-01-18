import TSL_EG from "../src/execution/TSL_EG.js";

test("TSL_EG can initialize and execute", () => {
  const eg = new TSL_EG({
    ndr: { extract: x => ({ structure: x }) },
    d: { derive: () => ({ identical: true }) },
    rv: {
      isInitialized: () => false,
      init: () => {},
      get: () => ({ structure: "A" }),
      meta: () => ({})
    },
    decision: () => ({ decision: "ALLOW" })
  });

  const initResult = eg.init("test");
  expect(initResult.ok).toBe(true);
});
