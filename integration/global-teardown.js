const { downIntegrationStack } = require("./utils/stack");

module.exports = async () => {
  if (process.env.TP_INTEGRATION_SKIP_STACK === "1") {
    return;
  }

  await downIntegrationStack();
};