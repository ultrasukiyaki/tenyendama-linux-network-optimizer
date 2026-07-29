import {
  coefficientOfVariation,
  decideProfiles,
  median,
  percentile,
  scoreProfiles,
} from "./stats.mjs";

const mbpsValues = (points) =>
  (Array.isArray(points) ? points : [])
    .map((point) => Number(point?.bps) / 1_000_000)
    .filter(Number.isFinite);

const latencyValues = (points) =>
  (Array.isArray(points) ? points : []).map(Number).filter(Number.isFinite);

export const runHasRequiredMetrics = (run) =>
  [
    run.downloadMedianMbps,
    run.downloadP05Mbps,
    run.uploadMedianMbps,
    run.uploadP05Mbps,
    run.unloadedLatencyMedianMs,
    run.loadedLatencyMedianMs,
    run.loadedLatencyP95Ms,
    run.loadedLatencyMaxMs,
  ].every((value) => Number.isFinite(value) && value > 0) &&
  [run.downloadCv, run.uploadCv].every(
    (value) => Number.isFinite(value) && value >= 0
  ) &&
  Number.isSafeInteger(run.spike100Count) &&
  run.spike100Count >= 0;

export const summarizeRun = (
  profile,
  raw,
  sequence,
  protocolRecords,
  { round = null, position = null } = {}
) => {
  const download = mbpsValues(raw.downloadPoints);
  const upload = mbpsValues(raw.uploadPoints);
  const downloadLoaded = latencyValues(raw.downloadLoadedLatencyPoints);
  const uploadLoaded = latencyValues(raw.uploadLoadedLatencyPoints);
  const loaded = [...downloadLoaded, ...uploadLoaded];
  const protocols = [
    ...new Set(protocolRecords.map((entry) => entry.protocol).filter(Boolean)),
  ];
  const hasQuic = protocols.some((protocol) =>
    /(?:^|\b)(?:h3|quic)(?:\b|$)/i.test(protocol)
  );

  return {
    sequence,
    round,
    position,
    profile: profile.name,
    congestionControl: profile.cc,
    qdisc: profile.qdisc,
    bufferProfile: profile.source || null,
    coreRmemMax: profile.buffers?.coreRmemMax ?? null,
    coreWmemMax: profile.buffers?.coreWmemMax ?? null,
    tcpRmemMin: profile.buffers?.tcpRmem?.[0] ?? null,
    tcpRmemDefault: profile.buffers?.tcpRmem?.[1] ?? null,
    tcpRmemMax: profile.buffers?.tcpRmem?.[2] ?? null,
    tcpWmemMin: profile.buffers?.tcpWmem?.[0] ?? null,
    tcpWmemDefault: profile.buffers?.tcpWmem?.[1] ?? null,
    tcpWmemMax: profile.buffers?.tcpWmem?.[2] ?? null,
    tcpModerateRcvbuf: profile.buffers?.tcpModerateRcvbuf ?? null,
    receiveBdpBytes: profile.receiveBdpBytes ?? null,
    sendBdpBytes: profile.sendBdpBytes ?? null,
    bufferFactor: profile.bufferFactor ?? null,
    bufferCapBytes: profile.bufferCapBytes ?? null,
    timestamp: raw.timestamp,
    protocols,
    protocolRecords,
    protocolValid: protocols.length > 0 && !hasQuic,
    downloadMedianMbps: median(download),
    downloadP05Mbps: percentile(download, 0.05),
    uploadMedianMbps: median(upload),
    uploadP05Mbps: percentile(upload, 0.05),
    unloadedLatencyMedianMs: median(latencyValues(raw.unloadedLatencyPoints)),
    loadedLatencyMedianMs: median(loaded),
    loadedLatencyP95Ms: percentile(loaded, 0.95),
    loadedLatencyMaxMs: loaded.length ? Math.max(...loaded) : null,
    spike100Count: loaded.filter((value) => value > 100).length,
    downloadCv: coefficientOfVariation(download),
    uploadCv: coefficientOfVariation(upload),
    raw,
  };
};

