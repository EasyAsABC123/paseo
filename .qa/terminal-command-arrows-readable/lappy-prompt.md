Record the macOS Command-arrow terminal fix from https://github.com/getpaseo/paseo/pull/4543 on this lappy host, using its current head (at least commit 287cc390b).

Use a clean isolated worktree for the PR. Preserve any existing changes and running agents. Read the repository instructions and docs/development.md, docs/testing.md, and docs/qa.md. Do not restart the main Paseo daemon on port 6767; the regression starts and cleans up its own daemon, app profile, and Electron window.

Install dependencies for that checkout, then run:

npm run build:server
npm run build --workspace=@getpaseo/expo-two-way-audio
PASEO_TERMINAL_ARROW_ARTIFACT_DIR=/tmp/paseo-lappy-terminal-arrows npm run test:e2e:terminal-command-arrows --workspace=@getpaseo/desktop -- --record

This must run in actual macOS Electron. The script makes terminal text 22px, uses a real steady block cursor, displays key labels, and holds every checkpoint for three seconds. It shows Cmd+Left to the start, Cmd+Right to the end, and Cmd+Left back to the start before inserting a prefix. It then appends at the end and executes the command. It also demonstrates Option+Shift+[/] tab switching, Cmd+Shift+Left/Right pane focus, and Cmd+Option+Shift+Left/Right tab movement.

Encode the recording by reading recording/recording.json and invoking its encoding.command with encoding.args as an argument array from /tmp/paseo-lappy-terminal-arrows/recording. These are portable FFmpeg arguments, so the captured directory can also be encoded on another machine if ffmpeg is unavailable here. Do not speed up or redraw the cursor. Preserve original frames, timestamps, screenshots, result.json, trace, and logs.

Watch the resulting interaction.mp4. Confirm the cursor at the start and end is obvious, each shortcut result stays visible long enough, and the terminal labels make tab changes unmistakable. Return the full artifact location and video, the host name, macOS and Electron versions, source commit, runtime blob hash, and all checks' actual outcomes. If GUI access or a recording permission blocks this, report the precise failure without claiming success. Do not modify production code or publish unrelated changes.
