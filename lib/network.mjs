import {
  access,
  readFile,
  readdir,
  readlink,
  stat,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, join } from "node:path";
import { isIP } from "node:net";
import { commandSnapshot, commandText } from "./commands.mjs";

const exists = async (path) => {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const readText = async (path, fallback = "") => {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return fallback;
  }
};

export const detectRoutingInterface = async () => {
  for (const args of [
    ["-json", "route", "show", "default"],
    ["-6", "-json", "route", "show", "default"],
  ]) {
    const output = await commandText("ip", args, { allowFailure: true });
    if (!output) continue;
    try {
      const routes = JSON.parse(output)
        .filter((route) => route.dev)
        .sort((a, b) => (a.metric ?? 0) - (b.metric ?? 0));
      if (routes[0]?.dev) return routes[0].dev;
    } catch {
      // Try next source.
    }
  }
  throw new Error("Default route interface could not be detected");
};

const interfaceIndexMap = async () => {
  const map = new Map();
  for (const name of await readdir("/sys/class/net")) {
    const index = await readText(`/sys/class/net/${name}/ifindex`);
    if (index) map.set(index, name);
  }
  return map;
};

const lowerInterfaces = async (iface) => {
  const directory = `/sys/class/net/${iface}`;
  const names = await readdir(directory);
  return names
    .filter((name) => name.startsWith("lower_"))
    .map((name) => name.slice("lower_".length));
};

const interfaceState = async (iface) => ({
  iface,
  carrier: await readText(`/sys/class/net/${iface}/carrier`, "0"),
  operstate: await readText(`/sys/class/net/${iface}/operstate`, "unknown"),
});

const chooseLower = async (ifaces) => {
  const states = await Promise.all(ifaces.map(interfaceState));
  const active = states.filter(
    (item) => item.carrier === "1" || item.operstate === "up"
  );
  if (active.length === 1) return active[0].iface;
  if (active.length > 1) {
    throw new Error(
      `Multiple active lower interfaces were detected: ${active
        .map((item) => item.iface)
        .join(", ")}. Specify --iface explicitly.`
    );
  }
  if (states.length === 1) return states[0].iface;
  throw new Error(
    `Unable to choose a physical lower interface from: ${ifaces.join(", ")}`
  );
};

export const resolvePhysicalEgress = async (routingIface) => {
  const visited = new Set();
  const chain = [];
  const indexMap = await interfaceIndexMap();

  const walk = async (iface) => {
    if (visited.has(iface)) {
      throw new Error(`Interface dependency loop detected at ${iface}`);
    }
    visited.add(iface);
    chain.push(iface);

    const bondActive = await readText(
      `/sys/class/net/${iface}/bonding/active_slave`
    );
    if (bondActive) return walk(bondActive);

    const lowers = await lowerInterfaces(iface);
    if (lowers.length > 0) return walk(await chooseLower(lowers));

    const hasDevice = await exists(`/sys/class/net/${iface}/device`);
    if (hasDevice) {
      return { routingIface, physicalIface: iface, chain, isPhysical: true };
    }

    const ifindex = await readText(`/sys/class/net/${iface}/ifindex`);
    const iflink = await readText(`/sys/class/net/${iface}/iflink`);
    if (iflink && iflink !== ifindex && indexMap.has(iflink)) {
      return walk(indexMap.get(iflink));
    }

    return {
      routingIface,
      physicalIface: iface,
      chain,
      isPhysical: false,
      warning: `No hardware device was found below ${iface}; using the routing interface itself.`,
    };
  };

  return walk(routingIface);
};

export const parseRemoteAddress = (value, explicitPort = null) => {
  const input = typeof value === "string" ? value.trim() : "";
  let address = input;
  let port = Number.isInteger(explicitPort) ? explicitPort : null;

  const bracketed = input.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketed) {
    address = bracketed[1];
    if (bracketed[2]) port = Number(bracketed[2]);
  } else if (isIP(input) !== 6) {
    const ipv4WithPort = input.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
    if (ipv4WithPort) {
      address = ipv4WithPort[1];
      port = Number(ipv4WithPort[2]);
    }
  }

  const family = isIP(address);
  const validPort = port === null || (port >= 0 && port <= 65535);
  return {
    address: family && validPort ? address : null,
    port: family && validPort ? port : null,
    ipFamily: family === 4 ? "IPv4" : family === 6 ? "IPv6" : "unknown",
    valid: Boolean(family && validPort),
  };
};

