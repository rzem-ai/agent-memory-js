import { expect, test } from "vitest";

test("package entry module loads", async () => {
  const mod = await import("../src/index.js");
  expect(mod).toBeDefined();
});
