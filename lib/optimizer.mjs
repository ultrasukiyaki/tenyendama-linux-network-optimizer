export const PROFILE_REGISTRY = {
  "reno-fq": { name: "reno-fq", cc: "reno", qdisc: "fq" },
  "reno-fq_codel": {
    name: "reno-fq_codel",
    cc: "reno",
    qdisc: "fq_codel",
  },
  "cubic-fq": { name: "cubic-fq", cc: "cubic", qdisc: "fq" },
  "cubic-fq_codel": {
    name: "cubic-fq_codel",
    cc: "cubic",
    qdisc: "fq_codel",
  },
  "bbr-fq": { name: "bbr-fq", cc: "bbr", qdisc: "fq" },
  "bbr-fq_codel": {
    name: "bbr-fq_codel",
    cc: "bbr",
    qdisc: "fq_codel",
  },
};

export const parseProfile = (name) => {
  const profile = PROFILE_REGISTRY[name];
  if (!profile) throw new Error(`Unsupported profile: ${name}`);
  return profile;
};

export const estimateTransferBytes = ({
  profileCount,
  runs,
  downloadBytes,
  downloadCount,
  uploadBytes,
  uploadCount,
  warmup = true,
  warmupDownloadBytes = 10_000_000,
  warmupUploadBytes = 5_000_000,
}) => {
  const measuredPerProfile = runs * (
    downloadBytes * downloadCount + uploadBytes * uploadCount
  );
  const warmupPerProfile = warmup
    ? warmupDownloadBytes + warmupUploadBytes
    : 0;
  return profileCount * (measuredPerProfile + warmupPerProfile);
};

export const evaluateConfirmation = ({
  candidateProfile,
  currentProfile,
  decision,
  profileSummaries,
  runs,
  minScoreGap = 2,
  maxSpikeRuns = 1,
  maxLoadedLatencyMs = 250,
  backgroundTrafficPassed = true,
}) => {
  const candidate = profileSummaries.find(
    (item) => item.profile === candidateProfile
  );
  const current = profileSummaries.find(
    (item) => item.profile === currentProfile
  );
  const candidateRuns = runs.filter(
    (item) => item.profile === candidateProfile
  );
  const spikeRuns = candidateRuns.filter(
    (item) => Number(item.spike100Count) > 0
  ).length;
  const invalidProtocolRuns = runs.filter(
    (item) => !item.protocolValid
  ).length;
  const invalidRouteRuns = runs.filter(
    (item) => item.routeValidationStatus !== "pass"
  ).length;
  const excessiveLatencyRuns = candidateRuns.filter(
    (item) => Number(item.loadedLatencyMaxMs) > maxLoadedLatencyMs
  ).length;

  const reasons = [];
  if (!candidate || !current) reasons.push("Missing profile summary.");
  if (decision?.status !== "winner") {
    reasons.push(`Confirmation decision is ${decision?.status || "missing"}.`);
  }
  if (decision?.recommendedProfile !== candidateProfile) {
    reasons.push("The exploration winner did not win confirmation.");
  }
  if (!Number.isFinite(decision?.scoreGap) || decision.scoreGap < minScoreGap) {
    reasons.push(`Confirmation score gap is below ${minScoreGap.toFixed(2)}.`);
  }
  if (candidate && !candidate.eligible) reasons.push("Candidate is ineligible.");
  if (current && !current.eligible) reasons.push("Current profile is ineligible.");
  if (invalidProtocolRuns > 0) {
    reasons.push(`${invalidProtocolRuns} run(s) failed protocol validation.`);
  }
  if (invalidRouteRuns > 0) {
    reasons.push(
      `${invalidRouteRuns} run(s) failed traffic-path validation.`
    );
  }
  if (spikeRuns > maxSpikeRuns) {
    reasons.push(
      `Loaded-latency spikes occurred in ${spikeRuns} candidate run(s).`
    );
  }
  if (excessiveLatencyRuns > 0) {
    reasons.push(
      `${excessiveLatencyRuns} candidate run(s) exceeded `
      + `${maxLoadedLatencyMs} ms loaded latency.`
    );
  }
  if (!backgroundTrafficPassed) {
    reasons.push("The background traffic inspection did not pass.");
  }

  return {
    accepted: reasons.length === 0,
    candidateProfile,
    currentProfile,
    scoreGap: decision?.scoreGap ?? null,
    spikeRuns,
    invalidProtocolRuns,
    invalidRouteRuns,
    excessiveLatencyRuns,
    reasons,
  };
};
