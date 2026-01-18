import TSL_EG from "../src/execution/TSL_EG.js";

test("TSL_EG returns a valid decision object", () => {
  const result = TSL_EG({
    input: "test",
    context: {}
  });

  expect(result).toBeDefined();
  expect(typeof result).toBe("object");
});
