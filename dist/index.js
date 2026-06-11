import { buildDefaultPintoChannelConfig, pintoPlugin, setPintoRuntime, } from "./channel.js";
const plugin = {
    id: "pinto-app-openclaw",
    name: "Pinto Chat",
    description: "Plugin to connect Pinto Chat with OpenClaw AI Agents",
    register(api) {
        const logger = api.runtime?.logger;
        const runtimeConfig = api.runtime?.config;
        setPintoRuntime(api.runtime);
        try {
            const currentCfg = runtimeConfig?.loadConfig?.();
            if (currentCfg &&
                typeof currentCfg === "object" &&
                !Array.isArray(currentCfg)) {
                const typedCfg = currentCfg;
                const currentChannels = typedCfg.channels &&
                    typeof typedCfg.channels === "object" &&
                    !Array.isArray(typedCfg.channels)
                    ? typedCfg.channels
                    : {};
                if (!currentChannels.pinto) {
                    const nextCfg = {
                        ...typedCfg,
                        channels: {
                            ...currentChannels,
                            pinto: buildDefaultPintoChannelConfig(),
                        },
                    };
                    void runtimeConfig?.writeConfigFile?.(nextCfg);
                    logger?.info("Pinto Chat Plugin initialized default channels.pinto config");
                }
            }
        }
        catch (error) {
            logger?.error?.(`Pinto Chat Plugin failed to initialize default config: ${error instanceof Error ? error.message : String(error)}`);
        }
        api.registerChannel({
            plugin: pintoPlugin,
        });
        logger?.info("Pinto Chat Plugin Registered successfully");
    },
};
export default plugin;
//# sourceMappingURL=index.js.map