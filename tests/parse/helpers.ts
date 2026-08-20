import { readFileSync } from "node:fs";

/** Load a fixture, stripping the single trailing newline the editor adds. */
export function fixture(name: string): string {
  const path = new URL(`./fixtures/${name}`, import.meta.url);
  return readFileSync(path, "utf8").replace(/\n$/, "");
}
