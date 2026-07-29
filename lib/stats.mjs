export const finiteNumbers = (values) =>
  values.map(Number).filter(Number.isFinite);

export const percentile = (values, ratio) => {
  const numbers = finiteNumbers(values).sort((a, b) => a - b);
  if (numbers.length === 0) return null;

  const position = (numbers.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return numbers[lower];

  const weight = position - lower;
  return numbers[lower] * (1 - weight) + numbers[upper] * weight;
};

export const median = (values) => percentile(values, 0.5);

export const average = (values) => {
  const numbers = finiteNumbers(values);
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
};

export const coefficientOfVariation = (values) => {
  const numbers = finiteNumbers(values);
  if (numbers.length < 2) return 0;
  const mean = average(numbers);
  if (!mean) return null;
  const variance =
    numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    numbers.length;
  return Math.sqrt(variance) / mean;
};

export const createSeededRandom = (seed) => {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

export const shuffled = (items, random) => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
};

const rotate = (items, offset) => {
  if (items.length === 0) return [];
  const normalized = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(normalized), ...items.slice(0, normalized)];
};

/**
 * Position-balanced seeded order.
 *
 * For N profiles, every block of N rounds is a randomized Latin square:
 * each profile appears once in every test position. Alternate squares reverse
 * the base sequence to reduce first-order carry-over bias.
 */
export const balancedOrder = (profiles, runs, seed) => {
  if (profiles.length === 0 || runs <= 0) return [];

  const random = createSeededRandom(seed);
  const base = shuffled(profiles, random);
  const order = [];
  const profileCount = profiles.length;

  for (let roundIndex = 0; roundIndex < runs; roundIndex += 1) {
    const squareIndex = Math.floor(roundIndex / profileCount);
    const rotationIndex = roundIndex % profileCount;
    const squareBase =
      squareIndex % 2 === 0 ? base : [...base].reverse();
    const block = rotate(squareBase, rotationIndex);
    order.push(...block);
  }

  return order;
};

const ratioHigher = (value, best) =>
  Number.isFinite(value) && Number.isFinite(best) && best > 0
    ? Math.max(0, Math.min(1, value / best))
    : 0;

const ratioLower = (value, best) =>
  Number.isFinite(value) && Number.isFinite(best) && value > 0
    ? Math.max(0, Math.min(1, best / value))
    : 0;

export const MODE_REGISTRY = {
    balanced: {
      downloadMedianMbps: 0.22,
      uploadMedianMbps: 0.18,
      downloadP05Mbps: 0.10,
      uploadP05Mbps: 0.10,
      loadedLatencyMedianMs: 0.10,
      loadedLatencyP95Ms: 0.22,
      stability: 0.05,
      spikes: 0.03,
    },
    download: {
      downloadMedianMbps: 0.42,
      downloadP05Mbps: 0.28,
      loadedLatencyP95Ms: 0.18,
      stability: 0.08,
      spikes: 0.04,
    },
    upload: {
      uploadMedianMbps: 0.42,
      uploadP05Mbps: 0.28,
      loadedLatencyP95Ms: 0.18,
      stability: 0.08,
      spikes: 0.04,
    },
    latency: {
      loadedLatencyMedianMs: 0.34,
      loadedLatencyP95Ms: 0.44,
      stability: 0.08,
      spikes: 0.14,
    },
    streaming: {
      uploadP05Mbps: 0.30,
      uploadMedianMbps: 0.14,
      downloadP05Mbps: 0.12,
      loadedLatencyP95Ms: 0.24,
      stability: 0.14,
      spikes: 0.06,
    },
    highperformance: {
      downloadMedianMbps: 0.32,
      uploadMedianMbps: 0.23,
      downloadP05Mbps: 0.14,
      uploadP05Mbps: 0.11,
      loadedLatencyMedianMs: 0.04,
      loadedLatencyP95Ms: 0.08,
      stability: 0.06,
      spikes: 0.02,
    },
};

export const MODE_DESCRIPTIONS = {
  balanced: "Balances throughput, latency, and stability.",
  download: "Prioritizes download throughput.",
  upload: "Prioritizes upload throughput.",
  latency: "Prioritizes low loaded latency.",
  streaming: "Prioritizes sustained upload and stability.",
  highperformance: "Strongly prioritizes throughput while retaining all safety gates.",
};

export const normalizeMode = (mode) => {
  const requested = String(mode);
  const normalized = requested.toLowerCase();
  const alias = { "high-performance": "highperformance", performance: "highperformance" };
  const result = alias[normalized] || normalized;
  if (!MODE_REGISTRY[result]) {
    throw new Error(`unknown mode "${requested}"\n\nAvailable modes:\n  ${Object.keys(MODE_REGISTRY).join("\n  ")}`);
  }
  return result;
};

