import {
  chmodSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);

for (const entry of [...manifest.files, "package.json"]) {
  normalize(join(root, entry));
}

function normalize(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new Error("refusing to package symlink: " + path);
  }

  if (stat.isDirectory()) {
    chmodSync(path, 0o755);
    for (const child of readdirSync(path)) {
      normalize(join(path, child));
    }
    return;
  }

  if (stat.isFile()) {
    chmodSync(path, 0o644);
    return;
  }

  throw new Error("unsupported package entry: " + path);
}
