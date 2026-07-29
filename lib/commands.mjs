import { spawn } from "node:child_process";

export const runCommand = (
  command,
  args = [],
  {
    capture = true,
    allowFailure = false,
    timeoutMs = 30_000,
    stdin = "ignore",
  } = {}
) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: capture ? [stdin, "pipe", "pipe"] : [stdin, "inherit", "inherit"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer;

    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      }, timeoutMs);
      timer.unref();
    }

    const finish = (error, code = null, signal = null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);

      if (error) {
        reject(error);
        return;
      }

      const result = { code, signal, stdout, stderr };
      if (code === 0 || allowFailure) {
        resolve(result);
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} exited with ${code ?? signal}\n${stdout}${stderr}`.trim()
        )
      );
    };

    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => finish(null, code, signal));
  });

export const commandText = async (command, args = [], options = {}) => {
  const result = await runCommand(command, args, {
    capture: true,
    ...options,
  });
  return result.stdout.trim();
};

export const commandSnapshot = async (command, args = [], timeoutMs = 30_000) => {
  try {
    const result = await runCommand(command, args, {
      capture: true,
      allowFailure: true,
      timeoutMs,
    });
    return {
      command: [command, ...args],
      exitCode: result.code,
      signal: result.signal,
      stdout: result.stdout.trimEnd(),
      stderr: result.stderr.trimEnd(),
    };
  } catch (error) {
    return {
      command: [command, ...args],
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: error.message,
    };
  }
};
