import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "3.2.0";
const archiveName = `tenyendama-linux-network-optimizer-v${version}.zip`;
const dist = join(root, "dist");
const archive = join(dist, archiveName);
const roots = [
  "package.json", "package-lock.json", "README.md", "README.ja.md", "LICENSE",
  "CHANGELOG.md", "CHANGELOG.ja.md", "SECURITY.md", "THIRD-PARTY-NOTICES.md", "MANIFEST.json",
  "setup.sh", "uninstall.sh", "index.html", "bin", "src", "lib", "scripts",
  "docs/en", "docs/ja", "tests",
];

const files = [];
const walk = async (path) => {
  const info = await stat(path);
  if (info.isFile()) {
    files.push(relative(root, path));
    return;
  }
  for (const entry of await readdir(path)) await walk(join(path, entry));
};
for (const entry of roots.filter((entry) => entry !== "MANIFEST.json")) {
  await walk(join(root, entry));
}
files.sort();

const manifest = [];
for (const path of files) {
  const data = await readFile(join(root, path));
  manifest.push({
    path,
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.length,
  });
}
await writeFile(join(root, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);

await mkdir(dist, { recursive: true });
await rm(archive, { force: true });
const run = (command, args) => new Promise((resolvePromise, rejectPromise) => {
  const child = spawn(command, args, { cwd: root, shell: false, stdio: "inherit" });
  child.once("error", rejectPromise);
  child.once("close", (code) => {
    if (code === 0) resolvePromise();
    else rejectPromise(new Error(`${command} exited with ${code}`));
  });
});
await run("zip", ["-q", "-X", "-r", archive, ...roots]);
const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
await writeFile(join(dist, `${archiveName}.sha256`), `${digest}  ${archiveName}\n`);
console.log(`${archiveName}\n${digest}`);