export const parseRouteGetOutput = (output) => {
  const text = typeof output === "string" ? output.trim() : "";
  const token = (name) => text.match(new RegExp(`(?:^|\\s)${name}\\s+(\\S+)`))?.[1] || null;
  return {
    routingDevice: token("dev"),
    sourceAddress: token("src"),
    gateway: token("via"),
    routeRawOutput: text,
  };
};

export const lookupRoute = async (remoteIP, runner = commandSnapshot) => {
  const family = isIP(remoteIP);
  const args = [family === 6 ? "-6" : "-4", "route", "get", remoteIP];
  if (!family) {
    return {
      remoteIP, ipFamily: "unknown", routeCommand: null,
      routingDevice: null, sourceAddress: null, gateway: null,
      routeRawOutput: "", routeLookupSucceeded: false,
    };
  }
  const snapshot = await runner("ip", args, 15_000);
  const raw = snapshot.stdout || snapshot.stderr || "";
  const parsed = parseRouteGetOutput(raw);
  return {
    remoteIP,
    ipFamily: family === 4 ? "IPv4" : "IPv6",
    routeCommand: `ip ${args.slice(0, -1).join(" ")} ${remoteIP}`,
    ...parsed,
    routeLookupSucceeded:
      snapshot.exitCode === 0 && Boolean(parsed.routingDevice),
  };
};

export const validateTrafficRoutes = async ({
  protocolRecords,
  selectedPhysicalEgress,
  routeLookup = lookupRoute,
  resolveEgress = resolvePhysicalEgress,
}) => {
  const addresses = [...new Set((protocolRecords || [])
    .map((record) => parseRemoteAddress(record.remoteIPAddress, record.remotePort))
    .filter((item) => item.valid)
    .map((item) => item.address))];
  const routeRecords = [];
  for (const remoteIP of addresses) {
    const route = await routeLookup(remoteIP);
    let resolved = null;
    if (route.routeLookupSucceeded) {
      try { resolved = await resolveEgress(route.routingDevice); } catch { resolved = null; }
    }
    const physicalEgress = resolved?.physicalIface || null;
    routeRecords.push({
      ...route,
      physicalEgress,
      interfaceChain: resolved?.chain || (route.routingDevice ? [route.routingDevice] : []),
      matchesSelectedEgress: physicalEgress === selectedPhysicalEgress,
    });
  }
  const ipFamilies = [...new Set(routeRecords.map((item) => item.ipFamily))];
  const routeWarnings = [];
  if (ipFamilies.includes("IPv4") && ipFamilies.includes("IPv6")) {
    routeWarnings.push("Mixed IPv4/IPv6 target connections detected.");
  }
  let routeValidationStatus = "pass";
  let routeFailureReason = null;
  if (!routeRecords.length || routeRecords.some((item) =>
    !item.routeLookupSucceeded || !item.physicalEgress)) {
    routeValidationStatus = "unknown";
    routeFailureReason = "The measured traffic path could not be fully resolved.";
  } else if (routeRecords.some((item) => !item.matchesSelectedEgress)) {
    routeValidationStatus = "fail";
    routeFailureReason =
      "The measured traffic path did not match the selected physical egress interface.";
  } else if (routeRecords.some((item) =>
    /^(?:wl|tun|tap|wg|tailscale|zt|ppp|ipsec)/i.test(
      item.physicalEgress || item.routingDevice || ""
    ))) {
    routeValidationStatus = "fail";
    routeFailureReason =
      "The measured traffic used a Wi-Fi, VPN, or tunnel interface.";
  }
  return {
    routeValidationStatus,
    remoteIPs: routeRecords.map((item) => item.remoteIP),
    ipFamilies,
    actualRoutingDevices: [...new Set(routeRecords.map((item) => item.routingDevice).filter(Boolean))],
    actualPhysicalEgresses: [...new Set(routeRecords.map((item) => item.physicalEgress).filter(Boolean))],
    routeWarnings,
    routeFailureReason,
    routeRecords,
  };
};

const readCounter = async (iface, name) => {
  const value = Number(
    await readText(`/sys/class/net/${iface}/statistics/${name}`, "0")
  );
  return Number.isFinite(value) ? value : 0;
};

