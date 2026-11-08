require("dotenv").config();

const { createApp } = require("./app");
const config = require("./config");
const app = createApp();

const deploymentPort = Number(process.env.PORT);
if (Number.isInteger(deploymentPort) && deploymentPort > 0) {
  app.listen(deploymentPort, () => console.log(`Villa Tjeozabel listening on port ${deploymentPort}`));
} else {
  app.listen(config.apiPort, () => console.log(`Villa Tjeozabel API listening on http://localhost:${config.apiPort}`));
  if (config.webPort !== config.apiPort) {
    app.listen(config.webPort, () => console.log(`Villa Tjeozabel website listening on http://localhost:${config.webPort}`));
  }
}