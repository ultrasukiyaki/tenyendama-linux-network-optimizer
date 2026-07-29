import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAutomaticBufferCap,
  calculateBdpBytes,
  deduplicateBufferCandidates,
  formatSysctlVector,
  generateBufferCandidates,
  parseSysctlVector,
  roundUpToMiB,
  validateBufferProfile,
  validateBufferSnapshot,
} from "../lib/tcp-buffer.mjs";
import { MODE_REGISTRY, normalizeMode } from "../lib/stats.mjs";
import { aggregateProfiles, runHasRequiredMetrics } from "../lib/report.mjs";
import { readFile } from "node:fs/promises";

const MiB = 1024 ** 2;
const snapshot = {
  coreRmemMax: 4 * MiB, coreWmemMax: 4 * MiB,
  tcpRmem: [4096, 131072, 4 * MiB],
  tcpWmem: [4096, 16384, 4 * MiB],
  tcpModerateRcvbuf: 1,
};

test("sysctl vectors parse, format, and reject malformed or unordered input", () => {
  assert.deepEqual(parseSysctlVector("4096 131072 6291456"), [4096, 131072, 6291456]);
  assert.equal(formatSysctlVector([1, 2, 3]), "1 2 3");
  for (const value of ["", "1 2", "1 2 3 4", "1 x 3", "3 2 1", "0 1 2"]) {
    assert.throws(() => parseSysctlVector(value));
  }
  assert.throws(() => validateBufferSnapshot({ ...snapshot, tcpRmem: [3, 2, 4] }));
});

test("BDP, MiB rounding, and automatic caps match the documented formula", () => {
  assert.equal(calculateBdpBytes(1000, 10), 1_250_000);
  assert.equal(roundUpToMiB(1), MiB);
  assert.equal(roundUpToMiB(MiB + 1), 2 * MiB);
  assert.equal(calculateAutomaticBufferCap(128 * MiB), 4 * MiB);
  assert.equal(calculateAutomaticBufferCap(8 * 1024 ** 3), 64 * MiB);
  assert.equal(calculateAutomaticBufferCap(128 * 1024 ** 3), 64 * MiB);
});

test("directional BDP candidates retain floors, obey cap, align core, and deduplicate", () => {
  const result = generateBufferCandidates({
    snapshot, cc: "bbr", qdisc: "fq", downloadMedianMbps: 1000,
    uploadMedianMbps: 100, unloadedLatencyMedianMs: 20,
    memTotalBytes: 8 * 1024 ** 3, bufferCapBytes: 32 * MiB,
  });
  assert.equal(result.skipped, false);
  for (const item of result.candidates) {
    assert.ok(item.buffers.tcpRmem[2] >= snapshot.tcpRmem[2]);
    assert.ok(item.buffers.tcpWmem[2] >= snapshot.tcpWmem[2]);
    assert.ok(item.buffers.coreRmemMax >= item.buffers.tcpRmem[2]);
    assert.ok(item.buffers.coreWmemMax >= item.buffers.tcpWmem[2]);
    assert.ok(item.buffers.tcpRmem[2] <= 32 * MiB);
  }
  assert.equal(new Set(result.candidates.map((item) =>
    JSON.stringify(item.buffers))).size, result.candidates.length);
  assert.equal(deduplicateBufferCandidates([result.candidates[0], result.candidates[0]]).length, 1);
});