export const measureBackgroundTraffic = async (iface, seconds) => {
  const startedAt = process.hrtime.bigint();
  const before = {
    rx: await readCounter(iface, "rx_bytes"),
    tx: await readCounter(iface, "tx_bytes"),
  };

  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

  const after = {
    rx: await readCounter(iface, "rx_bytes"),
    tx: await readCounter(iface, "tx_bytes"),
  };
  const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

  return {
    elapsedSeconds,
    rxMbps: Math.max(0, after.rx - before.rx) * 8 / elapsedSeconds / 1_000_000,
    txMbps: Math.max(0, after.tx - before.tx) * 8 / elapsedSeconds / 1_000_000,
  };
};

export const qdiscKind = async (iface) => {
  const output = await commandText("tc", ["qdisc", "show", "dev", iface]);
  const first = output.split("\n")[0] || "";
  return first.trim().split(/\s+/)[1] || "unknown";
};

export const collectEnvironment = async ({ routingIface, physicalIface }) => {
  const commands = [
    ["uname", ["-a"]],
    ["cat", ["/etc/os-release"]],
    ["lscpu", ["--json"]],
    ["ip", ["-4", "-json", "route", "show", "default"]],
    ["ip", ["-6", "-json", "route", "show", "default"]],
    ["ip", ["-json", "route", "show"]],
    ["ip", ["-details", "-json", "link", "show"]],
    ["ip", ["-json", "address", "show"]],
    ["tc", ["-s", "qdisc", "show", "dev", physicalIface]],
    ["ethtool", ["-i", physicalIface]],
    ["ethtool", [physicalIface]],
    ["ethtool", ["-k", physicalIface]],
    ["ethtool", ["-g", physicalIface]],
    ["nmcli", ["-t", "-f", "NAME,TYPE,DEVICE", "connection", "show", "--active"]],
    ["sysctl", [
      "net.ipv4.tcp_available_congestion_control",
      "net.ipv4.tcp_congestion_control",
      "net.core.default_qdisc",
      "net.core.rmem_max",
      "net.core.wmem_max",
      "net.ipv4.tcp_rmem",
      "net.ipv4.tcp_wmem",
      "net.ipv4.tcp_mtu_probing",
      "net.core.netdev_max_backlog",
    ]],
  ];

  const snapshots = {};
  for (const [command, args] of commands) {
    const key = [command, ...args].join(" ");
    snapshots[key] = await commandSnapshot(command, args, 45_000);
  }

  const parseSnapshot = (key) => {
    try { return JSON.parse(snapshots[key]?.stdout || "[]"); } catch { return []; }
  };
  const ipv4DefaultRoutes = parseSnapshot("ip -4 -json route show default");
  const ipv6DefaultRoutes = parseSnapshot("ip -6 -json route show default");
  const links = parseSnapshot("ip -details -json link show");
  const activeInterfaces = links.filter((link) =>
    link.operstate === "UP" || (link.flags || []).includes("UP")
  ).map((link) => link.ifname);
  const wifiInterfaces = activeInterfaces.filter((name) => /^wl/.test(name));
  const tunnelInterfaces = activeInterfaces.filter((name) =>
    /^(tun|tap|wg|tailscale|zt|ppp|ipsec)/i.test(name)
  );
  return {
    collectedAt: new Date().toISOString(),
    routingIface,
    physicalIface,
    ipv4DefaultRoutes,
    ipv6DefaultRoutes,
    activeInterfaces,
    selectedRoutingInterface: routingIface,
    selectedPhysicalInterface: physicalIface,
    multipleDefaultRouteWarning:
      ipv4DefaultRoutes.length + ipv6DefaultRoutes.length > 2,
    activeWifiWarning: wifiInterfaces.length ? wifiInterfaces : null,
    activeVpnTunnelWarning: tunnelInterfaces.length ? tunnelInterfaces : null,
    sysfs: {
      routingOperstate: await readText(
        `/sys/class/net/${routingIface}/operstate`,
        "unknown"
      ),
      physicalOperstate: await readText(
        `/sys/class/net/${physicalIface}/operstate`,
        "unknown"
      ),
      physicalCarrier: await readText(
        `/sys/class/net/${physicalIface}/carrier`,
        "unknown"
      ),
      physicalMtu: await readText(
        `/sys/class/net/${physicalIface}/mtu`,
        "unknown"
      ),
      physicalAddress: await readText(
        `/sys/class/net/${physicalIface}/address`,
        "unknown"
      ),
    },
    commands: snapshots,
  };
};
