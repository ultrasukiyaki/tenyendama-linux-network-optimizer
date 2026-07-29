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

const benchmarkArgsFromOptimize = (options, outputDir, profiles, preset, seed) => {
  const args = [
    benchmarkScript,
    "--iface", options.iface,
    "--preset", preset,
    "--mode", options.mode,
    "--profiles", profiles.join(","),
    "--min-score-gap", String(options.minScoreGap),
    "--seed", String(seed >>> 0),
    "--output-dir", outputDir,
  ];
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
      default: throw new Error(`Unknown optimize option: ${arg}`);
    }
  }
  if (!Number.isFinite(options.minScoreGap) || options.minScoreGap < 0) {
    throw new Error("--min-score-gap must be zero or greater");
  }
  if (!["quick", "standard", "deep"].includes(options.preset)) {
    throw new Error("optimize supports quick, standard, or deep presets");
  }
  if (!["balanced", "download", "upload", "latency", "streaming"].includes(options.mode)) {
    throw new Error(`Unknown scoring mode: ${options.mode}`);
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
  console.log(`Routing interface : ${routingIface}`);
  console.log(`Physical egress   : ${physicalIface}`);
  console.log(`Interface chain   : ${resolved.chain.join(" -> ")}`);
  console.log(`Active profile    : ${cc}-${qdisc}`);
  const envPath = "/etc/tenyendama-netopt/current.env";
  if (await pathExists(envPath)) {
    console.log("Managed profile   : yes");
    console.log(await readFile(envPath, "utf8"));
  } else {
    console.log("Managed profile   : no");
  }
};

const optimize = async (argv) => {
  const options = parseOptimizeArgs(argv);
  const approximateExploration = estimateTransferBytes({
    profileCount: options.profiles.length,
    ...PRESET_TRANSFER[options.preset],
  });
  const approximateConfirmation = estimateTransferBytes({
    profileCount: 2,
    ...PRESET_TRANSFER.confirmation,
  });
  console.log("Tenyendama Linux Network Optimizer v3.0.1");
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
  const explorationEnvironment = await readJson(join(explorationDir, "environment.json"));
  const currentProfile = explorationEnvironment.currentProfile;
  const candidateProfile = explorationDecision.recommendedProfile;

  if (explorationDecision.status !== "winner") {
    console.log(`\nNo persistent change: exploration status is ${explorationDecision.status}.`);
    console.log(`Report: ${join(explorationDir, "report.md")}`);
    return;
  }
  if (!candidateProfile || candidateProfile === currentProfile) {
    console.log("\nThe current profile already won. No persistent change is needed.");
    return;
  }
  parseProfile(currentProfile);
  parseProfile(candidateProfile);

  await mkdir(confirmationDir, { recursive: true });
  console.log("\n=== Stage 2/2: confirmation against current profile ===");
  await run(process.execPath, benchmarkArgsFromOptimize(
    options,
    confirmationDir,
    [currentProfile, candidateProfile],
    "confirmation",
    options.seed ^ 0x9e3779b9
  ));

  const confirmationSummary = await readJson(join(confirmationDir, "summary.json"));
  const confirmationRuns = await readJson(join(confirmationDir, "raw-results.json"));
  const confirmationEnvironment = await readJson(
    join(confirmationDir, "environment.json")
  );
  const evaluation = evaluateConfirmation({
    candidateProfile,
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
  await writeFile(join(sessionDir, "optimization-decision.json"), JSON.stringify({
    explorationDecision,
    confirmationDecision: confirmationSummary.decision,
    evaluation,
  }, null, 2));

  if (!evaluation.accepted) {
    console.log("\nNo profile will be persisted.");
    console.log("\nReason:");
    for (const reason of evaluation.reasons) console.log(`- ${reason}`);
    console.log(`Current profile retained: ${currentProfile}`);
    return;
  }

  const candidate = parseProfile(candidateProfile);
  console.log("\nPersistent change candidate:");
  console.log(`  Interface : ${explorationEnvironment.physicalIface}`);
  console.log(`  Current   : ${currentProfile}`);
  console.log(`  Candidate : ${candidateProfile}`);
  console.log(`  Score gap : ${evaluation.scoreGap.toFixed(2)} points`);
  console.log("  Files     : /etc/sysctl.d + systemd oneshot + rollback backup");

  if (!options.yes && !(await askYesNo("Persist this verified profile?"))) {
    console.log("Not persisted. Benchmark reports remain available.");
    return;
  }

  await run("sudo", ["-v"]);
  const persisted = await run("sudo", [
    helper,
    "persist",
    explorationEnvironment.physicalIface,
    candidate.cc,
    candidate.qdisc,
  ], { capture: true });
  process.stdout.write(persisted.stdout);
  process.stderr.write(persisted.stderr);
  await writeFile(join(sessionDir, "applied.json"), JSON.stringify({
    appliedAt: new Date().toISOString(),
    physicalIface: explorationEnvironment.physicalIface,
    currentProfile,
    candidateProfile,
    helperOutput: persisted.stdout,
  }, null, 2));
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
    console.log("Tenyendama Linux Network Optimizer v3.0.1");
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
Tenyendama Linux Network Optimizer v3.0.1

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

Examples:
  ./bin/tenyendama-netopt check
  ./bin/tenyendama-netopt benchmark --preset standard --profiles cubic-fq,bbr-fq,cubic-fq_codel
  ./bin/tenyendama-netopt optimize --mode balanced
  ./bin/tenyendama-netopt rollback
`;

const main = async () => {
  await access(helper, fsConstants.X_OK);
  let [command, ...args] = process.argv.slice(2);
  if (!command) command = await interactive();
  if (!command) return;
  switch (command) {
    case "help": case "--help": case "-h": console.log(helpText.trim()); break;
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
