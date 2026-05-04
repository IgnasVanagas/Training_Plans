const { downIntegrationStack, upIntegrationStack, waitForUrl, backendHealthUrl, frontendLoginUrl } = require("./utils/stack");

module.exports = async () => {
  if (process.argv.includes("--list")) {
    return;
  }

  if (process.env.TP_INTEGRATION_SKIP_STACK === "1") {
    await waitForUrl(backendHealthUrl(), { label: "backend health" });
    await waitForUrl(frontendLoginUrl(), { label: "frontend login" });
    return;
  }

  await downIntegrationStack();
  await upIntegrationStack({ build: process.env.TP_INTEGRATION_BUILD !== "0" });
  await waitForUrl(backendHealthUrl(), { label: "backend health" });
  await waitForUrl(frontendLoginUrl(), { label: "frontend login" });
};