import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("v3.2 CLI retains existing commands, presets, modes, and opt-in tuning", async () => {
  const [cli, packageDocument] = await Promise.all([
    readFile(new URL("../scripts/cli.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  for (const value of [
    "check", "benchmark", "optimize", "status", "recover", "rollback",
    "quick", "standard", "deep", "highperformance", "--tune-buffers",
  ]) {
    assert.match(cli, new RegExp(value));
  }
  assert.equal(JSON.parse(packageDocument).version, "3.2.0");
  assert.match(cli, /case "--version": case "version": console\.log\("3\.2\.0"\)/);
  assert.match(cli, /tuneBuffers:\s*false/);
  assert.match(cli, /benchmark never persists/);
  assert.match(cli, /exploration/);
  assert.match(cli, /confirmation/);
});

test("headed mode is not exposed while benchmark launch stays common", async () => {
  const [cli, benchmark] = await Promise.all([
    readFile(new URL("../scripts/cli.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/benchmark.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(cli, /--headed/);
  assert.doesNotMatch(benchmark, /--headed/);
  assert.match(benchmark, /launchBenchmarkChromium\(\)/);
  assert.doesNotMatch(benchmark, /chromium\.launch/);
});
