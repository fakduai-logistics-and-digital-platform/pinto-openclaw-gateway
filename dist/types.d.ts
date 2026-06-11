/**
 * Pinto Request Payload (Inbound to OpenClaw)
 */
export interface PintoWebhookPayload {
    user_id: string;
    username?: string;
    message: string;
    image_url?: string;
    imageUrl?: string;
    media_url?: string;
    mediaUrl?: string;
    url?: string;
    attachment?: unknown;
    attachments?: unknown;
    file?: unknown;
    files?: unknown;
    image?: unknown;
    images?: unknown;
    media?: unknown;
    medias?: unknown;
    chat_id: string;
    bot_id: string;
}
/**
 * Pinto Response Payload (Outbound to Pinto)
 */
export interface PintoWebhookReceiveRequest {
    bot_id: string;
    chat_id: string;
    reply_message: string;
    media_url?: string;
    webhook_secret?: string;
}
/**
 * Plugin Configuration
 */
export interface PintoPluginConfig {
    pintoApiUrl: string;
    pintoWebhookSecret?: string;
}
//# sourceMappingURL=types.d.ts.map