export const aggregateProfiles = (profiles, runs, mode) => {
  const aggregates = profiles.map((profile) => {
    const selected = runs.filter((run) => run.profile === profile.name);
    const protocols = [...new Set(selected.flatMap((run) => run.protocols))];
    const eligible = selected.length > 0 && selected.every((run) =>
      run.protocolValid &&
      run.routeValidationStatus === "pass" &&
      runHasRequiredMetrics(run) &&
      Number(run.loadedLatencyMaxMs) <= 250 &&
      Number(run.downloadCv) <= 0.35 &&
      Number(run.uploadCv) <= 0.35
    ) && selected.filter((run) => Number(run.spike100Count) > 0).length <= 1;

    const downloadCv = median(selected.map((run) => run.downloadCv));
    const uploadCv = median(selected.map((run) => run.uploadCv));
    const withinRunCv = median([downloadCv, uploadCv]);

    const downloadBetweenRunCv = coefficientOfVariation(
      selected.map((run) => run.downloadMedianMbps)
    );
    const uploadBetweenRunCv = coefficientOfVariation(
      selected.map((run) => run.uploadMedianMbps)
    );
    const betweenRunCv = median([
      downloadBetweenRunCv,
      uploadBetweenRunCv,
    ]);
    const stabilityCv = median([withinRunCv, betweenRunCv]);

    return {
      profile: profile.name,
      congestionControl: profile.cc,
      qdisc: profile.qdisc,
      bufferProfile: profile.source || null,
      buffers: profile.buffers || null,
      receiveBdpBytes: profile.receiveBdpBytes ?? null,
      sendBdpBytes: profile.sendBdpBytes ?? null,
      bufferFactor: profile.bufferFactor ?? null,
      bufferCapBytes: profile.bufferCapBytes ?? null,
      measuredRuns: selected.length,
      protocols,
      eligible,
      downloadMedianMbps: median(
        selected.map((run) => run.downloadMedianMbps)
      ),
      downloadP05Mbps: median(
        selected.map((run) => run.downloadP05Mbps)
      ),
      uploadMedianMbps: median(
        selected.map((run) => run.uploadMedianMbps)
      ),
      uploadP05Mbps: median(
        selected.map((run) => run.uploadP05Mbps)
      ),
      unloadedLatencyMedianMs: median(
        selected.map((run) => run.unloadedLatencyMedianMs)
      ),
      loadedLatencyMedianMs: median(
        selected.map((run) => run.loadedLatencyMedianMs)
      ),
      loadedLatencyP95Ms: median(
        selected.map((run) => run.loadedLatencyP95Ms)
      ),
      loadedLatencyMaxMs: Math.max(
        0,
        ...selected.map((run) => run.loadedLatencyMaxMs || 0)
      ),
      spike100Count: selected.reduce(
        (sum, run) => sum + run.spike100Count,
        0
      ),
      downloadCv,
      uploadCv,
      withinRunCv,
      downloadBetweenRunCv,
      uploadBetweenRunCv,
      betweenRunCv,
      stabilityCv,
    };
  });

  return scoreProfiles(aggregates, mode).sort((a, b) => b.score - a.score);
};

export { decideProfiles };

const csvEscape = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

export const buildCsv = (runs) => {
  const columns = [
    "sequence",
    "round",
    "position",
    "profile",
    "congestionControl",
    "qdisc",
    "bufferProfile",
    "coreRmemMax",
    "coreWmemMax",
    "tcpRmemMin",
    "tcpRmemDefault",
    "tcpRmemMax",
    "tcpWmemMin",
    "tcpWmemDefault",
    "tcpWmemMax",
    "tcpModerateRcvbuf",
    "receiveBdpBytes",
    "sendBdpBytes",
    "bufferFactor",
    "bufferCapBytes",
    "timestamp",
    "protocols",
    "protocolValid",
    "eligible",
    "exclusionReasons",
    "remoteIPs",
    "ipFamilies",
    "actualRoutingDevices",
    "actualPhysicalEgresses",
    "routeValidationStatus",
    "routeWarnings",
    "routeFailureReason",
    "downloadMedianMbps",
    "downloadP05Mbps",
    "uploadMedianMbps",
    "uploadP05Mbps",
    "unloadedLatencyMedianMs",
    "loadedLatencyMedianMs",
    "loadedLatencyP95Ms",
    "loadedLatencyMaxMs",
    "spike100Count",
    "downloadCv",
    "uploadCv",
  ];

  return [
    columns.join(","),
    ...runs.map((run) =>
      columns
        .map((column) =>
          csvEscape(
            ["protocols", "exclusionReasons", "remoteIPs", "ipFamilies",
              "actualRoutingDevices", "actualPhysicalEgresses",
              "routeWarnings"].includes(column)
              ? (run[column] || []).join("|") : run[column]
          )
        )
        .join(",")
    ),
  ].join("\n") + "\n";
};

