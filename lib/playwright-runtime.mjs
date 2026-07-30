import { constants as fsConstants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname } from "node:path";
import { createRequire } from "node:module";

export const BROWSER_ERROR_CODES = Object.freeze({
  PACKAGE_MISSING: "BROWSER_PACKAGE_MISSING",
  NOT_INSTALLED: "BROWSER_NOT_INSTALLED",
  EXECUTABLE_MISSING: "BROWSER_EXECUTABLE_MISSING",
  EXECUTABLE_NOT_USABLE: "BROWSER_EXECUTABLE_NOT_USABLE",
  DEPENDENCIES_MISSING: "BROWSER_DEPENDENCIES_MISSING",
  CACHE_OWNERSHIP_ERROR: "BROWSER_CACHE_OWNERSHIP_ERROR",
  UNSUPPORTED_PLATFORM: "BROWSER_UNSUPPORTED_PLATFORM",
  LAUNCH_TIMEOUT: "BROWSER_LAUNCH_TIMEOUT",
  CDP_FAILURE: "BROWSER_CDP_FAILURE",
  LOCAL_PAGE_FAILURE: "BROWSER_LOCAL_PAGE_FAILURE",
  UNKNOWN_FAILURE: "BROWSER_UNKNOWN_FAILURE",
});

const REMEDIATION = Object.freeze({
  [BROWSER_ERROR_CODES.PACKAGE_MISSING]: {
    cause: "The Playwright package used by this project is not installed.",
    impact: "Chromium benchmarks and browser runtime checks cannot run.",
    command: "npm install",
  },
  [BROWSER_ERROR_CODES.NOT_INSTALLED]: {
    cause: "Chromium is not installed for the Playwright version used by this project.",
    impact: "Chromium cannot be launched.",
    command: "npx playwright install chromium",
  },
  [BROWSER_ERROR_CODES.EXECUTABLE_MISSING]: {
    cause: "The Playwright-managed Chromium executable is missing.",
    impact: "Chromium cannot be launched.",
    command: "npx playwright install chromium",
  },
  [BROWSER_ERROR_CODES.EXECUTABLE_NOT_USABLE]: {
    cause: "The Playwright-managed Chromium executable is not readable or executable by the current user.",
    impact: "Chromium cannot be launched by this login user.",
    command: "npx playwright install chromium",
  },
  [BROWSER_ERROR_CODES.DEPENDENCIES_MISSING]: {
    cause: "Chromium could not start because required Linux shared libraries are missing.",
    impact: "Headless Chromium cannot run until its OS dependencies are installed.",
    command: "npx playwright install --with-deps chromium",
  },
  [BROWSER_ERROR_CODES.CACHE_OWNERSHIP_ERROR]: {
    cause: "The browser cache is not accessible to the current user and appears to contain root-owned paths.",
    impact: "The current login user cannot use the installed Chromium.",
    command: "npx playwright install chromium",
  },
  [BROWSER_ERROR_CODES.UNSUPPORTED_PLATFORM]: {
    cause: "This OS or architecture is not supported by the pinned Playwright browser build.",
    impact: "The project cannot automatically provide a compatible Chromium here.",
    command: "npx playwright install --help",
  },
  [BROWSER_ERROR_CODES.LAUNCH_TIMEOUT]: {
    cause: "Headless Chromium did not start before the finite launch timeout.",
    impact: "The browser runtime check or benchmark cannot continue.",
    command: "npx playwright install chromium",
  },
  [BROWSER_ERROR_CODES.CDP_FAILURE]: {
    cause: "Chromium started, but a DevTools Protocol session could not be used.",
    impact: "Benchmark protocol and network-path validation cannot run safely.",
    command: "npx playwright install chromium",
  },
  [BROWSER_ERROR_CODES.LOCAL_PAGE_FAILURE]: {
    cause: "Chromium started, but the loopback smoke-test page did not complete.",
    impact: "The browser runtime is not healthy enough for benchmarking.",
    command: "npx playwright install chromium",
  },
  [BROWSER_ERROR_CODES.UNKNOWN_FAILURE]: {
    cause: "Chromium failed for an unclassified reason.",
    impact: "The browser runtime check or benchmark cannot continue.",
    command: "npx playwright install chromium",
  },
});