export const scoreProfiles = (aggregates, mode) => {

  const weights = MODE_REGISTRY[normalizeMode(mode)];
  const eligible = aggregates.filter((item) => item.eligible);
  if (eligible.length === 0) {
    return aggregates.map((item) => ({ ...item, score: 0 }));
  }

  const max = (key) => Math.max(...eligible.map((item) => item[key] || 0));
  const minPositive = (key) => {
    const values = eligible
      .map((item) => item[key])
      .filter((value) => Number.isFinite(value) && value > 0);
    return values.length ? Math.min(...values) : null;
  };

  const best = {
    downloadMedianMbps: max("downloadMedianMbps"),
    uploadMedianMbps: max("uploadMedianMbps"),
    downloadP05Mbps: max("downloadP05Mbps"),
    uploadP05Mbps: max("uploadP05Mbps"),
    loadedLatencyMedianMs: minPositive("loadedLatencyMedianMs"),
    loadedLatencyP95Ms: minPositive("loadedLatencyP95Ms"),
    stability: minPositive("stabilityCv"),
    spikes: Math.min(...eligible.map((item) => item.spike100Count)),
  };

  return aggregates.map((item) => {
    if (!item.eligible) return { ...item, score: 0, scoreComponents: {} };

    const components = {
      downloadMedianMbps: ratioHigher(
        item.downloadMedianMbps,
        best.downloadMedianMbps
      ),
      uploadMedianMbps: ratioHigher(
        item.uploadMedianMbps,
        best.uploadMedianMbps
      ),
      downloadP05Mbps: ratioHigher(
        item.downloadP05Mbps,
        best.downloadP05Mbps
      ),
      uploadP05Mbps: ratioHigher(
        item.uploadP05Mbps,
        best.uploadP05Mbps
      ),
      loadedLatencyMedianMs: ratioLower(
        item.loadedLatencyMedianMs,
        best.loadedLatencyMedianMs
      ),
      loadedLatencyP95Ms: ratioLower(
        item.loadedLatencyP95Ms,
        best.loadedLatencyP95Ms
      ),
      stability:
        item.stabilityCv === 0 && best.stability === null
          ? 1
          : ratioLower(
              item.stabilityCv || 0.000001,
              best.stability || 0.000001
            ),
      spikes: 1 / (1 + Math.max(0, item.spike100Count - best.spikes)),
    };

    const score = Object.entries(weights).reduce(
      (sum, [key, weight]) => sum + (components[key] || 0) * weight,
      0
    );

    return {
      ...item,
      score: score * 100,
      scoreComponents: components,
    };
  });
};

export const decideProfiles = (
  aggregates,
  {
    currentProfile = null,
    minScoreGap = 2,
    minRuns = 3,
  } = {}
) => {
  const eligible = aggregates
    .filter((item) => item.eligible)
    .sort((a, b) => b.score - a.score);

  if (eligible.length === 0) {
    return {
      status: "no-eligible-profile",
      recommendedProfile: null,
      topProfile: null,
      runnerUpProfile: null,
      scoreGap: null,
      minScoreGap,
      minRuns,
      tiedProfiles: [],
      reason:
        "No profile passed every protocol, route, latency, spike, and "
        + "variability safety gate.",
    };
  }

  const top = eligible[0];
  const runnerUp = eligible[1] || null;
  const minimumMeasuredRuns = Math.min(
    ...eligible.map((item) => item.measuredRuns)
  );

  if (minimumMeasuredRuns < minRuns) {
    const current = eligible.find(
      (item) => item.profile === currentProfile
    );
    return {
      status: "insufficient-runs",
      recommendedProfile: current?.profile || null,
      topProfile: top.profile,
      runnerUpProfile: runnerUp?.profile || null,
      scoreGap: runnerUp ? top.score - runnerUp.score : null,
      minScoreGap,
      minRuns,
      tiedProfiles: [],
      reason:
        `At least ${minRuns} measured runs per profile are required; `
        + `only ${minimumMeasuredRuns} were available.`,
    };
  }

  if (!runnerUp) {
    return {
      status: "single-candidate",
      recommendedProfile: top.profile,
      topProfile: top.profile,
      runnerUpProfile: null,
      scoreGap: null,
      minScoreGap,
      minRuns,
      tiedProfiles: [top.profile],
      reason: "Only one eligible profile was tested.",
    };
  }

  const scoreGap = top.score - runnerUp.score;
  const tied = eligible.filter(
    (item) => top.score - item.score < minScoreGap
  );
  const currentInTie = tied.find(
    (item) => item.profile === currentProfile
  );

  if (scoreGap < minScoreGap) {
    return {
      status: currentInTie ? "retain-current" : "statistical-tie",
      recommendedProfile: currentInTie?.profile || null,
      topProfile: top.profile,
      runnerUpProfile: runnerUp.profile,
      scoreGap,
      minScoreGap,
      minRuns,
      tiedProfiles: tied.map((item) => item.profile),
      reason: currentInTie
        ? `The score gap is below ${minScoreGap.toFixed(2)} points; `
          + `retain the current profile because it is in the tied group.`
        : `The score gap is below ${minScoreGap.toFixed(2)} points; `
          + "no automatic winner is declared.",
    };
  }

  return {
    status: "winner",
    recommendedProfile: top.profile,
    topProfile: top.profile,
    runnerUpProfile: runnerUp.profile,
    scoreGap,
    minScoreGap,
    minRuns,
    tiedProfiles: [top.profile],
    reason:
      `The leading profile exceeds the runner-up by `
      + `${scoreGap.toFixed(2)} points.`,
  };
};
