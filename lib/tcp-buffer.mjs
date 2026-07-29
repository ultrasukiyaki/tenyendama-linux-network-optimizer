const MIB = 1024 ** 2;
const MAX_BUFFER_BYTES = 256 * MIB;

const integer = (value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (!Number.isSafeInteger(value) || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a safe integer from ${min} through ${max}`);
  }
  return value;
};

export const parseSysctlVector = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("sysctl vector must be a non-empty string");
  }
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) {
    throw new Error("sysctl vector must contain exactly three decimal integers");
  }
  const values = parts.map(Number);
  values.forEach((item, index) => integer(item, `vector[${index}]`, { min: 1 }));
  if (!(values[0] <= values[1] && values[1] <= values[2])) {
    throw new Error("sysctl vector must satisfy min <= default <= max");
  }
  return values;
};

export const formatSysctlVector = (values) => {
  validateVector(values, "vector");
  return values.join(" ");
};

const validateVector = (values, name) => {
  if (!Array.isArray(values) || values.length !== 3) {
    throw new Error(`${name} must contain exactly three integers`);
  }
  values.forEach((item, index) => integer(item, `${name}[${index}]`, { min: 1 }));
  if (!(values[0] <= values[1] && values[1] <= values[2])) {
    throw new Error(`${name} must satisfy min <= default <= max`);
  }
  return values;
};

export const calculateBdpBytes = (mbps, latencyMs) => {
  if (!Number.isFinite(mbps) || mbps <= 0 || !Number.isFinite(latencyMs) || latencyMs <= 0) {
    throw new Error("bandwidth and latency must be positive finite numbers");
  }
  const result = Math.ceil(mbps * latencyMs * 125);
  return integer(result, "BDP", { min: 1 });
};

export const roundUpToMiB = (bytes) => {
  integer(bytes, "bytes", { min: 1 });
  return Math.ceil(bytes / MIB) * MIB;
};

export const calculateAutomaticBufferCap = (memTotalBytes) => {
  integer(memTotalBytes, "MemTotal", { min: 1 });
  return Math.min(64 * MIB, Math.max(4 * MIB, Math.floor(memTotalBytes / 128)));
};

export const validateBufferSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("buffer snapshot must be an object");
  }
  const copy = {
    coreRmemMax: integer(snapshot.coreRmemMax, "coreRmemMax", { min: 1 }),
    coreWmemMax: integer(snapshot.coreWmemMax, "coreWmemMax", { min: 1 }),
    tcpRmem: [...validateVector(snapshot.tcpRmem, "tcpRmem")],
    tcpWmem: [...validateVector(snapshot.tcpWmem, "tcpWmem")],
    tcpModerateRcvbuf: integer(snapshot.tcpModerateRcvbuf, "tcpModerateRcvbuf", { max: 1 }),
  };
  return copy;
};

export const validateBufferProfile = (profile, { allowAboveCap = false } = {}) => {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new Error("profile must be an object");
  }
  if (!/^[a-z0-9][a-z0-9_.@-]{0,127}$/.test(profile.name || "")) {
    throw new Error("profile name is invalid");
  }
  if (!["reno", "cubic", "bbr"].includes(profile.cc)) throw new Error("profile CC is invalid");
  if (!["fq", "fq_codel"].includes(profile.qdisc)) throw new Error("profile qdisc is invalid");
  const buffers = validateBufferSnapshot(profile.buffers);
  if (profile.source !== "current" &&
      (buffers.coreRmemMax < buffers.tcpRmem[2] ||
       buffers.coreWmemMax < buffers.tcpWmem[2])) {
    throw new Error("core buffer maxima must cover TCP buffer maxima");
  }
  if (!allowAboveCap && Math.max(
    buffers.coreRmemMax, buffers.coreWmemMax, buffers.tcpRmem[2], buffers.tcpWmem[2]
  ) > MAX_BUFFER_BYTES) throw new Error("profile exceeds the 256 MiB safety limit");
  return { ...profile, buffers };
};

export const deduplicateBufferCandidates = (candidates) => {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = JSON.stringify(candidate.buffers);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const generateBufferCandidates = ({
  snapshot,
  cc,
  qdisc,
  downloadMedianMbps,
  uploadMedianMbps,
  unloadedLatencyMedianMs,
  memTotalBytes,
  bufferCapBytes,
}) => {
  const current = validateBufferSnapshot(snapshot);
  if (current.tcpModerateRcvbuf !== 1) {
    return { candidates: [], skipped: true, reason: "tcp_moderate_rcvbuf is not enabled" };
  }
  const cap = bufferCapBytes ?? calculateAutomaticBufferCap(memTotalBytes);
  integer(cap, "bufferCapBytes", { min: 4 * MIB, max: MAX_BUFFER_BYTES });
  const receiveBdpBytes = calculateBdpBytes(downloadMedianMbps, unloadedLatencyMedianMs);
  const sendBdpBytes = calculateBdpBytes(uploadMedianMbps, unloadedLatencyMedianMs);
  const base = {
    name: `${cc}-${qdisc}@buffers-current`, cc, qdisc,
    buffers: current, source: "current", bufferFactor: 1,
    receiveBdpBytes, sendBdpBytes, bufferCapBytes: cap,
  };
  const candidates = [base];
  const currentAboveCap = Math.max(
    current.coreRmemMax, current.coreWmemMax, current.tcpRmem[2], current.tcpWmem[2]
  ) > cap;
  if (!currentAboveCap) {
    for (const factor of [2, 4]) {
      const rmax = Math.max(current.tcpRmem[2], Math.min(cap, roundUpToMiB(receiveBdpBytes * factor)));
      const wmax = Math.max(current.tcpWmem[2], Math.min(cap, roundUpToMiB(sendBdpBytes * factor)));
      const buffers = {
        coreRmemMax: Math.max(current.coreRmemMax, rmax),
        coreWmemMax: Math.max(current.coreWmemMax, wmax),
        tcpRmem: [current.tcpRmem[0], current.tcpRmem[1], rmax],
        tcpWmem: [current.tcpWmem[0], current.tcpWmem[1], wmax],
        tcpModerateRcvbuf: 1,
      };
      candidates.push(validateBufferProfile({
        name: `${cc}-${qdisc}@buffers-bdp-${factor}x`, cc, qdisc, buffers,
        source: `bdp-${factor}x`, bufferFactor: factor,
        receiveBdpBytes, sendBdpBytes, bufferCapBytes: cap,
      }));
    }
  }
  const unique = deduplicateBufferCandidates(candidates);
  return {
    candidates: unique,
    skipped: unique.length < 2,
    reason: currentAboveCap
      ? "current values exceed the safety cap and will not be lowered or increased"
      : unique.length < 2 ? "no distinct candidate fits within the safety cap" : null,
    receiveBdpBytes, sendBdpBytes, bufferCapBytes: cap,
  };
};

export { MIB, MAX_BUFFER_BYTES };