const errorText = (error) =>
  [error?.name, error?.code, error?.message, error?.cause?.message]
    .filter(Boolean).join("\n");

export const buildChromiumLaunchOptions = ({
  timeoutMs = 30_000,
  args = [],
} = {}) => ({
  headless: true,
  timeout: timeoutMs,
  args: [...new Set(["--disable-quic", ...args])],
});

export const classifyBrowserLaunchError = (error, context = {}) => {
  const text = errorText(error);
  let code = BROWSER_ERROR_CODES.UNKNOWN_FAILURE;
  if (
    context.packageMissing ||
    (error?.code === "ERR_MODULE_NOT_FOUND" && /playwright/i.test(text)) ||
    (/Cannot find (?:package|module)/i.test(text) && /playwright/i.test(text))
  ) {
    code = BROWSER_ERROR_CODES.PACKAGE_MISSING;
  } else if (
    context.stage === "cdp"
  ) {
    code = BROWSER_ERROR_CODES.CDP_FAILURE;
  } else if (
    context.stage === "local-page"
  ) {
    code = BROWSER_ERROR_CODES.LOCAL_PAGE_FAILURE;
  } else if (
    context.rootOwned && context.executableUsable === false
  ) {
    code = BROWSER_ERROR_CODES.CACHE_OWNERSHIP_ERROR;
  } else if (
    error?.code === "EACCES" || error?.code === "EPERM" ||
    /permission denied|operation not permitted/i.test(text)
  ) {
    code = BROWSER_ERROR_CODES.EXECUTABLE_NOT_USABLE;
  } else if (
    context.browserNotInstalled
  ) {
    code = BROWSER_ERROR_CODES.NOT_INSTALLED;
  } else if (
    context.executableMissing ||
    (error?.code === "ENOENT" && context.executableResolved)
  ) {
    code = BROWSER_ERROR_CODES.EXECUTABLE_MISSING;
  } else if (
    /Executable doesn't exist|browser.*not (?:found|installed)|download new browsers/i.test(text)
  ) {
    code = BROWSER_ERROR_CODES.NOT_INSTALLED;
  } else if (
    /error while loading shared libraries|host system is missing dependencies|missing dependencies|lib[\w+.-]+\.so(?:\.\d+)*.*(?:not found|cannot open)/i.test(text)
  ) {
    code = BROWSER_ERROR_CODES.DEPENDENCIES_MISSING;
  } else if (
    /unsupported (?:platform|os|architecture)|not supported on.*(?:platform|architecture)/i.test(text)
  ) {
    code = BROWSER_ERROR_CODES.UNSUPPORTED_PLATFORM;
  } else if (
    error?.name === "TimeoutError" || context.stage === "launch-timeout" ||
    /\btimeout\b|\btimed out\b/i.test(text)
  ) {
    code = BROWSER_ERROR_CODES.LAUNCH_TIMEOUT;
  }
  return {
    code,
    ...REMEDIATION[code],
    debugCommand: "DEBUG=pw:browser ./bin/tenyendama-netopt check",
  };
};

export const formatBrowserRuntimeError = (classification) => [
  `${classification.code}: ${classification.cause}`,
  `Impact: ${classification.impact}`,
  "Run as your normal login user:",
  `  ${classification.command}`,
  "For Playwright browser launch logs:",
  `  ${classification.debugCommand}`,
].join("\n");

const loadPlaywright = async (loader = () => import("playwright")) => {
  try {
    return await loader();
  } catch (error) {
    throw Object.assign(error, {
      browserClassification: classifyBrowserLaunchError(error, {
        packageMissing: true,
      }),
    });
  }
};

const playwrightVersion = async () => {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("playwright/package.json");
  return JSON.parse(await readFile(packagePath, "utf8")).version;
};

