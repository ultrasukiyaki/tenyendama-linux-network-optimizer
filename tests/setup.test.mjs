import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

test("setup help documents all supported options and unknown options fail", () => {
  const help = spawnSync("bash", ["setup.sh", "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  for (const option of ["--check-only", "--skip-browser", "--with-browser-deps"]) {
    assert.match(help.stdout, new RegExp(option));
  }
  const unknown = spawnSync("bash", ["setup.sh", "--not-an-option"], {
    encoding: "utf8",
  });
  assert.equal(unknown.status, 2);
});

test("setup check-only branches before every installation or chmod action", async () => {
  const setup = await readFile(new URL("../setup.sh", import.meta.url), "utf8");
  const checkBranch = setup.indexOf("if (( CHECK_ONLY )); then");
  const firstInstall = setup.indexOf("npm install");
  const chmod = setup.indexOf("chmod +x");
  assert.ok(checkBranch > 0);
  assert.ok(firstInstall > checkBranch);
  assert.ok(chmod > checkBranch);
  assert.match(setup, /env -u DISPLAY -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE/);
  assert.match(setup, /npx playwright install --with-deps chromium/);
});

test("normal check and benchmark paths never install packages", async () => {
  const [cli, benchmark] = await Promise.all([
    readFile(new URL("../scripts/cli.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/benchmark.mjs", import.meta.url), "utf8"),
  ]);
  for (const source of [cli, benchmark]) {
    assert.doesNotMatch(source, /\b(?:apt|dnf|pacman)\b/);
    assert.doesNotMatch(source, /playwright install/);
    assert.doesNotMatch(source, /\bnpm install\b/);
  }
});
