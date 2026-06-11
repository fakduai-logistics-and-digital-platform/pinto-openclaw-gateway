import type { ChannelPlugin, PluginRuntime as RuntimeEnv } from "openclaw/plugin-sdk/core";
export declare const setPintoRuntime: (r: RuntimeEnv) => void;
export declare const buildDefaultPintoChannelConfig: () => {
    enabled: boolean;
    apiUrl: string;
    botId: string;
    agentId: string;
    webhookSecret: string;
    webhookPath: string;
};
export declare const pintoPlugin: ChannelPlugin<any, any> & {
    configSchema?: any;
};
//# sourceMappingURL=channel.d.ts.map