const inspectExecutable = async (executablePath) => {
  const result = {
    browserInstallationAvailable: false,
    executableAvailable: false,
    executableUsable: false,
    executableRootOwned: false,
    traversalUsable: false,
  };
  try {
    result.browserInstallationAvailable = (
      await stat(dirname(dirname(executablePath)))
    ).isDirectory();
  } catch {
    // The pinned browser revision has not been installed.
  }
  try {
    const info = await stat(executablePath);
    result.executableAvailable = info.isFile();
    result.executableRootOwned = info.uid === 0;
    await access(executablePath, fsConstants.R_OK | fsConstants.X_OK);
    result.executableUsable = true;
  } catch {
    return result;
  }

  result.traversalUsable = true;
  let parent = dirname(executablePath);
  let inspectOwnership = true;
  while (parent && parent !== dirname(parent)) {
    try {
      const info = await stat(parent);
      if (inspectOwnership) result.executableRootOwned ||= info.uid === 0;
      await access(parent, fsConstants.X_OK);
      if (basename(parent) === "ms-playwright") inspectOwnership = false;
    } catch {
      result.traversalUsable = false;
      result.executableUsable = false;
      break;
    }
    parent = dirname(parent);
  }
  return result;
};

export const collectBrowserRuntimeInfo = async ({
  playwrightModule,
  playwrightLoader,
} = {}) => {
  const playwright = playwrightModule || await loadPlaywright(playwrightLoader);
  let executablePath;
  try {
    executablePath = playwright.chromium.executablePath();
  } catch (error) {
    throw Object.assign(error, {
      browserClassification: classifyBrowserLaunchError(error),
    });
  }
  const executable = await inspectExecutable(executablePath);
  let version;
  try {
    version = await playwrightVersion();
  } catch (error) {
    throw Object.assign(error, {
      browserClassification: classifyBrowserLaunchError(error, {
        packageMissing: error?.code === "MODULE_NOT_FOUND",
      }),
    });
  }
  return {
    mode: "headless",
    headless: true,
    xServerRequired: false,
    displayEnvironmentPresent: Boolean(process.env.DISPLAY),
    waylandEnvironmentPresent: Boolean(process.env.WAYLAND_DISPLAY),
    playwrightVersion: version,
    browserName: "chromium",
    browserVersion: null,
    executableSource: "playwright-managed",
    executablePath,
    ...executable,
    launchProbe: "not-run",
    localPageProbe: "not-run",
    cdpProbe: "not-run",
  };
};

export const sanitizeBrowserRuntimeInfo = (runtime) => {
  if (!runtime) return null;
  const {
    executablePath: _privateExecutablePath,
    ...safe
  } = runtime;
  return safe;
};

export const launchBenchmarkChromium = async ({
  playwrightModule,
  playwrightLoader,
  launchOptions,
} = {}) => {
  const playwright = playwrightModule || await loadPlaywright(playwrightLoader);
  try {
    return await playwright.chromium.launch(
      buildChromiumLaunchOptions(launchOptions)
    );
  } catch (error) {
    let runtime = {};
    try {
      runtime = await collectBrowserRuntimeInfo({ playwrightModule: playwright });
    } catch {
      // Preserve the launch error as the primary failure.
    }
    throw Object.assign(error, {
      browserClassification: classifyBrowserLaunchError(error, {
        executableResolved: Boolean(runtime.executablePath),
        executableMissing: runtime.executableAvailable === false,
        executableUsable: runtime.executableUsable,
        rootOwned: runtime.executableRootOwned,
      }),
    });
  }
};

const listenLoopback = (server) => new Promise((resolvePromise, rejectPromise) => {
  server.once("error", rejectPromise);
  server.listen(0, "127.0.0.1", () => {
    server.off("error", rejectPromise);
    resolvePromise(server.address().port);
  });
});

const closeQuietly = async (resource, method = "close") => {
  try { await resource?.[method]?.(); } catch { /* best-effort cleanup */ }
};

