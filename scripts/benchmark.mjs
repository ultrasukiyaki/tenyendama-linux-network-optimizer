import {
  access,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { commandText, runCommand } from "../lib/commands.mjs";
import {
  collectEnvironment,
  detectRoutingInterface,
  measureBackgroundTraffic,
  qdiscKind,
  resolvePhysicalEgress,
  validateTrafficRoutes,
} from "../lib/network.mjs";
import {
  aggregateProfiles,
  buildCsv,
  buildReport,
  decideProfiles,
  runHasRequiredMetrics,
  summarizeRun,
} from "../lib/report.mjs";
import { balancedOrder, createSeededRandom, shuffled } from "../lib/stats.mjs";
import { PROFILE_REGISTRY } from "../lib/optimizer.mjs";
import { MODE_DESCRIPTIONS, MODE_REGISTRY, normalizeMode } from "../lib/stats.mjs";
import { validateBufferProfile } from "../lib/tcp-buffer.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const defaultHelper = join(projectRoot, "bin", "tenyendama-netopt-helper");
const stateDirectory = join(projectRoot, ".state");
const activeStatePath = join(stateDirectory, "active.json");

const PRESETS = {
  quick: {
    runs: 1,
    cooldownSeconds: 10,
    downloadBytes: 25_000_000,
    downloadCount: 2,
    uploadBytes: 10_000_000,
    uploadCount: 2,
  },
  standard: {
    runs: 3,
    cooldownSeconds: 20,
    downloadBytes: 100_000_000,
    downloadCount: 3,
    uploadBytes: 50_000_000,
    uploadCount: 3,
  },
  confirmation: {
    runs: 4,
    cooldownSeconds: 20,
    downloadBytes: 50_000_000,
    downloadCount: 2,
    uploadBytes: 25_000_000,
    uploadCount: 2,
  },
  deep: {
    runs: 5,
    cooldownSeconds: 30,
    downloadBytes: 100_000_000,
    downloadCount: 5,
    uploadBytes: 50_000_000,
    uploadCount: 5,
  },
};

const parseArguments = (argv) => {
  const explicit = new Set();
  const options = {
    iface: "auto",
    preset: "standard",
    mode: "balanced",
    profiles: ["cubic-fq", "bbr-fq"],
    profileFile: null,
    headless: true,
    helper: defaultHelper,
    port: 4173,
    warmup: true,
    warmupDownloadBytes: 10_000_000,
    warmupUploadBytes: 5_000_000,
    backgroundSeconds: 5,
    backgroundThresholdMbps: 5,
    backgroundAction: "prompt",
    seed: Date.now() >>> 0,
    checkOnly: false,
    recover: false,
    minScoreGap: 2,
    minDecisionRuns: 3,
    outputDir: null,
  };

  const requireValue = (argument, value) => {
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    switch (argument) {
      case "--iface":
        options.iface = requireValue(argument, next);
        index += 1;
        break;
      case "--preset":
        options.preset = requireValue(argument, next);
        index += 1;
        break;
      case "--mode":
        options.mode = requireValue(argument, next);
        index += 1;
        break;
      case "--profiles":
        options.profiles = requireValue(argument, next).split(",");
        explicit.add("profiles");
        index += 1;
        break;
      case "--profile-file":
        options.profileFile = resolve(requireValue(argument, next));
        explicit.add("profileFile");
        index += 1;
        break;
      case "--runs":
        options.runs = Number(requireValue(argument, next));
        explicit.add("runs");
        index += 1;
        break;
      case "--cooldown":
        options.cooldownSeconds = Number(requireValue(argument, next));
        explicit.add("cooldownSeconds");
        index += 1;
        break;
      case "--seed":
        options.seed = Number(requireValue(argument, next)) >>> 0;
        index += 1;
        break;
      case "--headed":
        options.headless = false;
        break;
      case "--no-warmup":
        options.warmup = false;
        break;
      case "--background-threshold":
        options.backgroundThresholdMbps = Number(requireValue(argument, next));
        index += 1;
        break;
      case "--background-seconds":
        options.backgroundSeconds = Number(requireValue(argument, next));
        index += 1;
        break;
      case "--background-action":
        options.backgroundAction = requireValue(argument, next);
        index += 1;
        break;
      case "--min-score-gap":
        options.minScoreGap = Number(requireValue(argument, next));
        index += 1;
        break;
      case "--min-decision-runs":
        options.minDecisionRuns = Number(requireValue(argument, next));
        index += 1;
        break;
      case "--output-dir":
        options.outputDir = resolve(requireValue(argument, next));
        index += 1;
        break;
      case "--helper":
        options.helper = resolve(requireValue(argument, next));
        index += 1;
        break;
      case "--check-only":
        options.checkOnly = true;
        break;
      case "--recover":
        options.recover = true;
        break;
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!PRESETS[options.preset]) {
    throw new Error(`Unknown preset: ${options.preset}`);
  }
  Object.assign(options, {
    ...PRESETS[options.preset],
    ...Object.fromEntries(
      [...explicit].map((key) => [key, options[key]])
    ),
  });

  if (!/^(auto|[a-zA-Z0-9_.:-]+)$/.test(options.iface)) {
    throw new Error(`Invalid interface name: ${options.iface}`);
  }
  options.requestedMode = options.mode;
  options.mode = normalizeMode(options.mode);
  options.modeDescription = MODE_DESCRIPTIONS[options.mode];
  options.scoringWeights = MODE_REGISTRY[options.mode];
  if (explicit.has("profiles") && explicit.has("profileFile")) {
    throw new Error("--profiles and --profile-file cannot be used together");
  }
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 10) {
    throw new Error("--runs must be an integer from 1 to 10");
  }
  if (!Number.isInteger(options.minDecisionRuns) || options.minDecisionRuns < 1 || options.minDecisionRuns > 10) {
    throw new Error("--min-decision-runs must be an integer from 1 to 10");
  }
  if (!Number.isFinite(options.minScoreGap) || options.minScoreGap < 0 || options.minScoreGap > 20) {
    throw new Error("--min-score-gap must be a number from 0 to 20");
  }
  if (!["prompt", "abort", "continue"].includes(options.backgroundAction)) {
    throw new Error("--background-action must be prompt, abort, or continue");
  }
  for (const name of options.profileFile ? [] : options.profiles) {
    if (!PROFILE_REGISTRY[name]) throw new Error(`Unknown profile: ${name}`);
  }

  return options;
};

const helpText = `
Tenyendama Linux Network Optimizer v3.1.0 — Benchmark Engine v0.3.0

Usage:
  ./bin/tenyendama-netbench --preset standard --mode balanced

Options:
  --iface auto|NAME            Auto-detect physical egress or specify it
  --preset quick|standard|confirmation|deep Measurement size and repeat count
  --mode MODE                  Scoring policy; includes highperformance
  --profiles LIST              Comma-separated profile names
  --runs NUMBER                Override measured runs per profile
  --cooldown SEC               Override delay between tests
  --seed NUMBER                Reproduce the randomized order
  --headed                     Show Chromium
  --min-score-gap POINTS       Minimum lead required to declare a winner (default: 2)
  --min-decision-runs NUMBER    Minimum measured runs needed for a decision
  --output-dir PATH             Write results to an explicit directory
  --no-warmup                  Disable unscored warm-up
  --background-threshold MBPS  Background traffic warning threshold
  --background-seconds SEC     Traffic sampling duration
  --background-action MODE     prompt, abort, or continue
  --check-only                 Detect environment without changing settings
  --recover                    Restore a stale interrupted-run state
  --help                       Show this help

Profiles:
  reno-fq
  reno-fq_codel
  cubic-fq
  cubic-fq_codel
  bbr-fq
  bbr-fq_codel

Modes:
  balanced         Balance throughput, latency, and stability (default)
  download         Prioritize download median and sustained download speed
  upload           Prioritize upload median and sustained upload speed
  latency          Prioritize low loaded latency and fewer latency spikes
  streaming        Prioritize sustained upload, loaded latency, and stability
  highperformance  Strongly prioritize download and upload throughput

All modes retain the same route, protocol, latency, variability, confirmation,
and minimum-score-gap safety gates.
`;

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const timestampName = () =>
  new Date()
    .toISOString()
    .replaceAll(":", "")
    .replaceAll("-", "")
    .replace(/\.\d{3}Z$/, "Z");

const fileExists = async (path) => {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const hasCompleteBufferSnapshot = (snapshot) =>
  snapshot &&
  Number.isSafeInteger(snapshot.coreRmemMax) && snapshot.coreRmemMax > 0 &&
  Number.isSafeInteger(snapshot.coreWmemMax) && snapshot.coreWmemMax > 0 &&
  Array.isArray(snapshot.tcpRmem) && snapshot.tcpRmem.length === 3 &&
  snapshot.tcpRmem.every((value) => Number.isSafeInteger(value) && value > 0) &&
  Array.isArray(snapshot.tcpWmem) && snapshot.tcpWmem.length === 3 &&
  snapshot.tcpWmem.every((value) => Number.isSafeInteger(value) && value > 0) &&
  [0, 1].includes(snapshot.tcpModerateRcvbuf);

const promptBackgroundDecision = async (traffic) => {
  if (!input.isTTY || !output.isTTY) return "abort";
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      `Background traffic: RX ${traffic.rxMbps.toFixed(2)} Mbps, `
      + `TX ${traffic.txMbps.toFixed(2)} Mbps. [r]etry/[c]ontinue/[a]bort: `
    );
    const value = answer.trim().toLowerCase();
    if (value.startsWith("c")) return "continue";
    if (value.startsWith("r")) return "retry";
    return "abort";
  } finally {
    rl.close();
  }
};

