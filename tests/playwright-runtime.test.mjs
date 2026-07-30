import test from "node:test";
import assert from "node:assert/strict";
import {
  BROWSER_ERROR_CODES,
  buildChromiumLaunchOptions,
  classifyBrowserLaunchError,
  sanitizeBrowserRuntimeInfo,
} from "../lib/playwright-runtime.mjs";
import { buildReport } from "../lib/report.mjs";

test("Chromium launch is explicitly headless and independent of GUI variables", () => {
  const saved = {
    DISPLAY: process.env.DISPLAY,
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
    XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE,
  };
  try {
    for (const values of [
      [undefined, undefined, undefined],
      [":99", "wayland-1", "wayland"],
    ]) {
      for (const [name, value] of Object.entries({
        DISPLAY: values[0],
        WAYLAND_DISPLAY: values[1],
        XDG_SESSION_TYPE: values[2],
      })) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      const options = buildChromiumLaunchOptions();
      assert.equal(options.headless, true);
      assert.deepEqual(options.args, ["--disable-quic"]);
      assert.ok(!options.args.includes("--no-sandbox"));
    }
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("browser launch failures are classified with bounded fallbacks", () => {
  const classify = (error, context) =>
    classifyBrowserLaunchError(error, context).code;
  assert.equal(classify(
    Object.assign(new Error("Cannot find package 'playwright'"), {
      code: "ERR_MODULE_NOT_FOUND",
    })
  ), BROWSER_ERROR_CODES.PACKAGE_MISSING);
  assert.equal(classify(
    new Error("Executable doesn't exist. Please download new browsers")
  ), BROWSER_ERROR_CODES.NOT_INSTALLED);
  assert.equal(classify(
    Object.assign(new Error("missing"), { code: "ENOENT" }),
    { executableResolved: true, executableMissing: true }
  ), BROWSER_ERROR_CODES.EXECUTABLE_MISSING);
  assert.equal(classify(
    Object.assign(new Error("permission denied"), { code: "EACCES" })
  ), BROWSER_ERROR_CODES.EXECUTABLE_NOT_USABLE);
  assert.equal(classify(
    new Error("cache traversal failed"),
    { rootOwned: true, executableUsable: false }
  ), BROWSER_ERROR_CODES.CACHE_OWNERSHIP_ERROR);
  assert.equal(classify(
    new Error("error while loading shared libraries: libX11.so.6: cannot open")
  ), BROWSER_ERROR_CODES.DEPENDENCIES_MISSING);
  assert.equal(classify(
    Object.assign(new Error("launch timed out"), { name: "TimeoutError" })
  ), BROWSER_ERROR_CODES.LAUNCH_TIMEOUT);
  assert.equal(classify(
    new Error("unsupported platform and architecture")
  ), BROWSER_ERROR_CODES.UNSUPPORTED_PLATFORM);
  assert.equal(classify(new Error("protocol closed"), { stage: "cdp" }),
    BROWSER_ERROR_CODES.CDP_FAILURE);
  assert.equal(classify(new Error("navigation failed"), { stage: "local-page" }),
    BROWSER_ERROR_CODES.LOCAL_PAGE_FAILURE);
  assert.equal(classify(new Error("surprising failure")),
    BROWSER_ERROR_CODES.UNKNOWN_FAILURE);
});

test("shared browser runtime data excludes private environment values and paths", () => {
  const safe = sanitizeBrowserRuntimeInfo({
    mode: "headless",
    executablePath: "/home/alice/.cache/ms-playwright/chromium/chrome",
    displayEnvironmentPresent: true,
    waylandEnvironmentPresent: true,
  });
  assert.equal("executablePath" in safe, false);
  assert.equal(JSON.stringify(safe).includes("/home/alice"), false);
  assert.equal(JSON.stringify(safe).includes(":99"), false);
});

test("Markdown report contains safe browser runtime diagnostics", () => {
  const report = buildReport({
    environment: {
      version: "3.2.0", benchmarkEngineVersion: "0.4.0",
      routingIface: "eth0", physicalIface: "eth0", interfaceChain: ["eth0"],
      originalCc: "cubic", originalQdisc: "fq", currentProfile: "cubic-fq",
      browserRuntime: {
        mode: "headless", xServerRequired: false,
        playwrightVersion: "1.62.0", browserVersion: "123.0",
        launchProbe: "pass", localPageProbe: "pass", cdpProbe: "pass",
      },
    },
    aggregates: [],
    runs: [],
    options: {
      preset: "quick", mode: "balanced", requestedMode: "balanced",
      seed: 1, minScoreGap: 2,
    },
    decision: { status: "no-eligible", reason: "test" },
  });
  assert.match(report, /## Browser runtime/);
  assert.match(report, /Headless: `yes`/);
  assert.doesNotMatch(report, /\/home\//);
});
