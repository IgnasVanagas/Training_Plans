const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.resolve(__dirname, "..", "..");
const composeFile = process.env.TP_INTEGRATION_COMPOSE_FILE || path.join(projectRoot, "docker-compose.integration.yml");
const composeProjectName = process.env.TP_INTEGRATION_COMPOSE_PROJECT || "training_plans_integration";
const composeArgsPrefix = ["compose", "-p", composeProjectName, "-f", composeFile];

function normalizeUrl(value) {
  return String(value).replace(/\/$/, "");
}

function frontendBaseUrl() {
  return normalizeUrl(process.env.TP_INTEGRATION_BASE_URL || "http://127.0.0.1:3300");
}

function backendBaseUrl() {
  return normalizeUrl(process.env.TP_INTEGRATION_API_URL || "http://127.0.0.1:38000");
}

function frontendLoginUrl() {
  return `${frontendBaseUrl()}/login`;
}

function backendHealthUrl() {
  return `${backendBaseUrl()}/health`;
}

function runCommand(command, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || allowFailure) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function runCompose(args, options) {
  await runCommand("docker", [...composeArgsPrefix, ...args], options);
}

async function upIntegrationStack({ build = true } = {}) {
  const args = ["up", "-d"];
  if (build) {
    args.splice(1, 0, "--build");
  }
  await runCompose(args);
}

async function downIntegrationStack() {
  await runCompose(["down", "-v", "--remove-orphans"], { allowFailure: true });
}

async function waitForUrl(url, { label = url, timeoutMs = 240_000, intervalMs = 2_000 } = {}) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "Cache-Control": "no-cache",
        },
      });

      if (response.ok) {
        return;
      }

      lastError = new Error(`${label} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for ${label}: ${lastError ? lastError.message : "unknown error"}`);
}

module.exports = {
  backendBaseUrl,
  backendHealthUrl,
  composeFile,
  composeProjectName,
  downIntegrationStack,
  frontendBaseUrl,
  frontendLoginUrl,
  projectRoot,
  upIntegrationStack,
  waitForUrl,
};