const ensureQuietNetwork = async (iface, options) => {
  while (true) {
    process.stdout.write(
      `Checking background traffic for ${options.backgroundSeconds}s... `
    );
    const traffic = await measureBackgroundTraffic(
      iface,
      options.backgroundSeconds
    );
    console.log(
      `RX ${traffic.rxMbps.toFixed(2)} Mbps / TX ${traffic.txMbps.toFixed(2)} Mbps`
    );

    if (
      Math.max(traffic.rxMbps, traffic.txMbps) <=
      options.backgroundThresholdMbps
    ) {
      return { ...traffic, passed: true };
    }

    let action = options.backgroundAction;
    if (action === "prompt") action = await promptBackgroundDecision(traffic);
    if (action === "continue") return { ...traffic, passed: false };
    if (action === "retry") continue;
    throw new Error("Benchmark aborted because background traffic is too high");
  }
};

const validateProtocols = (records) => {
  const protocols = [...new Set(records.map((entry) => entry.protocol))];
  return protocols.length > 0
    && !protocols.some((protocol) => /(?:h3|quic)/i.test(protocol));
};

const recoverState = async (helper) => {
  if (!(await fileExists(activeStatePath))) {
    console.log("No interrupted benchmark state was found.");
    return;
  }
  const state = JSON.parse(await readFile(activeStatePath, "utf8"));
  console.log(
    `Restoring ${state.originalCc} + ${state.originalQdisc} on ${state.physicalIface}...`
  );
  await runCommand("sudo", ["-v"], { capture: false, timeoutMs: 120_000 });
  await runCommand(
    "sudo",
    hasCompleteBufferSnapshot({
      coreRmemMax: state.originalCoreRmemMax,
      coreWmemMax: state.originalCoreWmemMax,
      tcpRmem: state.originalTcpRmem,
      tcpWmem: state.originalTcpWmem,
      tcpModerateRcvbuf: state.originalTcpModerateRcvbuf,
    })
      ? [helper, "restore-full", state.physicalIface, state.originalCc,
        state.originalQdisc, String(state.originalCoreRmemMax),
        String(state.originalCoreWmemMax), ...state.originalTcpRmem.map(String),
        ...state.originalTcpWmem.map(String), String(state.originalTcpModerateRcvbuf)]
      : [helper, "restore", state.physicalIface, state.originalCc, state.originalQdisc],
    { capture: false, timeoutMs: 30_000 }
  );
  await rm(activeStatePath, { force: true });
  console.log("Recovery completed.");
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(helpText.trim());
    return;
  }

  await access(options.helper, fsConstants.X_OK);
  const helper = await realpath(options.helper);

  if (options.recover) {
    await recoverState(helper);
    return;
  }

  if (await fileExists(activeStatePath)) {
    throw new Error(
      "An interrupted benchmark state exists. Run `npm run recover` first."
    );
  }

  const routingIface = await detectRoutingInterface();
  const resolved = await resolvePhysicalEgress(routingIface);
  const physicalIface = options.iface === "auto" ? resolved.physicalIface : options.iface;

  if (!(await fileExists(`/sys/class/net/${physicalIface}`))) {
    throw new Error(`Interface does not exist: ${physicalIface}`);
  }

  const originalCc = await commandText("sysctl", [
    "-n",
    "net.ipv4.tcp_congestion_control",
  ]);
  const originalQdisc = await qdiscKind(physicalIface);

  let profiles;
  if (options.profileFile) {
    const document = JSON.parse(await readFile(options.profileFile, "utf8"));
    if (!Array.isArray(document) || document.length < 1 || document.length > 16) {
      throw new Error("--profile-file must contain an array of 1 through 16 profiles");
    }
    profiles = document.map((profile) => validateBufferProfile(profile, {
      allowAboveCap: profile?.source === "current",
    }));
  } else {
    profiles = options.profiles.map((name) => PROFILE_REGISTRY[name]);
  }
  const currentProfileKey = profiles.find((profile) => profile.source === "current")?.name
    || `${originalCc}-${originalQdisc}`;
  const outputDirectory = options.outputDir || join(projectRoot, "results", "benchmarks", timestampName());
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(stateDirectory, { recursive: true });

  const environment = {
    version: "3.1.0",
    benchmarkEngineVersion: "0.3.0",
    startedAt: new Date().toISOString(),
    routingIface,
    physicalIface,
    interfaceChain: resolved.chain,
    interfaceWarning: resolved.warning || null,
    originalCc,
    originalQdisc,
    currentProfile: currentProfileKey,
    profiles,
    options,
    backgroundChecks: [],
    snapshot: await collectEnvironment({ routingIface, physicalIface }),
  };
  for (const profile of profiles.filter((item) => item.source === "current")) {
    const startingBuffers = environment.snapshot.tcpBuffers;
    const expected = {
      coreRmemMax: startingBuffers.coreRmemMax,
      coreWmemMax: startingBuffers.coreWmemMax,
      tcpRmem: startingBuffers.tcpRmem,
      tcpWmem: startingBuffers.tcpWmem,
      tcpModerateRcvbuf: startingBuffers.tcpModerateRcvbuf,
    };
    if (JSON.stringify(profile.buffers) !== JSON.stringify(expected)) {
      throw new Error(
        `Current buffer profile ${profile.name} does not exactly match `
        + "the starting kernel buffer snapshot."
      );
    }
  }

  await writeFile(
    join(outputDirectory, "environment.json"),
    JSON.stringify(environment, null, 2)
  );

  console.log(`Routing interface : ${routingIface}`);
  console.log(`Physical egress   : ${physicalIface}`);
  console.log(`Interface chain   : ${resolved.chain.join(" -> ")}`);
  console.log(`Original profile  : ${originalCc} + ${originalQdisc}`);
  if (resolved.warning) console.warn(`WARNING: ${resolved.warning}`);

  if (options.checkOnly) {
    console.log(`Environment snapshot: ${outputDirectory}/environment.json`);
    if (!["reno", "cubic", "bbr"].includes(originalCc)) {
      console.warn(`WARNING: benchmark restore does not support CC ${originalCc}`);
    }
    if (!["fq", "fq_codel"].includes(originalQdisc)) {
      console.warn(`WARNING: benchmark restore does not support qdisc ${originalQdisc}`);
    }
    return;
  }

  if (!["reno", "cubic", "bbr"].includes(originalCc)) {
    throw new Error(
      `Original congestion control cannot be restored safely: ${originalCc}`
    );
  }
  if (!["fq", "fq_codel"].includes(originalQdisc)) {
    throw new Error(
      `Original qdisc cannot be restored safely: ${originalQdisc}`
    );
  }

  console.log("sudo is used only for congestion-control and qdisc switching.");
  await runCommand("sudo", ["-v"], { capture: false, timeoutMs: 120_000 });

  const supportedProfiles = [];
  const skippedProfiles = [];
  for (const profile of profiles) {
    const probe = await runCommand(
      "sudo",
      [helper, "probe", profile.cc],
      { capture: true, allowFailure: true, timeoutMs: 30_000 }
    );
    if (probe.code === 0) supportedProfiles.push(profile);
    else skippedProfiles.push({
      profile: profile.name,
      reason: (probe.stderr || probe.stdout || "unavailable").trim(),
    });
  }
  profiles = supportedProfiles;
  if (profiles.length === 0) {
    throw new Error("None of the requested profiles is supported by this kernel.");
  }
  for (const skipped of skippedProfiles) {
    console.warn(`Skipping ${skipped.profile}: ${skipped.reason}`);
  }
  environment.profiles = profiles;
  environment.skippedProfiles = skippedProfiles;
  await writeFile(
    join(outputDirectory, "environment.json"),
    JSON.stringify(environment, null, 2)
  );

  const activeState = {
    createdAt: new Date().toISOString(),
    physicalIface,
    originalCc,
    originalQdisc,
    originalCoreRmemMax: environment.snapshot.tcpBuffers.coreRmemMax,
    originalCoreWmemMax: environment.snapshot.tcpBuffers.coreWmemMax,
    originalTcpRmem: environment.snapshot.tcpBuffers.tcpRmem,
    originalTcpWmem: environment.snapshot.tcpBuffers.tcpWmem,
    originalTcpModerateRcvbuf: environment.snapshot.tcpBuffers.tcpModerateRcvbuf,
    helper,
    outputDirectory,
  };
  await writeFile(activeStatePath, JSON.stringify(activeState, null, 2));

  let viteServer;
  let browser;
  let restored = false;
  let signalReceived = null;

  const restore = async () => {
    if (restored) return true;
    console.log(
      `Restoring ${originalCc} + ${originalQdisc} on ${physicalIface}...`
    );
    const result = await runCommand(
      "sudo",
      hasCompleteBufferSnapshot(environment.snapshot.tcpBuffers)
        ? [helper, "restore-full", physicalIface, originalCc, originalQdisc,
          String(environment.snapshot.tcpBuffers.coreRmemMax),
          String(environment.snapshot.tcpBuffers.coreWmemMax),
          ...environment.snapshot.tcpBuffers.tcpRmem.map(String),
          ...environment.snapshot.tcpBuffers.tcpWmem.map(String),
          String(environment.snapshot.tcpBuffers.tcpModerateRcvbuf)]
        : [helper, "restore", physicalIface, originalCc, originalQdisc],
      { capture: false, allowFailure: true, timeoutMs: 30_000 }
    );
    restored = result.code === 0;
    if (restored) {
      await rm(activeStatePath, { force: true });
      console.log("Original network profile restored.");
    } else {
      const tcp = environment.snapshot.tcpBuffers;
      const manualRestore = hasCompleteBufferSnapshot(tcp)
        ? `sudo ${helper} restore-full ${physicalIface} ${originalCc} ${originalQdisc} `
          + `${tcp.coreRmemMax} ${tcp.coreWmemMax} `
          + `${tcp.tcpRmem.join(" ")} ${tcp.tcpWmem.join(" ")} `
          + `${tcp.tcpModerateRcvbuf}`
        : `sudo ${helper} restore ${physicalIface} ${originalCc} ${originalQdisc}`;
      console.error(
        `RESTORE FAILED. Run: ${manualRestore}`
      );
    }
    return restored;
  };

  const signalHandler = (signal) => {
    signalReceived = signal;
    console.error(`\nReceived ${signal}; stopping Chromium and restoring settings...`);
    browser?.close().catch(() => {});
  };
  process.once("SIGINT", () => signalHandler("SIGINT"));
  process.once("SIGTERM", () => signalHandler("SIGTERM"));
  process.once("SIGHUP", () => signalHandler("SIGHUP"));

  try {
    const [{ chromium }, { createServer }] = await Promise.all([
      import("playwright"),
      import("vite"),
    ]);
    viteServer = await createServer({
      root: projectRoot,
      logLevel: "error",
      server: { host: "127.0.0.1", port: options.port, strictPort: true },
    });
    await viteServer.listen();

    browser = await chromium.launch({
      headless: options.headless,
      args: ["--disable-quic"],
    });
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(360_000);
    await page.goto(`http://127.0.0.1:${options.port}/`, {
      waitUntil: "networkidle",
    });

    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    const requestMethods = new Map();
    let captureActive = false;
    let capturedProtocols = [];

    cdp.on("Network.requestWillBeSent", (event) => {
      requestMethods.set(event.requestId, {
        method: event.request.method,
        url: event.request.url,
      });
    });
    cdp.on("Network.responseReceived", (event) => {
      if (!captureActive) return;
      const url = event.response.url || requestMethods.get(event.requestId)?.url || "";
      if (!/\/__(?:down|up)(?:[/?#]|$)/.test(url)) return;
      capturedProtocols.push({
        requestId: event.requestId,
        method: requestMethods.get(event.requestId)?.method || "unknown",
        url,
        protocol: event.response.protocol || "unknown",
        responseStatus: event.response.status,
        remoteIPAddress: event.response.remoteIPAddress || null,
        remotePort: event.response.remotePort || null,
        resourceType: event.type || null,
        connectionReused: event.response.connectionReused,
        connectionId: event.response.connectionId,
        mimeType: event.response.mimeType,
        timestamp: event.timestamp ?? null,
      });
    });

    const applyProfile = async (profile) => {
      await runCommand(
        "sudo",
        profile.buffers
          ? [helper, profile.source === "current" ? "restore-full" : "apply-full",
            physicalIface, profile.cc, profile.qdisc,
            String(profile.buffers.coreRmemMax), String(profile.buffers.coreWmemMax),
            ...profile.buffers.tcpRmem.map(String), ...profile.buffers.tcpWmem.map(String),
            String(profile.buffers.tcpModerateRcvbuf)]
          : [helper, "apply", physicalIface, profile.cc, profile.qdisc],
        { capture: false, timeoutMs: 30_000 }
      );
    };

    const runMeasurement = async (measurementOptions) => {
      await page.reload({ waitUntil: "networkidle" });
      capturedProtocols = [];
      captureActive = true;
      try {
        const raw = await page.evaluate(async (browserOptions) => {
          if (typeof window.runTenyendamaSpeedTest !== "function") {
            throw new Error("Browser benchmark function is unavailable");
          }
          return window.runTenyendamaSpeedTest(browserOptions);
        }, measurementOptions);
        await sleep(250);
        const protocols = [...capturedProtocols];
        const protocolValid = validateProtocols(protocols);
        const routeValidation = await validateTrafficRoutes({
          protocolRecords: protocols,
          selectedPhysicalEgress: physicalIface,
        });
        return { raw, protocols, protocolValid, routeValidation };
      } finally {
        captureActive = false;
      }
    };

    if (options.warmup) {
      console.log("\nRunning one unscored warm-up per profile...");
      const warmupOrder = shuffled(
        profiles,
        createSeededRandom(options.seed ^ 0xa5a5a5a5)
      );
      for (const profile of warmupOrder) {
        console.log(`Warm-up: ${profile.name}`);
        await applyProfile(profile);
        await sleep(Math.min(options.cooldownSeconds, 10) * 1000);
        environment.backgroundChecks.push(
          await ensureQuietNetwork(physicalIface, options)
        );
        const result = await runMeasurement({
          latencyPackets: 5,
          downloadBytes: options.warmupDownloadBytes,
          downloadCount: 1,
          uploadBytes: options.warmupUploadBytes,
          uploadCount: 1,
          measureLoadedLatency: false,
        });
        await writeFile(
          join(outputDirectory, `warmup-${profile.name}.json`),
          JSON.stringify(result, null, 2)
        );
        console.log(
          `Warm-up protocol: ${[
            ...new Set(result.protocols.map((item) => item.protocol)),
          ].join(", ")}`
        );
      }
    }

    const order = balancedOrder(profiles, options.runs, options.seed);
    await writeFile(
      join(outputDirectory, "test-order.json"),
      JSON.stringify(
        {
          seed: options.seed,
          design: "seeded-latin-square",
          order: order.map((profile, index) => ({
            sequence: index + 1,
            round: Math.floor(index / profiles.length) + 1,
            position: (index % profiles.length) + 1,
            profile: profile.name,
          })),
        },
        null,
        2
      )
    );

    const runs = [];
    for (let index = 0; index < order.length; index += 1) {
      if (signalReceived) throw new Error(`Interrupted by ${signalReceived}`);
      const profile = order[index];
      const sequence = index + 1;
      const round = Math.floor(index / profiles.length) + 1;
      const position = (index % profiles.length) + 1;
      console.log(
        `\n[${sequence}/${order.length}] Applying ${profile.name} to ${physicalIface}`
      );
      await applyProfile(profile);
      console.log(`Cooling down for ${options.cooldownSeconds}s...`);
      await sleep(options.cooldownSeconds * 1000);
      environment.backgroundChecks.push(
        await ensureQuietNetwork(physicalIface, options)
      );

      const result = await runMeasurement({
        latencyPackets: 20,
        downloadBytes: options.downloadBytes,
        downloadCount: options.downloadCount,
        uploadBytes: options.uploadBytes,
        uploadCount: options.uploadCount,
        measureLoadedLatency: true,
      });
      const summary = summarizeRun(
        profile,
        result.raw,
        sequence,
        result.protocols,
        { round, position }
      );
      Object.assign(summary, result.routeValidation);
      summary.protocolValid = result.protocolValid;
      summary.exclusionReasons = [];
      if (!summary.protocolValid) {
        summary.exclusionReasons.push(
          summary.protocols.length
            ? "HTTP/3 or QUIC was detected."
            : "No target protocol was captured."
        );
      }
      if (summary.routeValidationStatus !== "pass") {
        summary.exclusionReasons.push(
          summary.routeFailureReason || "Traffic-path validation did not pass."
        );
      }
      if (!runHasRequiredMetrics(summary)) {
        summary.exclusionReasons.push(
          "Required throughput, latency, spike, or variability metrics are missing or invalid."
        );
      }
      if (Number(summary.loadedLatencyMaxMs) > 250) {
        summary.exclusionReasons.push("Loaded latency exceeded the 250 ms safety limit.");
      }
      if (Number(summary.downloadCv) > 0.35 || Number(summary.uploadCv) > 0.35) {
        summary.exclusionReasons.push("Throughput variation exceeded the safety limit.");
      }
      summary.eligible = summary.exclusionReasons.length === 0;
      runs.push(summary);

      await writeFile(
        join(
          outputDirectory,
          `${String(sequence).padStart(2, "0")}-${profile.name}.json`
        ),
        JSON.stringify(summary, null, 2)
      );

      console.log(
        `Download ${summary.downloadMedianMbps?.toFixed(2) ?? "n/a"} Mbps | `
        + `Upload ${summary.uploadMedianMbps?.toFixed(2) ?? "n/a"} Mbps | `
        + `Loaded p95 ${summary.loadedLatencyP95Ms?.toFixed(2) ?? "n/a"} ms | `
        + `Protocol ${summary.protocols.join(", ")}`
      );
    }

    const aggregates = aggregateProfiles(profiles, runs, options.mode);
    const decision = decideProfiles(aggregates, {
      currentProfile: environment.currentProfile,
      minScoreGap: options.minScoreGap,
      minRuns: options.minDecisionRuns,
    });
    const completedEnvironment = {
      ...environment,
      completedAt: new Date().toISOString(),
      testOrder: runs.map((run) => run.profile),
    };

    await writeFile(
      join(outputDirectory, "environment.json"),
      JSON.stringify(completedEnvironment, null, 2)
    );
    await writeFile(
      join(outputDirectory, "raw-results.json"),
      JSON.stringify(runs, null, 2)
    );
    await writeFile(join(outputDirectory, "raw-results.csv"), buildCsv(runs));
    await writeFile(
      join(outputDirectory, "summary.json"),
      JSON.stringify({
        requestedMode: options.requestedMode,
        normalizedMode: options.mode,
        modeDescription: options.modeDescription,
        scoringWeights: options.scoringWeights,
        decision,
        profiles: aggregates,
      }, null, 2)
    );
    await writeFile(
      join(outputDirectory, "decision.json"),
      JSON.stringify(decision, null, 2)
    );
    await writeFile(
      join(outputDirectory, "report.md"),
      buildReport({
        environment: completedEnvironment,
        aggregates,
        runs,
        options,
        decision,
      })
    );

    console.log("\nProfile ranking:");
    aggregates.forEach((item, index) => {
      console.log(
        `${index + 1}. ${item.profile.padEnd(16)} `
        + `score=${item.score.toFixed(2)} `
        + `down=${item.downloadMedianMbps?.toFixed(2) ?? "n/a"} Mbps `
        + `up=${item.uploadMedianMbps?.toFixed(2) ?? "n/a"} Mbps `
        + `p95=${item.loadedLatencyP95Ms?.toFixed(2) ?? "n/a"} ms`
      );
    });
    console.log(`\nDecision: ${decision.status}`);
    if (decision.recommendedProfile) {
      console.log(`Recommended profile: ${decision.recommendedProfile}`);
    }
    console.log(`Reason: ${decision.reason}`);
    console.log(`\nResults: ${outputDirectory}`);
  } finally {
    await restore();
    if (browser) await browser.close().catch(() => {});
    if (viteServer) await viteServer.close().catch(() => {});
  }

  if (!restored) {
    throw new Error(
      "The starting network profile could not be restored; persistence is disabled."
    );
  }

  if (signalReceived) {
    process.exitCode = signalReceived === "SIGINT" ? 130 : 143;
  }
};

main().catch((error) => {
  console.error(`\nERROR: ${error.stack || error.message}`);
  process.exitCode = 1;
});