test("autotuning, cap, and current-only safety cases skip without lowering", () => {
  assert.equal(generateBufferCandidates({
    snapshot: { ...snapshot, tcpModerateRcvbuf: 0 }, cc: "cubic", qdisc: "fq",
    downloadMedianMbps: 1, uploadMedianMbps: 1, unloadedLatencyMedianMs: 1,
    memTotalBytes: 1024 ** 3,
  }).skipped, true);
  const high = { ...snapshot, coreRmemMax: 300 * MiB, tcpRmem: [4096, 131072, 300 * MiB] };
  const result = generateBufferCandidates({
    snapshot: high, cc: "cubic", qdisc: "fq", downloadMedianMbps: 10,
    uploadMedianMbps: 10, unloadedLatencyMedianMs: 10,
    memTotalBytes: 8 * 1024 ** 3,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.candidates[0].buffers.tcpRmem[2], 300 * MiB);
});

test("profile JSON and modes are strictly validated and normalized", () => {
  const profile = {
    name: "bbr-fq@buffers-current", cc: "bbr", qdisc: "fq",
    buffers: snapshot, source: "current",
  };
  assert.deepEqual(validateBufferProfile(profile).buffers, snapshot);
  assert.throws(() => validateBufferProfile({ ...profile, cc: "evil" }));
  assert.throws(() => validateBufferProfile({
    ...profile, source: "bdp-2x", buffers: { ...snapshot, coreRmemMax: 1 },
  }));
  assert.equal(normalizeMode("highperformance"), "highperformance");
  assert.equal(normalizeMode("HIGH-PERFORMANCE"), "highperformance");
  assert.equal(normalizeMode("performance"), "highperformance");
  assert.throws(() => normalizeMode("fastest"), /Available modes/);
  assert.ok(MODE_REGISTRY.balanced);
});

test("highperformance retains loaded-latency and route safety gates", () => {
  const profile = { name: "a", cc: "cubic", qdisc: "fq" };
  const base = {
    profile: "a", protocols: ["h2"], protocolValid: true,
    routeValidationStatus: "pass", downloadMedianMbps: 1000,
    downloadP05Mbps: 900, uploadMedianMbps: 500, uploadP05Mbps: 450,
    unloadedLatencyMedianMs: 10, loadedLatencyMedianMs: 200,
    loadedLatencyP95Ms: 260, loadedLatencyMaxMs: 251, spike100Count: 1,
    downloadCv: 0.01, uploadCv: 0.01,
  };
  assert.equal(aggregateProfiles([profile], [base], "highperformance")[0].eligible, false);
  assert.equal(aggregateProfiles([profile], [{
    ...base, loadedLatencyMaxMs: 100, routeValidationStatus: "fail",
  }], "highperformance")[0].eligible, false);
});

test("missing or non-finite benchmark metrics are always ineligible", () => {
  const valid = {
    downloadMedianMbps: 100, downloadP05Mbps: 90,
    uploadMedianMbps: 50, uploadP05Mbps: 45,
    unloadedLatencyMedianMs: 10, loadedLatencyMedianMs: 12,
    loadedLatencyP95Ms: 20, loadedLatencyMaxMs: 30,
    downloadCv: 0.1, uploadCv: 0.1, spike100Count: 0,
  };
  assert.equal(runHasRequiredMetrics(valid), true);
  for (const [key, value] of [
    ["downloadMedianMbps", null],
    ["uploadMedianMbps", Number.NaN],
    ["unloadedLatencyMedianMs", 0],
    ["loadedLatencyMaxMs", Number.POSITIVE_INFINITY],
    ["downloadCv", null],
    ["spike100Count", 0.5],
  ]) {
    assert.equal(runHasRequiredMetrics({ ...valid, [key]: value }), false);
  }
});

test("restore-full permits exact legacy kernel snapshots while tuning remains strict", async () => {
  const helper = await readFile(new URL(
    "../bin/tenyendama-netopt-helper", import.meta.url
  ), "utf8");
  assert.match(
    helper,
    /if \[\[ "\$allow_large" != "yes" \]\]; then\s+\(\( core_r >= rmax && core_w >= wmax \)\)/,
  );
  assert.match(helper, /restore-full\).*apply_full "yes"/);
  assert.match(helper, /apply-full\).*apply_full "no"/);
  assert.match(helper, /temporary core safety ceilings \(not final values\)/);
  assert.match(
    helper,
    /final core ceilings \(these replace the temporary values\)/,
  );
});

test("benchmark applies only an exact current snapshot through restore-full", async () => {
  const benchmark = await readFile(new URL(
    "../scripts/benchmark.mjs", import.meta.url
  ), "utf8");
  assert.match(
    benchmark,
    /Current buffer profile \$\{profile\.name\} does not exactly match/,
  );
  assert.match(
    benchmark,
    /profile\.source === "current" \? "restore-full" : "apply-full"/,
  );
  assert.match(benchmark, /RESTORE FAILED\. Run: \$\{manualRestore\}/);
  assert.match(benchmark, /restore-full \$\{physicalIface\}/);
});

test("optimizer does not offer persistence when every starting value is retained", async () => {
  const cli = await readFile(new URL("../scripts/cli.mjs", import.meta.url), "utf8");
  assert.match(
    cli,
    /if \(finalProfileName === currentProfile && finalBuffers === null\)/,
  );
  assert.match(cli, /No persistent change is needed: CC, qdisc, and TCP buffers/);
  assert.match(cli, /if \(ccCandidateProfile === currentProfile\)/);
  assert.match(
    cli,
    /CC\/qdisc confirmation skipped: no different CC\/qdisc candidate was selected/,
  );
  assert.doesNotMatch(cli, /backgroundTrafficPassed:\s*true/);
  assert.match(cli, /optimization-report\.md/);
  assert.match(cli, /Managed match\s+.*MISMATCH/);
});