const formatNumber = (value, digits = 2) =>
  Number.isFinite(value) ? value.toFixed(digits) : "n/a";

const formatPercent = (value) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "n/a";

const decisionText = (decision) => {
  switch (decision.status) {
    case "winner":
      return [
        `**Winner: \`${decision.recommendedProfile}\`**`,
        "",
        `Score gap: ${formatNumber(decision.scoreGap)} points `
        + `(required: ${formatNumber(decision.minScoreGap)}).`,
      ];
    case "retain-current":
      return [
        "**No clear winner — retain the current profile.**",
        "",
        `Recommended profile: \`${decision.recommendedProfile}\``,
        "",
        `The top-two score gap is only ${formatNumber(decision.scoreGap)} `
        + `points, below the ${formatNumber(decision.minScoreGap)}-point `
        + "automatic-change threshold.",
      ];
    case "statistical-tie":
      return [
        "**No clear winner — statistical tie.**",
        "",
        `Tied group: ${decision.tiedProfiles
          .map((profile) => `\`${profile}\``)
          .join(", ")}`,
        "",
        "No profile should be persisted automatically.",
      ];
    case "insufficient-runs":
      return [
        "**Smoke test completed, but there are not enough runs for a decision.**",
        "",
        decision.reason,
      ];
    case "single-candidate":
      return [
        `**Only one eligible candidate was tested: `
        + `\`${decision.recommendedProfile}\`.**`,
        "",
        "This is not an A/B comparison.",
      ];
    default:
      return [
        "**No eligible decision was produced.**",
        "",
        decision.reason,
      ];
  }
};