export const probeHeadlessChromium = async ({
  playwrightModule,
  playwrightLoader,
  launchTimeoutMs = 30_000,
  navigationTimeoutMs = 15_000,
  overallTimeoutMs = 60_000,
  signal,
} = {}) => {
  const token = "tenyendama-headless-smoke-ok";
  const server = createServer((request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(`<!doctype html><title>headless smoke</title><main id="result">${token}</main>`);
  });
  let browser;
  let context;
  let page;
  let cdp;
  let timer;
  let abortHandler;
  let stage = "launch";
  const cleanup = async () => {
    await closeQuietly(cdp, "detach");
    await closeQuietly(page);
    await closeQuietly(context);
    await closeQuietly(browser);
    if (server.listening) {
      await new Promise((resolvePromise) => server.close(() => resolvePromise()));
    }
  };

  try {
    const runtime = await collectBrowserRuntimeInfo({
      playwrightModule,
      playwrightLoader,
    });
    if (!runtime.executableAvailable) {
      const error = Object.assign(new Error("Playwright Chromium executable is missing"), {
        code: "ENOENT",
      });
      throw Object.assign(error, {
        browserClassification: classifyBrowserLaunchError(error, {
          executableResolved: true,
          executableMissing: true,
          browserNotInstalled: !runtime.browserInstallationAvailable,
          rootOwned: runtime.executableRootOwned,
        }),
      });
    }
    if (!runtime.executableUsable) {
      const error = Object.assign(new Error("Playwright Chromium executable is not usable"), {
        code: "EACCES",
      });
      throw Object.assign(error, {
        browserClassification: classifyBrowserLaunchError(error, {
          executableUsable: false,
          rootOwned: runtime.executableRootOwned,
        }),
      });
    }

    const work = (async () => {
      const port = await listenLoopback(server);
      browser = await launchBenchmarkChromium({
        playwrightModule,
        playwrightLoader,
        launchOptions: { timeoutMs: launchTimeoutMs },
      });
      if (signal?.aborted) {
        await closeQuietly(browser);
        throw Object.assign(new Error("Headless smoke test interrupted"), {
          name: "AbortError",
        });
      }
      runtime.launchProbe = "pass";
      runtime.browserVersion = browser.version();
      context = await browser.newContext({ serviceWorkers: "block" });
      page = await context.newPage();
      page.setDefaultTimeout(navigationTimeoutMs);
      stage = "cdp";
      cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      let networkEvents = 0;
      cdp.on("Network.requestWillBeSent", (event) => {
        if (event.request?.url?.startsWith(`http://127.0.0.1:${port}/`)) {
          networkEvents += 1;
        }
      });
      stage = "local-page";
      const response = await page.goto(`http://127.0.0.1:${port}/`, {
        waitUntil: "load",
        timeout: navigationTimeoutMs,
      });
      if (response?.status() !== 200) throw new Error("Local page returned a non-200 status");
      if ((await page.textContent("#result")) !== token) throw new Error("Local page body mismatch");
      if (await page.evaluate(() => 6 * 7) !== 42) throw new Error("JavaScript execution failed");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      if (networkEvents < 1) {
        stage = "cdp";
        throw new Error("No loopback request was observed through CDP");
      }
      runtime.localPageProbe = "pass";
      runtime.cdpProbe = "pass";
      return runtime;
    })();

    const timeout = new Promise((_, rejectPromise) => {
      timer = setTimeout(() => {
        stage = "launch-timeout";
        cleanup().finally(() => rejectPromise(
          Object.assign(new Error("Headless smoke test timed out"), {
            name: "TimeoutError",
          })
        ));
      }, overallTimeoutMs);
      timer.unref?.();
    });
    const aborted = new Promise((_, rejectPromise) => {
      if (!signal) return;
      abortHandler = () => {
        cleanup().finally(() => rejectPromise(
          Object.assign(new Error("Headless smoke test interrupted"), {
            name: "AbortError",
          })
        ));
      };
      if (signal.aborted) abortHandler();
      else signal.addEventListener("abort", abortHandler, { once: true });
    });
    return await Promise.race([work, timeout, aborted]);
  } catch (error) {
    if (!error.browserClassification) {
      error.browserClassification = classifyBrowserLaunchError(error, { stage });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
    await cleanup();
  }
};
