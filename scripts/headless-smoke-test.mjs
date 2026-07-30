import {
  formatBrowserRuntimeError,
  probeHeadlessChromium,
  sanitizeBrowserRuntimeInfo,
} from "../lib/playwright-runtime.mjs";

let interrupted = null;
const abortController = new AbortController();
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    interrupted = signal;
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    abortController.abort();
  });
}

try {
  const runtime = await probeHeadlessChromium({ signal: abortController.signal });
  if (interrupted) throw new Error(`Interrupted by ${interrupted}`);
  const safe = sanitizeBrowserRuntimeInfo(runtime);
  console.log("Headless Chromium smoke test: PASS");
  console.log(`Playwright: ${safe.playwrightVersion}`);
  console.log(`Chromium:   ${safe.browserVersion}`);
  console.log("Display server required: no");
  console.log("Local page: pass");
  console.log("CDP Network: pass");
} catch (error) {
  const classification = error.browserClassification;
  console.error(
    classification
      ? formatBrowserRuntimeError(classification)
      : `BROWSER_UNKNOWN_FAILURE: ${error.message}`
  );
  process.exitCode = process.exitCode || 1;
}
