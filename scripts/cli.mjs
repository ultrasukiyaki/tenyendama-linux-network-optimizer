import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  detectRoutingInterface,
  qdiscKind,
  resolvePhysicalEgress,
} from "../lib/network.mjs";
import {
  estimateTransferBytes,
  evaluateConfirmation,
  parseProfile,
} from "../lib/optimizer.mjs";
import { MODE_DESCRIPTIONS, MODE_REGISTRY, normalizeMode } from "../lib/stats.mjs";
import { generateBufferCandidates, MIB } from "../lib/tcp-buffer.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const benchmarkScript = join(projectRoot, "scripts", "benchmark.mjs");
const helper = join(projectRoot, "bin", "tenyendama-netopt-helper");
const resultsRoot = join(projectRoot, "results");
const PRESET_TRANSFER = {
  quick: {
    runs: 1,
    downloadBytes: 25_000_000,
    downloadCount: 2,
    uploadBytes: 10_000_000,
    uploadCount: 2,
  },
  standard: {
    runs: 3,
    downloadBytes: 100_000_000,
    downloadCount: 3,
    uploadBytes: 50_000_000,
    uploadCount: 3,
  },
  confirmation: {
    runs: 4,
    downloadBytes: 50_000_000,
    downloadCount: 2,
    uploadBytes: 25_000_000,
    uploadCount: 2,
  },
  deep: {
    runs: 5,
    downloadBytes: 100_000_000,
    downloadCount: 5,
    uploadBytes: 50_000_000,
    uploadCount: 5,
  },
};

const run = (command, args, { capture = false, allowFailure = false } = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      const result = { code, signal, stdout, stderr };
      if (code === 0 || allowFailure) return resolvePromise(result);
      rejectPromise(new Error(
        `${command} ${args.join(" ")} failed with ${code ?? signal}\n${stdout}${stderr}`.trim()
      ));
    });
  });

const commandText = async (command, args) =>
  (await run(command, args, { capture: true })).stdout.trim();

const timestampName = () =>
  new Date().toISOString().replaceAll(":", "").replaceAll("-", "")
    .replace(/\.\d{3}Z$/, "Z");

const pathExists = async (path) => {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
};

const formatBytes = (bytes) => {
  const gib = bytes / 1024 ** 3;
  return gib >= 1 ? `${gib.toFixed(2)} GiB` : `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
};

const askYesNo = async (question, defaultNo = true) => {
  if (!input.isTTY || !output.isTTY) return false;
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} ${defaultNo ? "[y/N]" : "[Y/n]"}: `))
      .trim().toLowerCase();
    if (!answer) return !defaultNo;
    return answer === "y" || answer === "yes";
  } finally { rl.close(); }
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const writeOptimizationReport = async (sessionDir, {
  options,
  currentProfile,
  finalProfileName,
  explorationDecision,
  confirmationDecision,
  evaluation,
  bufferGeneration,
  bufferExplorationDecision,
  bufferConfirmationDecision,
  bufferEvaluation,
  persistenceStatus,
}) => {
  const decisionLine = (label, decision) =>
    `- ${label}: \`${decision?.status || "not-run"}\``
    + `${decision?.recommendedProfile ? ` → \`${decision.recommendedProfile}\`` : ""}`;
  const lines = [
    "# Tenyendama Linux Network Optimizer — Optimization Report",
    "",
    `- Requested mode: \`${options.requestedMode}\``,
    `- Normalized mode: \`${options.mode}\``,
    `- Mode description: ${options.modeDescription}`,
    `- Starting profile: \`${currentProfile}\``,
    `- Final candidate: \`${finalProfileName}\``,
    `- Persistence: \`${persistenceStatus}\``,
    "- All route, protocol, latency, spike, variability, confirmation, and restoration safety gates remained enabled.",
    "",
    "## CC and qdisc",
    "",
    decisionLine("Exploration", explorationDecision),
    decisionLine("Confirmation", confirmationDecision),
    `- Confirmation accepted: \`${Boolean(evaluation?.accepted)}\``,
  ];
  if (evaluation?.reasons?.length) {
    lines.push(...evaluation.reasons.map((reason) => `- Reason: ${reason}`));
  }
  lines.push(
    "",
    "## TCP buffer tuning",
    "",
    `- Requested: \`${options.tuneBuffers}\``,
    `- Candidate generation: \`${bufferGeneration?.skipped ? "skipped" : bufferGeneration ? "completed" : "not-run"}\``,
  );
  if (bufferGeneration?.reason) lines.push(`- Generation/skip reason: ${bufferGeneration.reason}`);
  if (bufferGeneration) {
    lines.push(
      `- Receive BDP: \`${bufferGeneration.receiveBdpBytes ?? "n/a"}\` bytes`,
      `- Send BDP: \`${bufferGeneration.sendBdpBytes ?? "n/a"}\` bytes`,
      `- Buffer cap: \`${bufferGeneration.bufferCapBytes ?? "n/a"}\` bytes`,
      `- Candidates: ${(bufferGeneration.candidates || []).map((item) =>
        `\`${item.name}\``).join(", ") || "none"}`,
    );
  }
  lines.push(
    decisionLine("Buffer exploration", bufferExplorationDecision),
    decisionLine("Buffer confirmation", bufferConfirmationDecision),
    `- Buffer confirmation accepted: \`${Boolean(bufferEvaluation?.accepted)}\``,
  );
  if (bufferEvaluation?.reasons?.length) {
    lines.push(...bufferEvaluation.reasons.map((reason) => `- Reason: ${reason}`));
  }
  lines.push(
    "",
    "## Unchanged diagnostic settings",
    "",
    "- `net.ipv4.tcp_mem` was not changed.",
    "- `net.core.netdev_max_backlog` was not changed.",
    "- Larger TCP buffers do not guarantee better performance.",
    "",
  );
  await writeFile(join(sessionDir, "optimization-report.md"), lines.join("\n"));
};

