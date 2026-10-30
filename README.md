# Discord VC Overlay

A transparent, draggable macOS and Windows overlay for the voice channel selected in the Discord desktop app. It shows participant avatars, mute/deafen state, and a green outline for people currently speaking.

## Sign in with Discord

The app connects to Discord's documented local RPC IPC interface. After you approve the app in Discord, it reads the selected voice channel and subscribes to voice-state and speaking events. There is no bot, manual account ID, or audio capture. The Discord desktop app must be running and signed in.

### Developer setup

The distributed app needs a Discord application ID and a small server-side OAuth token exchange. Discord's RPC authorization returns a short-lived authorization code; the OAuth client secret must stay on the server and must never be embedded in the desktop app.

The OAuth Worker has already been deployed at `https://discord-vc-overlay-oauth.deflice.workers.dev`. Its registered redirect URL must be exactly:

```text
https://discord-vc-overlay-oauth.deflice.workers.dev/oauth/callback
```

To finish first-party Discord setup:

1. Sign in to the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. Copy its Application ID into `DISCORD_CLIENT_ID` in both `oauth-worker/wrangler.toml` and the root `.env` file.
3. In the application's OAuth2 settings, add the exact redirect URL above.
4. In Cloudflare, save the Discord application's Client Secret as a Worker secret. Run this from the repository root; Wrangler will prompt for the secret without putting it in the command:

   ```sh
   npx wrangler@4 secret put DISCORD_CLIENT_SECRET --config oauth-worker/wrangler.toml
   ```

5. Redeploy the Worker to apply its Application ID and secret:

   ```sh
   npx wrangler@4 deploy --config oauth-worker/wrangler.toml
   ```

6. Create the root `.env` from `.env.example`, then set `DISCORD_CLIENT_ID`. The token exchange URL is already set to this deployed Worker:

   ```sh
   cp .env.example .env
   ```

7. Run `npm run dev`. If Discord limits RPC authorization to approved testers during development, add your Discord account in the application's developer settings.

The OAuth Worker exchanges one-time authorization codes and refresh tokens. It returns OAuth tokens to the app but never stores them or writes them to logs. The app stores only the refresh token, encrypted with the operating system's secure storage. `DISCORD_CLIENT_SECRET` belongs only in the Worker secret store.

## Development

Requirements: macOS or Windows, Node.js 20+, and npm.

For local development, follow the developer setup above before running `npm install` and `npm run dev`. The app uses Discord's Unix IPC socket on macOS and named pipe on Windows.

Check types and build installable apps:

```sh
npm run typecheck
npm run dist:mac
npm run dist:win
```

`dist:mac` creates a DMG and ZIP for Intel and Apple Silicon. `dist:win` creates a Windows installer and ZIP. Build Windows packages on Windows; the release workflow builds both platforms when a `v*` tag is pushed and publishes the installers to the matching GitHub Release. Set the repository Actions variable `DISCORD_CLIENT_ID` before publishing. The workflow uses the deployed OAuth Worker URL documented above.

The packages are unsigned by default. macOS may ask you to allow a locally built app in Privacy & Security. Without Discord application and OAuth Worker configuration, the sign-in button reports that the build is not configured.

## Settings

- Keep window in front
- Show voice channel name
- Show account names
- Only show talking accounts (speakers receive a green outline)
- Window opacity
- Window size
- Horizontal screen-edge alignment (left or right)
- Configurable global hotkeys for mute, deafen, and disconnect
- Overlay buttons for mute, deafen, and disconnect
- Independent visibility settings for each overlay button
- Optional outline around the overlay window
- Light, dark, or system appearance for the settings window
- Reset button for restoring overlay settings to their defaults

Settings and the encrypted OAuth refresh token are stored locally in the app's user data folder. Disconnect removes the saved refresh token; you can also revoke access in Discord's Authorized Apps settings.
