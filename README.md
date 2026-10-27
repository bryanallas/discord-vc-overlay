# Discord VC Overlay

A transparent, draggable macOS overlay for the voice channel selected in the Discord desktop app. It shows participant avatars, mute/deafen state, and a green outline for people currently speaking.

## Sign in with Discord

The app connects to Discord's documented local RPC IPC interface. After you approve the app in Discord, it reads the selected voice channel and subscribes to voice-state and speaking events. There is no bot, manual account ID, or audio capture. The Discord desktop app must be running and signed in on this Mac.

### Developer setup

The distributed app needs a Discord application ID and a small server-side OAuth token exchange. Discord's RPC authorization returns a short-lived authorization code; the OAuth client secret must stay on the server and must never be embedded in the desktop app.

1. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application and copy its Application ID.
2. Register an OAuth2 redirect URI in the application's settings. It must exactly match `DISCORD_REDIRECT_URI` used by the OAuth Worker, for example `https://your-worker.example.workers.dev/oauth/callback`.
3. Configure `oauth-worker/wrangler.toml` with the application ID and redirect URI, then deploy the Worker:

   ```sh
   npx wrangler@4 deploy --config oauth-worker/wrangler.toml
   npx wrangler@4 secret put DISCORD_CLIENT_SECRET --config oauth-worker/wrangler.toml
   ```

4. Create a root `.env` file using `.env.example` as a template. Set `DISCORD_CLIENT_ID` and `DISCORD_TOKEN_EXCHANGE_URL` to the same application ID and the deployed Worker URL ending in `/token`.
5. Build the app with `npm run dist:mac`. If the Discord application is still in development, add the account used for testing to its approved testers.

The OAuth Worker exchanges one-time authorization codes and refresh tokens. It returns OAuth tokens to the app but never stores them or writes them to logs. The app stores only the refresh token, encrypted with macOS secure storage. `DISCORD_CLIENT_SECRET` belongs only in the Worker secret store.

## Development

Requirements: macOS, Node.js 20+, and npm.

```sh
npm install
npm run dev
```

Check types and create distributable macOS apps for Intel and Apple Silicon:

```sh
npm run typecheck
npm run dist:mac
```

The packaged apps are unsigned by default. macOS may ask you to allow the app in Privacy & Security when opening a local build. Without Discord application and OAuth Worker configuration, the sign-in button reports that the build is not configured.

## Settings

- Keep window in front
- Show voice channel name
- Show account names
- Only show talking accounts (speakers receive a green outline)
- Window opacity
- Window size

Settings and the encrypted OAuth refresh token are stored locally in the app's macOS application data folder. Disconnect removes the saved refresh token; you can also revoke access in Discord's Authorized Apps settings.