const benchmarkArgsFromOptimize = (options, outputDir, profiles, preset, seed, profileFile = null) => {
  const args = [
    benchmarkScript,
    "--iface", options.iface,
    "--preset", preset,
    "--mode", options.mode,
    "--min-score-gap", String(options.minScoreGap),
    "--seed", String(seed >>> 0),
    "--output-dir", outputDir,
  ];
  args.push(profileFile ? "--profile-file" : "--profiles", profileFile || profiles.join(","));
  if (preset === "confirmation") args.push("--min-decision-runs", "4");
  if (options.headed) args.push("--headed");
  if (options.backgroundAction) {
    args.push("--background-action", options.backgroundAction);
  }
  if (options.backgroundThreshold !== null) {
    args.push("--background-threshold", String(options.backgroundThreshold));
  }
  return args;
};

const parseOptimizeArgs = (argv) => {
  const options = {
    iface: "auto",
    preset: "standard",
    mode: "balanced",
    profiles: ["cubic-fq", "bbr-fq", "cubic-fq_codel"],
    minScoreGap: 2,
    headed: false,
    yes: false,
    seed: Date.now() >>> 0,
    backgroundAction: "prompt",
    backgroundThreshold: null,
    tuneBuffers: false,
    bufferCapMiB: null,
  };
  const need = (arg, value) => {
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--iface": options.iface = need(arg, next); index += 1; break;
      case "--preset": options.preset = need(arg, next); index += 1; break;
      case "--mode": options.mode = need(arg, next); index += 1; break;
      case "--profiles": options.profiles = need(arg, next).split(","); index += 1; break;
      case "--min-score-gap": options.minScoreGap = Number(need(arg, next)); index += 1; break;
      case "--seed": options.seed = Number(need(arg, next)) >>> 0; index += 1; break;
      case "--background-action": options.backgroundAction = need(arg, next); index += 1; break;
      case "--background-threshold": options.backgroundThreshold = Number(need(arg, next)); index += 1; break;
      case "--headed": options.headed = true; break;
      case "--yes": options.yes = true; break;
      case "--tune-buffers": options.tuneBuffers = true; break;
      case "--buffer-cap-mib":
        options.bufferCapMiB = Number(need(arg, next)); index += 1; break;
      case "--help": options.help = true; break;
      default: throw new Error(`Unknown optimize option: ${arg}`);
    }
  }
  if (!Number.isFinite(options.minScoreGap) || options.minScoreGap < 0) {
    throw new Error("--min-score-gap must be zero or greater");
  }
  if (!["quick", "standard", "deep"].includes(options.preset)) {
    throw new Error("optimize supports quick, standard, or deep presets");
  }
  options.requestedMode = options.mode;
  options.mode = normalizeMode(options.mode);
  options.modeDescription = MODE_DESCRIPTIONS[options.mode];
  options.scoringWeights = MODE_REGISTRY[options.mode];
  if (options.bufferCapMiB !== null &&
      (!Number.isInteger(options.bufferCapMiB) || options.bufferCapMiB < 4 || options.bufferCapMiB > 256)) {
    throw new Error("--buffer-cap-mib must be an integer from 4 through 256.");
  }
  if (options.bufferCapMiB !== null && !options.tuneBuffers) {
    throw new Error("--buffer-cap-mib requires --tune-buffers");
  }
  for (const profile of options.profiles) parseProfile(profile);
  return options;
};

