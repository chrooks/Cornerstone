import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, "..");
const nextCli = path.join(frontendDir, "node_modules", "next", "dist", "bin", "next");
const nextDir = path.join(frontendDir, ".next");
// ponytail: 3000/3001 are permanently owned by the homepage/homepage-dev
// containers on this host, not orphaned dev servers — never offer to kill them
const preferredPorts = [3002, 3003, 3004];

let cleaningUp = false;
let forwardedSignal = null;
const signalExitCodes = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

async function cleanup() {
  if (cleaningUp) {
    return;
  }

  cleaningUp = true;
  await rm(nextDir, { recursive: true, force: true });
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: frontendDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function parseLsofOutput(output) {
  const lines = output.trim().split("\n").filter(Boolean).slice(1);
  return lines.map((line) => {
    const [command, pid, user, , , , , , ...nameParts] = line.trim().split(/\s+/);
    return { pid, command, user, name: nameParts.join(" ") };
  });
}

async function getPortProcesses(port) {
  const result = await runCommand("lsof", [
    "-nP",
    "+c",
    "0",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
  ]);

  if (result.code !== 0) {
    return [];
  }

  return parseLsofOutput(result.stdout);
}

function formatProcess(process) {
  const name = process.name ? ` ${process.name}` : "";
  return `${process.command} pid ${process.pid} user ${process.user}${name}`;
}

async function readPipedAnswers() {
  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
}

async function askYesNo({ rl, pipedAnswers }, message, defaultAnswer = false) {
  const suffix = defaultAnswer ? "Y/n" : "y/N";
  const prompt = `${message} (${suffix}) `;
  const rawAnswer = pipedAnswers ? pipedAnswers.shift() ?? "" : await rl.question(prompt);
  const answer = rawAnswer.trim().toLowerCase();

  if (pipedAnswers) {
    process.stdout.write(prompt);
    process.stdout.write(`${rawAnswer}\n`);
  }

  if (answer === "") {
    return defaultAnswer;
  }

  return answer === "y" || answer === "yes";
}

async function killProcesses(processes) {
  const uniquePids = [...new Set(processes.map((process) => process.pid))];
  const results = await Promise.all(uniquePids.map((pid) => runCommand("kill", [pid])));
  const failed = results.find((result) => result.code !== 0);

  if (failed) {
    throw new Error(failed.stderr.trim() || "Unable to kill one or more processes.");
  }
}

async function waitForPortToClear(port) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const processes = await getPortProcesses(port);
    if (processes.length === 0) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}

async function selectDevPort() {
  const promptState = process.stdin.isTTY
    ? {
        rl: readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        }),
        pipedAnswers: null,
      }
    : {
        rl: null,
        pipedAnswers: await readPipedAnswers(),
      };

  try {
    console.log("\nFrontend Dev Server Port Wizard\n");

    for (const port of preferredPorts) {
      const processes = await getPortProcesses(port);

      if (processes.length === 0) {
        console.log(`Port ${port}: available`);
        return port;
      }

      console.log(`Port ${port}: in use`);
      for (const process of processes) {
        console.log(`  - ${formatProcess(process)}`);
      }

      const shouldKill = await askYesNo(promptState, `Kill process(es) on port ${port}?`, false);
      if (!shouldKill) {
        continue;
      }

      await killProcesses(processes);
      const cleared = await waitForPortToClear(port);

      if (!cleared) {
        console.log(`Port ${port}: still in use after kill; continuing.`);
        continue;
      }

      console.log(`Port ${port}: cleared`);
      return port;
    }
  } finally {
    promptState.rl?.close();
  }

  throw new Error("Ports 3002, 3003, and 3004 are all still in use.");
}

let selectedPort;

try {
  selectedPort = await selectDevPort();
} catch (error) {
  console.error(error.message);
  await cleanup();
  process.exit(1);
}

const nextDev = spawn(process.execPath, [nextCli, "dev", "-p", String(selectedPort)], {
  cwd: frontendDir,
  stdio: "inherit",
});

for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    forwardedSignal = signal;
    nextDev.kill(signal);
  });
}

nextDev.on("exit", async (code, signal) => {
  try {
    await cleanup();
  } catch (error) {
    console.error("Failed to remove .next after dev server exit:", error);
    process.exitCode = 1;
    return;
  }

  const exitSignal = signal ?? forwardedSignal;
  process.exitCode = signalExitCodes[exitSignal] ?? code ?? 0;
});

nextDev.on("error", async (error) => {
  console.error("Failed to start Next.js dev server:", error);

  try {
    await cleanup();
  } catch (cleanupError) {
    console.error("Failed to remove .next after startup failure:", cleanupError);
  }

  process.exitCode = 1;
});
