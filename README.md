# 🔌 Pinto OpenClaw Gateway Plugin

This is a **Channel Plugin** for [OpenClaw](https://openclaw.ai) that enables seamless integration with the Pinto Chat platform.

## 🚀 Future Installation Guide

When you are ready to move this to your OpenClaw instance:

1.  **Move the Folder:**
    Copy this `pinto-openclaw-gateway` folder into the `extensions/` directory of your OpenClaw project.

2.  **Install Dependencies:**
    ```bash
    cd extensions/pinto-openclaw-gateway
    npm install
    ```

3.  **Build the Plugin:**
    ```bash
    npm run build
    ```

4.  **Configure OpenClaw:**
    In your `openclaw.config.json` (or via the UI), enable the `pinto` extension and provide the `pintoApiUrl` (e.g., `https://api.pinto-app.com`).

5.  **Setup Bot in Pinto:**
    Set the Bot's Webhook URL to:
    `http://<your-openclaw-ip>:3000/plugins/pinto/webhook`

## 🛠️ Features

- **Asynchronous Communication:** Supports long-running AI tasks without timing out.
- **Typing Indicators:** Automatically shows "Bot is typing..." in Pinto while OpenClaw is processing.
- **Media Support:** Seamlessly handle images/media between both platforms.
- **Multi-Instance Support:** Each Bot in Pinto can point to a different OpenClaw instance with its own API Key.

## 📦 Tech Stack
- TypeScript
- OpenClaw Plugin SDK
- Node.js Fetch API
