import assert from "node:assert/strict";
import {
  balancedOrder,
  coefficientOfVariation,
  decideProfiles,
  median,
  percentile,
} from "../lib/stats.mjs";
import {
  estimateTransferBytes,
  evaluateConfirmation,
  parseProfile,
} from "../lib/optimizer.mjs";

assert.equal(median([1, 3, 2]), 2);
assert.equal(percentile([0, 100], 0.95), 95);
assert.equal(coefficientOfVariation([5, 5, 5]), 0);
assert.equal(parseProfile("cubic-fq").qdisc, "fq");

const profiles = [{ name: "a" }, { name: "b" }, { name: "c" }];
const order = balancedOrder(profiles, 3, 12345);
assert.equal(order.length, 9);
for (let position = 0; position < 3; position += 1) {
  const names = [0, 1, 2].map((round) => order[round * 3 + position].name);
  assert.equal(new Set(names).size, 3);
}

const decision = decideProfiles([
  { profile: "a", eligible: true, score: 96, measuredRuns: 3 },
  { profile: "b", eligible: true, score: 95.5, measuredRuns: 3 },
], { currentProfile: "b", minScoreGap: 2, minRuns: 3 });
assert.equal(decision.status, "retain-current");

const accepted = evaluateConfirmation({
  candidateProfile: "bbr-fq",
  currentProfile: "cubic-fq",
  decision: { status: "winner", recommendedProfile: "bbr-fq", scoreGap: 3 },
  profileSummaries: [
    { profile: "bbr-fq", eligible: true },
    { profile: "cubic-fq", eligible: true },
  ],
  runs: [
    { profile: "bbr-fq", protocolValid: true, routeValidationStatus: "pass", spike100Count: 0, loadedLatencyMaxMs: 30 },
    { profile: "bbr-fq", protocolValid: true, routeValidationStatus: "pass", spike100Count: 1, loadedLatencyMaxMs: 120 },
    { profile: "cubic-fq", protocolValid: true, routeValidationStatus: "pass", spike100Count: 0, loadedLatencyMaxMs: 20 },
  ],
});
assert.equal(accepted.accepted, true);

const rejected = evaluateConfirmation({
  candidateProfile: "bbr-fq",
  currentProfile: "cubic-fq",
  decision: { status: "winner", recommendedProfile: "bbr-fq", scoreGap: 1 },
  profileSummaries: [
    { profile: "bbr-fq", eligible: true },
    { profile: "cubic-fq", eligible: true },
  ],
  runs: [
    { profile: "bbr-fq", protocolValid: true, routeValidationStatus: "pass", spike100Count: 1, loadedLatencyMaxMs: 300 },
    { profile: "bbr-fq", protocolValid: true, routeValidationStatus: "pass", spike100Count: 1, loadedLatencyMaxMs: 301 },
  ],
});
assert.equal(rejected.accepted, false);

assert.equal(estimateTransferBytes({
  profileCount: 2, runs: 1, downloadBytes: 10, downloadCount: 2,
  uploadBytes: 5, uploadCount: 2, warmup: false,
}), 60);

console.log("Self-test: OK");
