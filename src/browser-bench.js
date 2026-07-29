import SpeedTest from "@cloudflare/speedtest";

const safeCall = (callback, fallback) => {
  try {
    const value = callback();
    return value ?? fallback;
  } catch {
    return fallback;
  }
};

window.runTenyendamaSpeedTest = ({
  latencyPackets = 20,
  downloadBytes = 100_000_000,
  downloadCount = 3,
  uploadBytes = 50_000_000,
  uploadCount = 3,
  measureLoadedLatency = true,
} = {}) =>
  new Promise((resolve, reject) => {
    performance.clearResourceTimings();
    performance.setResourceTimingBufferSize(4000);

    const speedTest = new SpeedTest({
      autoStart: false,
      measurements: [
        { type: "latency", numPackets: latencyPackets },
        {
          type: "download",
          bytes: downloadBytes,
          count: downloadCount,
          bypassMinDuration: true,
        },
        {
          type: "upload",
          bytes: uploadBytes,
          count: uploadCount,
          bypassMinDuration: true,
        },
      ],
      measureDownloadLoadedLatency: measureLoadedLatency,
      measureUploadLoadedLatency: measureLoadedLatency,
      loadedLatencyMaxPoints: 200,
      bandwidthMinRequestDuration: 0,
      bandwidthFinishRequestDuration: 0,
      bandwidthAbortRequestDuration: 0,
    });

    speedTest.onFinish = (results) => {
      resolve({
        summary: safeCall(() => results.getSummary(), {}),
        scores: safeCall(() => results.getScores(), {}),
        totalDurationMs: safeCall(() => results.getTotalDurationMs(), null),
        unloadedLatencyMs: safeCall(() => results.getUnloadedLatency(), null),
        unloadedJitterMs: safeCall(() => results.getUnloadedJitter(), null),
        unloadedLatencyPoints: safeCall(
          () => results.getUnloadedLatencyPoints(),
          []
        ),
        downloadLoadedLatencyMs: safeCall(
          () => results.getDownLoadedLatency(),
          null
        ),
        downloadLoadedLatencyPoints: safeCall(
          () => results.getDownLoadedLatencyPoints(),
          []
        ),
        uploadLoadedLatencyMs: safeCall(
          () => results.getUpLoadedLatency(),
          null
        ),
        uploadLoadedLatencyPoints: safeCall(
          () => results.getUpLoadedLatencyPoints(),
          []
        ),
        downloadBandwidthBps: safeCall(
          () => results.getDownloadBandwidth(),
          null
        ),
        downloadPoints: safeCall(
          () => results.getDownloadBandwidthPoints(),
          []
        ),
        uploadBandwidthBps: safeCall(
          () => results.getUploadBandwidth(),
          null
        ),
        uploadPoints: safeCall(
          () => results.getUploadBandwidthPoints(),
          []
        ),
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
      });
    };

    speedTest.onError = (error) => {
      reject(new Error(String(error || "Cloudflare Speedtest error")));
    };

    speedTest.play();
  });
