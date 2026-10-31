import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, "dist", "index.js");
let catalogAuthOmitted = false;

const result = await Bun.build({
  entrypoints: [join(root, "src", "index.ts")],
  outdir: join(root, "dist-runtime"),
  target: "bun",
  format: "esm",
  sourcemap: "external",
  metafile: true,
  plugins: [{
    name: "omit-unused-catalog-auth",
    setup(build) {
      build.onLoad({ filter: /[/\\]@oh-my-pi[/\\]pi-catalog[/\\]src[/\\]compat[/\\]rules\.json$/ }, async ({ path }) => {
        const rules = await Bun.file(path).json();
        if (!rules.auth || Object.keys(rules.auth).length !== 1 || !Array.isArray(rules.auth.providers)) {
          throw new Error("catalog authentication schema changed; review bundle isolation");
        }
        rules.auth.providers = [];
        catalogAuthOmitted = true;
        return { contents: JSON.stringify(rules), loader: "json" };
      });
    },
  }],
  external: [
    "@oh-my-pi/pi-ai",
    "@oh-my-pi/pi-ai/*",
    "@oh-my-pi/pi-coding-agent",
    "@oh-my-pi/pi-coding-agent/*",
    "@oh-my-pi/pi-natives",
    "@oh-my-pi/pi-natives/*",
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const metafile = typeof result.metafile === "string" ? JSON.parse(result.metafile) : result.metafile;
if (!catalogAuthOmitted || !metafile ||
    Object.keys(metafile.inputs).some((path) => /[/\\]pi-catalog[/\\]src[/\\]compat[/\\]auth\.ts$/.test(path))) {
  throw new Error("catalog authentication must remain owned by the OMP host");
}

const built = result.outputs.find((output) => output.path.endsWith("/index.js"));
if (!built) throw new Error("runtime bundle did not produce index.js");

await Bun.write(outfile, built);
const map = result.outputs.find((output) => output.path.endsWith("/index.js.map"));
if (map) await Bun.write(outfile + ".map", map);

console.log("runtime bundle: " + statSync(outfile).size + " bytes");
