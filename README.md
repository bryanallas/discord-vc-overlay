# Discord VC Overlay

A transparent, draggable macOS overlay for the voice channel selected in the Discord desktop app. It shows participant avatars, mute/deafen state, and a green outline for people currently speaking.

## Sign in with Discord

The app connects to Discord's documented local RPC IPC interface. After you approve the app in Discord, it reads the selected voice channel and subscribes to voice-state and speaking events. There is no bot, manual account ID, or audio capture. The Discord desktop app must be running and signed in on this Mac.

### Developer setup

The app needs a Discord application ID and a small server-side OAuth token exchange. Discord's RPC authorization returns a short-lived authorization code; the OAuth client secret must stay on the server and must never be embedded in the desktop app.

### Try it locally (no deployment needed)

1. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application and copy its **Application ID** and **Client Secret**.
2. In the app's OAuth2 settings, add this exact redirect URI:

   ```text
   http://127.0.0.1:8787/oauth/callback
   ```

3. Copy the local config templates:

   ```sh
   cp .env.example .env
   cp oauth-worker/.dev.vars.example oauth-worker/.dev.vars
   ```

4. Put the **Application ID** in `.env` and in `oauth-worker/.dev.vars`. Put the **Client Secret** only in `oauth-worker/.dev.vars`. Keep the sample redirect URI unchanged.
5. Install and start the app and its local OAuth service:

   ```sh
   npm install
   npm run dev
   ```

6. Make sure Discord's desktop app is open and signed in. Click **Sign in with Discord** and approve the request in Discord.
7. Join a voice channel. The overlay should show the participants and update speaking outlines and mute/deafen flags. Verify the display controls in the settings window.

The local OAuth service binds only to `127.0.0.1`; credentials in `oauth-worker/.dev.vars` are ignored by Git. Keep the Client Secret out of `.env`, source files, screenshots, and chat.

### Prepare a distributed build

1. In the Discord Developer Portal, register an HTTPS redirect URI on the production Worker, e.g. `https://your-worker.example.workers.dev/oauth/callback`.
2. Deploy the OAuth Worker and set its server-side credentials:

   ```sh
   npx wrangler@4 deploy --config oauth-worker/wrangler.toml
   printf '%s' 'YOUR_DISCORD_CLIENT_ID' | npx wrangler@4 secret put DISCORD_CLIENT_ID --config oauth-worker/wrangler.toml
   npx wrangler@4 secret put DISCORD_CLIENT_SECRET --config oauth-worker/wrangler.toml
   printf '%s' 'https://your-worker.example.workers.dev/oauth/callback' | npx wrangler@4 secret put DISCORD_REDIRECT_URI --config oauth-worker/wrangler.toml
   ```

3. Set `DISCORD_CLIENT_ID` and `DISCORD_TOKEN_EXCHANGE_URL` in the release build environment to the application ID and deployed Worker URL ending in `/token`.
4. Build the app with `npm run dist:mac`. If the Discord application is still in development, add the account used for testing to its approved testers.

The OAuth Worker exchanges one-time authorization codes and refresh tokens. It returns OAuth tokens to the app but never stores them or writes them to logs. The app stores only the refresh token, encrypted with macOS secure storage. `DISCORD_CLIENT_SECRET` belongs only in the Worker secret store.

## Development

Requirements: macOS, Node.js 20+, and npm.

For local development, follow [Try it locally](#try-it-locally-no-deployment-needed) above.

Check types and create distributable macOS apps for Intel and Apple Silicon:

```sh
npm run typecheck
npm run dist:mac
```

The packaged apps are unsigned by default. macOS may ask you to allow the app in Privacy & Security when opening a local build. The OAuth credentials are not included with this repository; configure your own Discord application before signing in.

## Settings

- Keep window in front
- Show voice channel name
- Show account names
- Only show talking accounts (speakers receive a green outline)
- Window opacity
- Window size

Settings and the encrypted OAuth refresh token are stored locally in the app's macOS application data folder. Disconnect removes the saved refresh token; you can also revoke access in Discord's Authorized Apps settings.