const findReports = async (directory) => {
  if (!(await pathExists(directory))) return [];
  const results = [];
  const walk = async (path) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && entry.name === "report.md") {
        results.push({ path: child, mtimeMs: (await stat(child)).mtimeMs });
      }
    }
  };
  await walk(directory);
  return results.sort((a, b) => b.mtimeMs - a.mtimeMs);
};

const showStatus = async () => {
  const routingIface = await detectRoutingInterface();
  const resolved = await resolvePhysicalEgress(routingIface);
  const physicalIface = resolved.physicalIface;
  const cc = await commandText("sysctl", ["-n", "net.ipv4.tcp_congestion_control"]);
  const qdisc = await qdiscKind(physicalIface);
  const sysctl = async (key) => {
    const result = await run("sysctl", ["-n", key], {
      capture: true,
      allowFailure: true,
    });
    return result.code === 0 ? result.stdout.trim() : "unavailable";
  };
  const effective = {
    coreRmemMax: await sysctl("net.core.rmem_max"),
    coreWmemMax: await sysctl("net.core.wmem_max"),
    tcpRmem: await sysctl("net.ipv4.tcp_rmem"),
    tcpWmem: await sysctl("net.ipv4.tcp_wmem"),
    tcpMem: await sysctl("net.ipv4.tcp_mem"),
    moderateRcvbuf: await sysctl("net.ipv4.tcp_moderate_rcvbuf"),
    windowScaling: await sysctl("net.ipv4.tcp_window_scaling"),
  };
  console.log(`Routing interface : ${routingIface}`);
  console.log(`Physical egress   : ${physicalIface}`);
  console.log(`Interface chain   : ${resolved.chain.join(" -> ")}`);
  console.log(`Active profile    : ${cc}-${qdisc}`);
  console.log(`core_rmem_max     : ${effective.coreRmemMax}`);
  console.log(`core_wmem_max     : ${effective.coreWmemMax}`);
  console.log(`tcp_rmem          : ${effective.tcpRmem}`);
  console.log(`tcp_wmem          : ${effective.tcpWmem}`);
  console.log(`tcp_mem           : ${effective.tcpMem} (diagnostic-only)`);
  console.log(`moderate_rcvbuf   : ${effective.moderateRcvbuf}`);
  console.log(`window_scaling    : ${effective.windowScaling} (diagnostic-only)`);
  const envPath = "/etc/tenyendama-netopt/current.env";
  if (await pathExists(envPath)) {
    const managedText = await readFile(envPath, "utf8");
    const managed = Object.fromEntries(managedText.split("\n").flatMap((line) => {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) return [];
      return [[match[1], match[2]
        .replace(/^'(.*)'$/, "$1")
        .replace(/^"(.*)"$/, "$1")
        .replaceAll("\\ ", " ")]];
    }));
    const normalizeVector = (value) => value?.trim().replace(/\s+/g, " ");
    const comparisons = [
      ["CC", managed.TENYENDAMA_CC, cc],
      ["qdisc", managed.TENYENDAMA_QDISC, qdisc],
      ["core_rmem_max", managed.TENYENDAMA_CORE_RMEM_MAX, effective.coreRmemMax],
      ["core_wmem_max", managed.TENYENDAMA_CORE_WMEM_MAX, effective.coreWmemMax],
      ["tcp_rmem", normalizeVector(managed.TENYENDAMA_TCP_RMEM), normalizeVector(effective.tcpRmem)],
      ["tcp_wmem", normalizeVector(managed.TENYENDAMA_TCP_WMEM), normalizeVector(effective.tcpWmem)],
      ["tcp_moderate_rcvbuf", managed.TENYENDAMA_TCP_MODERATE_RCVBUF, effective.moderateRcvbuf],
    ].filter(([, expected]) => expected !== undefined);
    const mismatches = comparisons.filter(([, expected, actual]) => expected !== actual);
    console.log("Managed profile   : yes");
    console.log(`Managed match     : ${mismatches.length ? "MISMATCH" : "yes"}`);
    for (const [name, expected, actual] of mismatches) {
      console.log(`  ${name}: managed=${expected} effective=${actual}`);
    }
    console.log(managedText);
  } else {
    console.log("Managed profile   : no");
  }
};

