# Record the terminal shortcut regression on lappy

Use PR commit `f0b3a6efdf3b9b138b1c44e4128a273c94fcabab` in an isolated worktree on the real Mac. Preserve other workspaces and the main Paseo daemon. Follow the repository development and testing instructions and build the server stack and `@getpaseo/expo-two-way-audio` before running the scenario.

Run `npm run test:e2e:terminal-command-arrows --workspace=@getpaseo/desktop -- --record`, with `PASEO_TERMINAL_ARROW_ARTIFACT_DIR` set to a fresh evidence directory. Require all 15 checkpoints, complete Bash readiness, and actual output `one two ok` followed by a newline.

For a negative control, replace only `packages/app/src/terminal/runtime/terminal-emulator-runtime.ts` with the version from `93404a38e^`, then record into a separate directory. Require successful setup followed by `LINE_BOUNDARY_EDIT` or `LINE_BOUNDARY_FOCUS`; unrelated failures do not validate the regression. Restore the patched runtime and verify the worktree is clean.

Encode both recordings using the arguments in `recording.json`. Preserve all captured frames and timestamps. Verify full decoding, frame count, dimensions, and every frame timestamp. Inspect the actual MP4 for visible beginning/end cursor positions through the three-second holds, clean Terminal 2/3 prompts, and the tab-switching, pane-focus, and tab-moving shortcuts. The real block cursor blinks; do not describe it as steady or draw a cursor into the video.

Preserve source hashes, actual output files, results, screenshots, frames, logs, traces, MP4s, and audit reports. Return the bundle path and SHA256, video hashes and dimensions/durations, host and Electron versions, outcomes, and unchanged main daemon PID. Report visual failures even when assertions pass.
