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
  metafile: true,
  external: [
    "@oh-my-pi/pi-ai",
    "@oh-my-pi/pi-ai/*",
    "@oh-my-pi/pi-coding-agent",
    "@oh-my-pi/pi-coding-agent/*",
    "@oh-my-pi/pi-catalog",
    "@oh-my-pi/pi-catalog/*",
    "@oh-my-pi/pi-natives",
    "@oh-my-pi/pi-natives/*",
    "@oh-my-pi/pi-utils",
    "@oh-my-pi/pi-utils/*",
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const metafile =
  typeof result.metafile === "string"
    ? JSON.parse(result.metafile)
    : result.metafile;
if (
  !metafile ||
  Object.keys(metafile.inputs).some((path) =>
    /[/\\]pi-catalog[/\\]/.test(path),
  )
) {
  throw new Error("catalog data must remain owned by the OMP host");
}

const built = result.outputs.find((output) => output.path.endsWith("/index.js"));
if (!built) throw new Error("runtime bundle did not produce index.js");

await Bun.write(outfile, built);
const map = result.outputs.find((output) => output.path.endsWith("/index.js.map"));
if (map) await Bun.write(outfile + ".map", map);

console.log("runtime bundle: " + statSync(outfile).size + " bytes");
