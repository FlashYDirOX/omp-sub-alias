import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, "dist", "index.js");

const result = await Bun.build({
  entrypoints: [join(root, "src", "index.ts")],
  outdir: join(root, "dist-runtime"),
  target: "bun",
  format: "esm",
  sourcemap: "external",
  external: [
    "@oh-my-pi/pi-ai",
    "@oh-my-pi/pi-ai/*",
    "@oh-my-pi/pi-coding-agent",
    "@oh-my-pi/pi-coding-agent/*",
    "@oh-my-pi/pi-utils",
    "@oh-my-pi/pi-utils/*",
    "@oh-my-pi/pi-natives",
    "@oh-my-pi/pi-natives/*",
    "@oh-my-pi/omptype",
    "@oh-my-pi/omptype/*",
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const built = result.outputs.find((output) => output.path.endsWith("/index.js"));
if (!built) throw new Error("runtime bundle did not produce index.js");

await Bun.write(outfile, built);
const map = result.outputs.find((output) => output.path.endsWith("/index.js.map"));
if (map) await Bun.write(outfile + ".map", map);

console.log("runtime bundle: " + statSync(outfile).size + " bytes");
