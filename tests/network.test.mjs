import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRemoteAddress,
  parseRouteGetOutput,
  validateTrafficRoutes,
} from "../lib/network.mjs";
import { evaluateConfirmation } from "../lib/optimizer.mjs";

test("remote address parsing supports IPv4 and IPv6 with optional ports", () => {
  assert.deepEqual(parseRemoteAddress("104.16.1.1"), {
    address: "104.16.1.1", port: null, ipFamily: "IPv4", valid: true,
  });
  assert.equal(parseRemoteAddress("104.16.1.1:443").port, 443);
  assert.equal(parseRemoteAddress("2606:4700::1234").ipFamily, "IPv6");
  assert.equal(parseRemoteAddress("[2606:4700::1234]:443").port, 443);
  assert.equal(parseRemoteAddress("invalid input").valid, false);
  assert.equal(parseRemoteAddress("").valid, false);
});

test("route output parsing handles IPv4, IPv6, and Wi-Fi", () => {
  const ipv4 = parseRouteGetOutput(
    "104.16.1.1 via 192.168.1.1 dev bridge0 src 192.168.1.175"
  );
  assert.deepEqual(
    [ipv4.routingDevice, ipv4.gateway, ipv4.sourceAddress],
    ["bridge0", "192.168.1.1", "192.168.1.175"]
  );
  assert.equal(parseRouteGetOutput(
    "2606:4700::1234 via fe80::1 dev bridge0 src 240b::1"
  ).routingDevice, "bridge0");
  assert.equal(parseRouteGetOutput(
    "104.16.1.1 via 192.168.1.1 dev wlp2s0 src 192.168.1.230"
  ).routingDevice, "wlp2s0");
});

const protocol = (address) => ({
  remoteIPAddress: address, remotePort: 443, protocol: "h2",
});
const lookup = async (remoteIP) => ({
  remoteIP,
  ipFamily: remoteIP.includes(":") ? "IPv6" : "IPv4",
  routingDevice: remoteIP.endsWith(".2") ? "wlp2s0" : "bridge0",
  routeLookupSucceeded: true,
  routeRawOutput: "",
});
const resolve = async (routingIface) => ({
  physicalIface: routingIface === "bridge0" ? "enp1s0" : routingIface,
  chain: routingIface === "bridge0" ? ["bridge0", "enp1s0"] : [routingIface],
});

test("traffic route validation passes, warns, fails, and is unknown safely", async () => {
  const pass = await validateTrafficRoutes({
    protocolRecords: [protocol("104.16.1.1")],
    selectedPhysicalEgress: "enp1s0", routeLookup: lookup, resolveEgress: resolve,
  });
  assert.equal(pass.routeValidationStatus, "pass");

  const mixed = await validateTrafficRoutes({
    protocolRecords: [protocol("104.16.1.1"), protocol("2606:4700::1234")],
    selectedPhysicalEgress: "enp1s0", routeLookup: lookup, resolveEgress: resolve,
  });
  assert.equal(mixed.routeValidationStatus, "pass");
  assert.equal(mixed.routeWarnings.length, 1);

  const wifi = await validateTrafficRoutes({
    protocolRecords: [protocol("104.16.1.2")],
    selectedPhysicalEgress: "enp1s0", routeLookup: lookup, resolveEgress: resolve,
  });
  assert.equal(wifi.routeValidationStatus, "fail");

  const tunnel = await validateTrafficRoutes({
    protocolRecords: [protocol("104.16.1.1")],
    selectedPhysicalEgress: "tun0", routeLookup: async (remoteIP) => ({
      remoteIP, ipFamily: "IPv4", routingDevice: "tun0",
      routeLookupSucceeded: true, routeRawOutput: "",
    }), resolveEgress: async () => ({ physicalIface: "tun0", chain: ["tun0"] }),
  });
  assert.equal(tunnel.routeValidationStatus, "fail");

  const partial = await validateTrafficRoutes({
    protocolRecords: [protocol("104.16.1.1"), protocol("104.16.1.2")],
    selectedPhysicalEgress: "enp1s0", routeLookup: lookup, resolveEgress: resolve,
  });
  assert.equal(partial.routeValidationStatus, "fail");

  const unknown = await validateTrafficRoutes({
    protocolRecords: [protocol("104.16.1.1")],
    selectedPhysicalEgress: "enp1s0",
    routeLookup: async () => ({ routeLookupSucceeded: false, ipFamily: "IPv4" }),
    resolveEgress: resolve,
  });
  assert.equal(unknown.routeValidationStatus, "unknown");
});

test("persistence requires a passing route and matching winner/gap", () => {
  const base = {
    candidateProfile: "bbr-fq",
    currentProfile: "cubic-fq",
    decision: { status: "winner", recommendedProfile: "bbr-fq", scoreGap: 3 },
    profileSummaries: [
      { profile: "bbr-fq", eligible: true },
      { profile: "cubic-fq", eligible: true },
    ],
  };
  const run = {
    profile: "bbr-fq", protocolValid: true, routeValidationStatus: "pass",
    spike100Count: 0, loadedLatencyMaxMs: 30,
  };
  assert.equal(evaluateConfirmation({ ...base, runs: [run] }).accepted, true);
  assert.equal(evaluateConfirmation({
    ...base, runs: [{ ...run, routeValidationStatus: "fail" }],
  }).accepted, false);
  assert.equal(evaluateConfirmation({
    ...base, runs: [{ ...run, routeValidationStatus: "unknown" }],
  }).accepted, false);
  assert.equal(evaluateConfirmation({
    ...base, decision: { status: "winner", recommendedProfile: "cubic-fq", scoreGap: 3 },
    runs: [run],
  }).accepted, false);
  assert.equal(evaluateConfirmation({
    ...base, decision: { status: "winner", recommendedProfile: "bbr-fq", scoreGap: 1 },
    runs: [run],
  }).accepted, false);
  assert.equal(evaluateConfirmation({
    ...base, runs: [run], backgroundTrafficPassed: false,
  }).accepted, false);
});
