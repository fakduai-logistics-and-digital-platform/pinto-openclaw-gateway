import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { pintoPlugin, setPintoRuntime } from "./channel.js";

const plugin = {
  id: "pinto-app-openclaw",
  name: "Pinto Chat",
  description: "Plugin to connect Pinto Chat with OpenClaw AI Agents",

  register(api: OpenClawPluginApi) {
    const logger = (api.runtime as any)?.logger;

    setPintoRuntime(api.runtime as any);

    api.registerChannel({
      plugin: pintoPlugin,
    });

    logger?.info("Pinto Chat Plugin Registered successfully");
  },
};

export default plugin;
