const TSL_EG = require("../src/execution/TSL_EG.js").default;

test("TSL_EG returns a valid decision object", () => {
  const result = TSL_EG({
    input: "test",
    context: {}
  });

  expect(result).toBeDefined();
  expect(typeof result).toBe("object");
});
