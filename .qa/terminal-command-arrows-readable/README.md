# macOS terminal keyboard evidence

[Patched video — 56 seconds](patched/interaction.mp4) · [Original runtime — 15 seconds](unpatched/interaction.mp4) · [Passing macOS run](https://github.com/EasyAsABC123/paseo/actions/runs/34317056448)

Recorded on 2026-09-09 in real macOS 14.8.9 (23J631), arm64, Electron 44.2.0, Paseo 0.8.0-beta.1. This is a GitHub macOS runner; a run on `lappy` still requires its Paseo connection address.

The 1200×800 recording uses 22px terminal text, visible key labels, and three-second pauses after each checkpoint. The line-boundary demonstration uses xterm's public display options for a steady block cursor. Keyboard events go through Playwright/CDP into the actual Electron app and real Bash PTY.

| Video time    | Action and observed result                                                        |
| ------------- | --------------------------------------------------------------------------------- |
| 00:04         | Cmd+Left moves from the end to the `e` in `echo`, immediately after the prompt.   |
| 00:07         | Cmd+Right returns to the end of the unchanged command.                            |
| 00:10         | Cmd+Left returns to the beginning; a prefix is then typed there.                  |
| 00:18         | Cmd+Right reaches the end; a suffix is typed and the command prints `one two ok`. |
| 00:36         | Option+Shift+[ selects the tab labeled `TERMINAL TWO`.                            |
| 00:40         | Option+Shift+] returns to `TERMINAL THREE`.                                       |
| 00:43 / 00:46 | Cmd+Shift+Left/Right switches the focused pane.                                   |
| 00:49 / 00:52 | Cmd+Option+Shift+Left/Right moves Terminal 3 between panes.                       |

All line-boundary assertions retain the same textarea, document focus, URL, pane, and tabs, with zero textarea blur events. Restoring the original runtime fails at the first Cmd+Left assertion: cursor column 16 remains 16 instead of becoming 4. The workflow requires that specific failure.

## Source and verification

The run uses `7e4e239efb4fcd0e46eba72c532d4a03724c62da`. All files match PR commit `68575a5bb070fca229c5bd3cfc2bfac3bc282f6e`, except the fork's additional QA workflow. The patched runtime blob is `641e1add60dd3581c62df70dd591ad6c940330da`; the original runtime blob is `56350ef9b7ca4b634959a282c4e9cbeca3fa7225`.

- [Patched results](patched/result.json), [capture metadata](patched/recording.json), and [encoding verification](patched/encoding-verification.json): 332 frames, 55.992340 seconds.
- [Original results](unpatched/result.json), [capture metadata](unpatched/recording.json), and [encoding verification](unpatched/encoding-verification.json): 32 frames, 14.532784 seconds.
- [macOS output](macos-check.log), [typecheck](typecheck.log), [lint](lint.log), and [format](format.log).

Both videos retain every captured frame at its original timestamp (maximum measured drift: 0 microseconds), and full decoding succeeds. The MP4 duration includes the final captured frame. No frame timing is sped up and no cursor is drawn into the video. Frame filenames retain CDP delivery order; the concat manifest plays them in capture-time order.

The raw JPEG frames, traces, and process logs are in the Actions artifact `macos-terminal-command-arrows` (30-day retention). This directory preserves the videos, checkpoints, results, and metadata. To re-encode downloaded raw frames, run `python3 encode-and-verify.py /path/to/recording`; FFmpeg and ffprobe must be installed.

## Reproduce on a Mac

```bash
npm run build:server
npm run build --workspace=@getpaseo/expo-two-way-audio
PASEO_TERMINAL_ARROW_ARTIFACT_DIR=/tmp/paseo-terminal-arrows \
npm run test:e2e:terminal-command-arrows --workspace=@getpaseo/desktop -- --record
```

The harness owns an isolated daemon and Electron profile; it cleans them up afterward. [Prompt for the lappy host](lappy-prompt.md).

Untested: physical-keyboard input, the reported macOS 26.6.2 environment, the packaged release build, standalone browser web, iOS, Android, Windows, and Linux desktop keyboard behavior.
