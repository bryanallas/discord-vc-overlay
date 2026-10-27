# Discord VC Overlay

A transparent, draggable macOS overlay for a Discord voice channel. It shows participant avatars, mute/deafen state, and a green outline for people currently speaking.

## Discord integration requirements

Discord does not expose a user's live voice channel or other participants' voice state through the normal user OAuth API. This app therefore uses a Discord bot and tracks one account by its Discord user ID. The bot must be invited to every server you want to monitor; private/group calls are not supported.

1. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application and add a bot.
2. Invite the bot to each server with the `bot` OAuth scope and `View Channels` and `Connect` permissions. The bot needs access to the voice channel.
3. Copy the bot token and paste it into the app. The token is encrypted with macOS secure storage and saved locally.
4. Turn on Developer Mode in Discord, copy the target account's user ID, and enter it in the app.
5. Connect. When the tracked account joins a visible server voice channel, the bot joins that channel so the app can detect speaking activity.

The bot does not transmit audio or save recordings. It joins the voice channel visibly as a bot account. The application does not log in as your personal Discord account.

## Development

Requirements: macOS, Node.js 20+, and npm.

```sh
npm install
npm run dev
```

Check types and create a distributable macOS app:

```sh
npm run typecheck
npm run dist:mac
```

The packaged app is unsigned by default. macOS may ask you to allow it in Privacy & Security when opening a local build.

## Settings

- Keep window in front
- Show voice channel name
- Show account names
- Only show talking accounts (speakers receive a green outline)
- Window opacity
- Window size

Settings are stored locally in the app's macOS application data folder.