export const buildReport = ({
  environment,
  aggregates,
  runs,
  options,
  decision,
}) => {
  const lines = [
    "# Tenyendama Linux Network Optimizer — Benchmark Report",
    "",
    `- Product version: \`${environment.version}\``,
    `- Benchmark engine: \`${environment.benchmarkEngineVersion}\``,
    `- Routing interface: \`${environment.routingIface}\``,
    `- Physical egress: \`${environment.physicalIface}\``,
    `- Interface chain: \`${environment.interfaceChain.join(" → ")}\``,
    `- Original congestion control: \`${environment.originalCc}\``,
    `- Original qdisc: \`${environment.originalQdisc}\``,
    `- Current profile key: \`${environment.currentProfile}\``,
    `- Preset: \`${options.preset}\``,
    `- Requested mode: \`${options.requestedMode || options.mode}\``,
    `- Normalized mode: \`${options.mode}\``,
    `- Mode description: ${options.modeDescription || "n/a"}`,
    `- Scoring weights: \`${JSON.stringify(options.scoringWeights || {})}\``,
    "- Safety gates remain enabled in every scoring mode.",
    `- Random seed: \`${options.seed}\``,
    `- Automatic-change score gap: \`${formatNumber(options.minScoreGap)}\``,
    `- Test order: ${runs
      .map(
        (run) =>
          `R${run.round}P${run.position}:${run.profile}`
      )
      .join(" → ")}`,
    "",
    "## Profile summary",
    "",
    "| Rank | Profile | Score | Runs | Download median | Download p05 | Upload median | Upload p05 | Loaded p95 | Run-to-run CV | >100 ms | Protocol |",
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ];

  aggregates.forEach((item, index) => {
    lines.push(
      `| ${index + 1} | ${item.profile} | ${formatNumber(item.score)} | `
      + `${item.measuredRuns} | `
      + `${formatNumber(item.downloadMedianMbps)} Mbps | `
      + `${formatNumber(item.downloadP05Mbps)} Mbps | `
      + `${formatNumber(item.uploadMedianMbps)} Mbps | `
      + `${formatNumber(item.uploadP05Mbps)} Mbps | `
      + `${formatNumber(item.loadedLatencyP95Ms)} ms | `
      + `${formatPercent(item.betweenRunCv)} | `
      + `${item.spike100Count} | `
      + `${item.protocols.join(", ") || "unknown"} |`
    );
  });

  lines.push("", "## Decision", "", ...decisionText(decision));
  if (runs.some((run) => run.bufferProfile)) {
    lines.push(
      "", "## TCP buffer tuning", "",
      `- Receive BDP: \`${runs[0]?.receiveBdpBytes ?? "n/a"}\` bytes`,
      `- Send BDP: \`${runs[0]?.sendBdpBytes ?? "n/a"}\` bytes`,
      `- Candidate cap: \`${runs[0]?.bufferCapBytes ?? "n/a"}\` bytes`,
      "- `net.ipv4.tcp_mem` and `net.core.netdev_max_backlog` are diagnostic-only and were not changed.",
      "- Larger buffers do not guarantee better performance; all normal route, protocol, latency, stability, and confirmation gates still apply."
    );
  }

  const routingDevices = [...new Set(runs.flatMap((run) => run.actualRoutingDevices || []))];
  const physicalEgresses = [...new Set(runs.flatMap((run) => run.actualPhysicalEgresses || []))];
  const families = [...new Set(runs.flatMap((run) => run.ipFamilies || []))];
  const pathStatus = runs.length > 0 && runs.every(
    (run) => run.routeValidationStatus === "pass"
  ) ? "PASS" : runs.some((run) => run.routeValidationStatus === "fail")
    ? "FAIL" : "UNKNOWN";
  lines.push(
    "",
    "## Traffic path validation",
    "",
    `- Selected routing interface: \`${environment.routingIface}\``,
    `- Selected physical egress: \`${environment.physicalIface}\``,
    `- Observed routing devices: \`${routingDevices.join("`, `") || "unknown"}\``,
    `- Observed physical egresses: \`${physicalEgresses.join("`, `") || "unknown"}\``,
    `- IP families: \`${families.join("`, `") || "unknown"}\``,
    `- Validation: \`${pathStatus}\``
  );
  const excluded = runs.filter((run) => run.eligible === false);
  if (excluded.length) {
    lines.push("", "### Excluded runs", "");
    for (const run of excluded) {
      lines.push(
        `- Run ${run.sequence} (\`${run.profile}\`): `
        + `${(run.exclusionReasons || []).join(" ") || "Validation failed."}`
      );
    }
  }

  lines.push(
    "",
    `Decision status: \`${decision.status}\``,
    "",
    decision.reason,
    "",
    "The `benchmark` command does not persist a profile.",
    "",
    "## Validation notes",
    "",
    "- Protocol is captured from Chromium DevTools Protocol `Network.responseReceived` for Cloudflare `__down` and `__up` responses.",
    "- A run is ineligible when protocol capture fails, HTTP/3/QUIC is detected, or its physical traffic path cannot be verified.",
    "- Each profile receives one unscored warm-up before measured runs unless `--no-warmup` is specified.",
    "- Test order uses a seeded Latin-square rotation so each profile occupies each position equally when the run count matches the profile count.",
    "- Stability combines variation inside each speed-test run with variation between repeated profile runs.",
    "- A score lead below the configured threshold is treated as a tie; when the current profile is tied, the tool retains it.",
    "- Quick preset is a smoke test. At least three measured runs per profile are required for an automatic recommendation.",
    "- Cloudflare path and edge selection can vary over time. Re-run at another time before making a permanent system change.",
    ""
  );

  return lines.join("\n");
};