const optimize = async (argv) => {
  const options = parseOptimizeArgs(argv);
  if (options.help) { console.log(helpText.trim()); return; }
  const approximateExploration = estimateTransferBytes({
    profileCount: options.profiles.length,
    ...PRESET_TRANSFER[options.preset],
  });
  const approximateConfirmation = estimateTransferBytes({
    profileCount: 2,
    ...PRESET_TRANSFER.confirmation,
  });
  console.log("Tenyendama Linux Network Optimizer v3.1.0");
  console.log(`Exploration profiles: ${options.profiles.join(", ")}`);
  console.log(
    `Estimated maximum transfer: ${formatBytes(approximateExploration + approximateConfirmation)}`
  );
  console.log("No permanent change is made until both benchmark stages pass and you approve it.");
  if (!options.yes && !(await askYesNo("Start exploration and confirmation tests?"))) {
    console.log("Cancelled.");
    return;
  }

  const sessionDir = join(resultsRoot, "optimize", timestampName());
  const explorationDir = join(sessionDir, "exploration");
  const confirmationDir = join(sessionDir, "confirmation");
  await mkdir(explorationDir, { recursive: true });

  console.log("\n=== Stage 1/2: exploration ===");
  await run(process.execPath, benchmarkArgsFromOptimize(
    options, explorationDir, options.profiles, options.preset, options.seed
  ));
  const explorationDecision = await readJson(join(explorationDir, "decision.json"));
  const explorationSummary = await readJson(join(explorationDir, "summary.json"));
  const explorationEnvironment = await readJson(join(explorationDir, "environment.json"));
  const currentProfile = explorationEnvironment.currentProfile;
  const candidateProfile = explorationDecision.recommendedProfile;

  if (explorationDecision.status !== "winner" && !options.tuneBuffers) {
    await writeOptimizationReport(sessionDir, {
      options, currentProfile,
      finalProfileName: currentProfile,
      explorationDecision,
      confirmationDecision: null,
      evaluation: null,
      bufferGeneration: null,
      bufferExplorationDecision: null,
      bufferConfirmationDecision: null,
      bufferEvaluation: null,
      persistenceStatus: "not-eligible",
    });
    console.log(`\nNo persistent change: exploration status is ${explorationDecision.status}.`);
    console.log(`Report: ${join(explorationDir, "report.md")}`);
    return;
  }
  if ((!candidateProfile || candidateProfile === currentProfile) && !options.tuneBuffers) {
    await writeOptimizationReport(sessionDir, {
      options, currentProfile,
      finalProfileName: currentProfile,
      explorationDecision,
      confirmationDecision: null,
      evaluation: null,
      bufferGeneration: null,
      bufferExplorationDecision: null,
      bufferConfirmationDecision: null,
      bufferEvaluation: null,
      persistenceStatus: "not-needed",
    });
    console.log("\nThe current profile already won. No persistent change is needed.");
    return;
  }
  parseProfile(currentProfile);
  const ccCandidateProfile = explorationDecision.status === "winner" &&
    candidateProfile && candidateProfile !== currentProfile ? candidateProfile : currentProfile;
  parseProfile(ccCandidateProfile);

  let confirmationSummary = null;
  let evaluation;
  if (ccCandidateProfile === currentProfile) {
    const baseline = explorationSummary.profiles.find(
      (item) => item.profile === currentProfile
    );
    evaluation = {
      accepted: Boolean(baseline?.eligible),
      candidateProfile: currentProfile,
      currentProfile,
      scoreGap: 0,
      reasons: baseline?.eligible
        ? []
        : ["The current-profile exploration baseline is ineligible."],
      confirmationSkipped: true,
      reason: "CC/qdisc confirmation is unnecessary because no different candidate was selected.",
    };
    console.log(
      "\nCC/qdisc confirmation skipped: no different CC/qdisc candidate was selected."
    );
  } else {
    await mkdir(confirmationDir, { recursive: true });
    console.log("\n=== Stage 2/2: confirmation against current profile ===");
    await run(process.execPath, benchmarkArgsFromOptimize(
      options,
      confirmationDir,
      [currentProfile, ccCandidateProfile],
      "confirmation",
      options.seed ^ 0x9e3779b9
    ));

    confirmationSummary = await readJson(join(confirmationDir, "summary.json"));
    const confirmationRuns = await readJson(join(confirmationDir, "raw-results.json"));
    const confirmationEnvironment = await readJson(
      join(confirmationDir, "environment.json")
    );
    evaluation = evaluateConfirmation({
      candidateProfile: ccCandidateProfile,
      currentProfile,
      decision: confirmationSummary.decision,
      profileSummaries: confirmationSummary.profiles,
      runs: confirmationRuns,
      minScoreGap: options.minScoreGap,
      backgroundTrafficPassed: [
        ...(explorationEnvironment.backgroundChecks || []),
        ...(confirmationEnvironment.backgroundChecks || []),
      ].every((check) => check.passed),
    });
  }
  await writeFile(join(sessionDir, "optimization-decision.json"), JSON.stringify({
    explorationDecision,
    confirmationDecision: confirmationSummary?.decision || null,
    evaluation,
  }, null, 2));

  if (!evaluation.accepted && !options.tuneBuffers) {
    await writeOptimizationReport(sessionDir, {
      options, currentProfile,
      finalProfileName: currentProfile,
      explorationDecision,
      confirmationDecision: confirmationSummary?.decision || null,
      evaluation,
      bufferGeneration: null,
      bufferExplorationDecision: null,
      bufferConfirmationDecision: null,
      bufferEvaluation: null,
      persistenceStatus: "confirmation-rejected",
    });
    console.log("\nNo profile will be persisted.");
    console.log("\nReason:");
    for (const reason of evaluation.reasons) console.log(`- ${reason}`);
    console.log(`Current profile retained: ${currentProfile}`);
    return;
  }

  const selectedProfile = evaluation.accepted ? ccCandidateProfile : currentProfile;
  let candidate = parseProfile(selectedProfile);
  let finalProfileName = selectedProfile;
  let finalBuffers = null;
  let finalEvaluation = evaluation;
  let bufferGeneration = null;
  let bufferExplorationDecision = null;
  let bufferConfirmationDecision = null;
  let bufferEvaluation = null;
  if (options.tuneBuffers) {
    const snapshot = explorationEnvironment.snapshot?.tcpBuffers;
    const selectedSummary = confirmationSummary?.profiles.find(
      (item) => item.profile === selectedProfile
    ) || explorationSummary.profiles.find((item) => item.profile === selectedProfile);
    const unsafeReason = snapshot?.tcpWindowScaling !== 1
      ? "tcp_window_scaling is not enabled"
      : !selectedSummary ? "the selected baseline summary is missing"
        : !selectedSummary.eligible
          ? "the baseline failed a route, protocol, latency, spike, or variability safety gate"
          : null;
    let generated = { skipped: true, reason: unsafeReason || "required buffer data is unavailable" };
    if (!unsafeReason && snapshot?.memTotalBytes && selectedSummary) {
      try {
        generated = generateBufferCandidates({
          snapshot, cc: candidate.cc, qdisc: candidate.qdisc,
          downloadMedianMbps: selectedSummary.downloadMedianMbps,
          uploadMedianMbps: selectedSummary.uploadMedianMbps,
          unloadedLatencyMedianMs: selectedSummary.unloadedLatencyMedianMs,
          memTotalBytes: snapshot.memTotalBytes,
          bufferCapBytes: options.bufferCapMiB === null ? undefined : options.bufferCapMiB * MIB,
        });
      } catch (error) {
        generated = {
          skipped: true,
          reason: `invalid or missing BDP input: ${error.message}`,
          candidates: [],
        };
      }
    }
    bufferGeneration = generated;
    await writeFile(join(sessionDir, "buffer-candidates.json"),
      JSON.stringify(generated, null, 2));
    if (!generated.skipped) {
      const bufferDir = join(sessionDir, "buffer-exploration");
      const profileFile = join(sessionDir, "buffer-profiles.json");
      await mkdir(bufferDir, { recursive: true });
      await writeFile(profileFile, JSON.stringify(generated.candidates, null, 2));
      console.log("\n=== TCP buffer exploration (opt-in) ===");
      await run(process.execPath, benchmarkArgsFromOptimize(
        options, bufferDir, [], options.preset, options.seed ^ 0x51ed270b, profileFile
      ));
      const bufferSummary = await readJson(join(bufferDir, "summary.json"));
      const bufferDecision = bufferSummary.decision;
      bufferExplorationDecision = bufferDecision;
      if (bufferDecision.status === "winner" &&
          bufferDecision.recommendedProfile !== generated.candidates[0].name) {
        const chosen = generated.candidates.find((item) =>
          item.name === bufferDecision.recommendedProfile);
        if (chosen) {
          const bufferConfirmationDir = join(sessionDir, "buffer-confirmation");
          const confirmationFile = join(sessionDir, "buffer-confirmation-profiles.json");
          await mkdir(bufferConfirmationDir, { recursive: true });
          await writeFile(confirmationFile, JSON.stringify([
            generated.candidates[0], chosen,
          ], null, 2));
          console.log("\n=== TCP buffer confirmation ===");
          await run(process.execPath, benchmarkArgsFromOptimize(
            options, bufferConfirmationDir, [], "confirmation",
            options.seed ^ 0xa54ff53a, confirmationFile
          ));
          const bufferConfirmation = await readJson(
            join(bufferConfirmationDir, "summary.json")
          );
          const bufferConfirmationEnvironment = await readJson(
            join(bufferConfirmationDir, "environment.json")
          );
          const bufferExplorationEnvironment = await readJson(
            join(bufferDir, "environment.json")
          );
          const bufferRuns = await readJson(
            join(bufferConfirmationDir, "raw-results.json")
          );
          bufferEvaluation = evaluateConfirmation({
            candidateProfile: chosen.name,
            currentProfile: generated.candidates[0].name,
            decision: bufferConfirmation.decision,
            profileSummaries: bufferConfirmation.profiles,
            runs: bufferRuns,
            minScoreGap: options.minScoreGap,
            backgroundTrafficPassed: [
              ...(bufferExplorationEnvironment.backgroundChecks || []),
              ...(bufferConfirmationEnvironment.backgroundChecks || []),
            ].every((check) => check.passed),
          });
          bufferConfirmationDecision = bufferConfirmation.decision;
          if (bufferEvaluation.accepted) {
            finalProfileName = chosen.name;
            finalBuffers = chosen.buffers;
            candidate = chosen;
            finalEvaluation = bufferEvaluation;
          } else {
            console.log("TCP buffer candidate did not pass confirmation; current buffers retained.");
            for (const reason of bufferEvaluation.reasons) {
              console.log(`- ${reason}`);
            }
          }
        }
      }
    } else {
      console.log(`\nTCP buffer tuning skipped safely: ${generated.reason}`);
    }
  }
  if (finalProfileName === currentProfile && finalBuffers === null) {
    await writeOptimizationReport(sessionDir, {
      options, currentProfile, finalProfileName, explorationDecision,
      confirmationDecision: confirmationSummary?.decision || null,
      evaluation, bufferGeneration, bufferExplorationDecision,
      bufferConfirmationDecision, bufferEvaluation,
      persistenceStatus: "not-needed",
    });
    console.log(
      "\nNo persistent change is needed: CC, qdisc, and TCP buffers "
      + "all remain at their starting values."
    );
    console.log(`Reports: ${sessionDir}`);
    return;
  }
  console.log("\nPersistent change candidate:");
  console.log(`  Interface : ${explorationEnvironment.physicalIface}`);
  console.log(`  Current   : ${currentProfile}`);
  console.log(`  Candidate : ${finalProfileName}`);
  console.log(
    `  Score gap : ${Number.isFinite(finalEvaluation?.scoreGap)
      ? finalEvaluation.scoreGap.toFixed(2) : "n/a"} points`
  );
  console.log("  Files     : /etc/sysctl.d + systemd oneshot + rollback backup");

  if (!options.yes && !(await askYesNo("Persist this verified profile?"))) {
    await writeOptimizationReport(sessionDir, {
      options, currentProfile, finalProfileName, explorationDecision,
      confirmationDecision: confirmationSummary?.decision || null,
      evaluation, bufferGeneration, bufferExplorationDecision,
      bufferConfirmationDecision, bufferEvaluation,
      persistenceStatus: "declined",
    });
    console.log("Not persisted. Benchmark reports remain available.");
    return;
  }

  await run("sudo", ["-v"]);
  const persistArgs = [
    helper,
    finalBuffers ? "persist-full" : "persist",
    explorationEnvironment.physicalIface,
    candidate.cc,
    candidate.qdisc,
  ];
  if (finalBuffers) persistArgs.push(
    String(finalBuffers.coreRmemMax), String(finalBuffers.coreWmemMax),
    ...finalBuffers.tcpRmem.map(String), ...finalBuffers.tcpWmem.map(String),
    String(finalBuffers.tcpModerateRcvbuf)
  );
  const persisted = await run("sudo", persistArgs, { capture: true });
  process.stdout.write(persisted.stdout);
  process.stderr.write(persisted.stderr);
  await writeFile(join(sessionDir, "applied.json"), JSON.stringify({
    appliedAt: new Date().toISOString(),
    physicalIface: explorationEnvironment.physicalIface,
    currentProfile,
    candidateProfile: finalProfileName,
    helperOutput: persisted.stdout,
  }, null, 2));
  await writeOptimizationReport(sessionDir, {
    options, currentProfile, finalProfileName, explorationDecision,
    confirmationDecision: confirmationSummary?.decision || null,
    evaluation, bufferGeneration, bufferExplorationDecision,
    bufferConfirmationDecision, bufferEvaluation,
    persistenceStatus: "persisted",
  });
  console.log("\nVerified profile persisted successfully.");
  await showStatus();
};

const interactive = async () => {
  if (!input.isTTY || !output.isTTY) {
    console.log(helpText.trim());
    return;
  }
  const rl = createInterface({ input, output });
  try {
    console.log("Tenyendama Linux Network Optimizer v3.1.0");
    console.log("1. Check environment");
    console.log("2. Run benchmark only");
    console.log("3. Optimize with two-stage verification");
    console.log("4. Show latest report");
    console.log("5. Show status");
    console.log("6. Roll back managed profile");
    const answer = (await rl.question("Select [1-6]: ")).trim();
    const commands = { "1": "check", "2": "benchmark", "3": "optimize", "4": "report", "5": "status", "6": "rollback" };
    return commands[answer] || null;
  } finally { rl.close(); }
};

const helpText = `
Tenyendama Linux Network Optimizer v3.1.0

Usage:
  ./bin/tenyendama-netopt [command] [options]

Commands:
  check       Detect routing and physical interfaces without changing settings
  benchmark   Measure and rank profiles; never persists a result
  optimize    Explore, confirm, and optionally persist a verified winner
  report      Show the latest report, or a specified report path
  status      Show the active and managed profile
  rollback    Restore the profile that existed before the latest persistence
  uninstall   Remove all managed profiles by walking the rollback chain
  recover     Restore a benchmark interrupted by power loss or kill -9
  help        Show this help

Common options:
  --help      Show help
  --version   Show version

Command-specific options:
  --preset PRESET             Measurement size and repetition count (quick, standard, deep)
  --mode MODE                 Scoring policy; does not change measurement volume
  --profiles LIST             Comma-separated built-in CC/qdisc profiles
  --tune-buffers              Opt in to measured TCP socket-buffer ceiling comparison
  --buffer-cap-mib NUMBER     Candidate cap from 4 through 256 MiB; requires --tune-buffers
  --iface auto|NAME           Select the physical egress interface
  --min-score-gap POINTS      Minimum score lead required for a winner (default: 2)
  --seed NUMBER               Reproduce randomized benchmark order
  --headed                    Show Chromium during measurement
  --yes                       Skip prompts except the safety workflow itself
  --runs NUMBER               Override runs per profile (benchmark only)
  --cooldown SEC              Override delay between candidates
  --no-warmup                 Disable the unscored warm-up
  --background-threshold MBPS Background traffic warning threshold
  --background-seconds SEC    Background traffic sampling duration
  --background-action MODE    prompt, abort, or continue
  --min-decision-runs NUMBER  Minimum runs required for a decision
  --output-dir PATH           Select a benchmark result directory

Modes:
  balanced         Balance throughput, latency, and stability (default)
  download         Prioritize download median and sustained download speed
  upload           Prioritize upload median and sustained upload speed
  latency          Prioritize low loaded latency and fewer latency spikes
  streaming        Prioritize sustained upload, loaded latency, and stability
  highperformance  Strongly prioritize download and upload throughput

  Every mode retains route and protocol validation, loaded-latency and
  variability limits, confirmation runs, and the minimum score gap.

Presets:
  quick, standard, deep

Examples:
  ./bin/tenyendama-netopt check
  ./bin/tenyendama-netopt benchmark --preset standard --profiles cubic-fq,bbr-fq,cubic-fq_codel
  ./bin/tenyendama-netopt optimize --mode balanced
  ./bin/tenyendama-netopt optimize --mode highperformance --tune-buffers
  ./bin/tenyendama-netopt rollback

Safety notes:
  benchmark never persists. optimize requires exploration, confirmation,
  successful restoration, all safety gates, and explicit approval.
`;

const main = async () => {
  await access(helper, fsConstants.X_OK);
  let [command, ...args] = process.argv.slice(2);
  if (!command) command = await interactive();
  if (!command) return;
  switch (command) {
    case "help": case "--help": case "-h": console.log(helpText.trim()); break;
    case "--version": case "version": console.log("3.1.0"); break;
    case "check": await run(process.execPath, [benchmarkScript, "--check-only", ...args]); break;
    case "benchmark": await run(process.execPath, [benchmarkScript, ...args]); break;
    case "optimize": await optimize(args); break;
    case "report": {
      const reportPath = args[0] ? resolve(args[0]) : (await findReports(resultsRoot))[0]?.path;
      if (!reportPath) throw new Error("No report was found.");
      console.log(await readFile(reportPath, "utf8"));
      console.log(`\nReport: ${reportPath}`);
      break;
    }
    case "status": await showStatus(); break;
    case "recover": await run(process.execPath, [benchmarkScript, "--recover", ...args]); break;
    case "rollback": {
      const yes = args.includes("--yes");
      if (!yes && !(await askYesNo("Restore the profile that existed before the latest persistent change?"))) {
        console.log("Cancelled."); break;
      }
      await run("sudo", [helper, "rollback", "latest"]);
      await showStatus();
      break;
    }
    case "uninstall": {
      const yes = args.includes("--yes");
      if (!yes && !(await askYesNo("Remove all Tenyendama-managed persistent profiles and restore the original chain?"))) {
        console.log("Cancelled."); break;
      }
      await run("sudo", [helper, "uninstall"]);
      await showStatus();
      break;
    }
    default: throw new Error(`Unknown command: ${command}\n\n${helpText.trim()}`);
  }
};

main().catch((error) => {
  console.error(`\nERROR: ${error.stack || error.message}`);
  process.exitCode = 1;
});
