# macOS terminal keyboard evidence

[Lappy video — 54 seconds](lappy/interaction.mp4) · [GitHub runner video — 56 seconds](patched/interaction.mp4) · [Original runtime — 15 seconds](unpatched/interaction.mp4) · [macOS CI](https://github.com/EasyAsABC123/paseo/actions/runs/34319757915)

Recorded on 2026-09-09 in real Electron 44.2.0, Paseo 0.8.0-beta.1, arm64:

| Host                                | macOS                  | Capture                                  |
| ----------------------------------- | ---------------------- | ---------------------------------------- |
| lappy (`Justins-MacBook-Pro.local`) | 26.6.2 (25G83), Retina | 1800×1200, 289 frames, 53.756731 seconds |
| GitHub macOS runner                 | 14.8.9 (23J631)        | 1200×800, 332 frames, 55.992340 seconds  |

Both recordings use a 1200×800 logical viewport, 22px terminal text, visible key labels, and three-second pauses after each checkpoint. The line-boundary demonstration uses xterm's public display options for a steady block cursor. Keyboard events go through Playwright/CDP into the actual Electron app and real Bash PTY.

| Lappy video time | Action and observed result                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 00:04            | Cmd+Left moves from the end to the `e` in `echo`, immediately after the prompt.                                            |
| 00:07 / 00:10    | Cmd+Right returns to the end; Cmd+Left returns to the beginning.                                                           |
| 00:13–00:29      | A prefix is inserted at the beginning; Cmd+Right reaches the end, a suffix is appended, and the shell prints `one two ok`. |
| 00:35 / 00:38    | Option+Shift+[/] switches between `TERMINAL TWO` and `TERMINAL THREE`.                                                     |
| 00:41 / 00:44    | Cmd+Shift+Left/Right switches the focused pane.                                                                            |
| 00:47 / 00:51    | Cmd+Option+Shift+Left/Right moves Terminal 3 between panes.                                                                |

All 15 lappy checkpoints pass. All line-boundary assertions retain the same textarea, document focus, URL, pane, and tabs, with zero textarea blur events. The moved terminal restores a thin blinking cursor after reattachment; its heading and tab position make the movement visible.

## Source and verification

Lappy's tested working files exactly match PR commit `287cc390b7e3a61ffc7b2ca80181e83c6309de2a`. Its recorded HEAD is `68575a5bb070fca229c5bd3cfc2bfac3bc282f6e` plus the Retina recorder patch integrated in `287cc390b`. The recorder blob is `a2bb34c1bc039f29eda88bba3537259bf1ce552c`; the unchanged patched terminal runtime blob is `641e1add60dd3581c62df70dd591ad6c940330da`.

- [Lappy results](lappy/result.json), [capture metadata](lappy/recording.json), [encoding verification](lappy/encoding-verification.json), and [decoded-frame visual review](lappy/visual-review.json).
- [Lappy source verification](lappy/source-equivalence.json) and [recorder patch](lappy/harness-retina-fix.patch).
- [Final typecheck](lappy/typecheck.log), [lint](lappy/lint.log), and [format](lappy/format.log) pass.
- [GitHub patched results](patched/result.json) and [encoding verification](patched/encoding-verification.json).
- [Original runtime results](unpatched/result.json) and [encoding verification](unpatched/encoding-verification.json).

The first lappy capture passed all interactions but failed finalization: legacy viewport metrics supplied physical pixels to the final screenshot clip. Using `cssVisualViewport` makes the final screenshot match all 288 screencast frames at 1800×1200. The native 2400×1600 comparison snapshot and original failed capture are preserved with the raw evidence.

The lappy MP4 retains all captured frames at their original microsecond timestamps, and full decoding succeeds. Reviewers inspected decoded video frames through the whole sequence and each checkpoint. No frame timing is sped up and no cursor is drawn into the video. Frame filenames retain CDP delivery order; the concat manifest plays them in capture-time order.

The GitHub videos come from [run 34317056448](https://github.com/EasyAsABC123/paseo/actions/runs/34317056448), source `7e4e239efb4fcd0e46eba72c532d4a03724c62da`, matching PR `68575a5bb` except the QA workflow. Restoring original runtime blob `56350ef9b7ca4b634959a282c4e9cbeca3fa7225` fails the first Cmd+Left assertion: column 16 remains 16 instead of becoming 4. The workflow requires that specific failure. [Run 34319757915](https://github.com/EasyAsABC123/paseo/actions/runs/34319757915) verifies the final Retina recorder change on source `b1cc8365840ac1279abc61d3e3260dfef2c5d821`; its app and test source matches PR `287cc390b`.

The original GitHub JPEG frames, traces, and process logs remain in the Actions artifact `macos-terminal-command-arrows` (30-day retention). Lappy's complete bundle is preserved under `/Users/jschuhmann/github/paseo-lappy-terminal-arrows-evidence` and copied to justindesktop. This directory publishes the videos, checkpoints, results, and metadata. To re-encode raw frames, run `python3 encode-and-verify.py /path/to/recording`; FFmpeg and ffprobe must be installed.

## Reproduce on a Mac

```bash
npm run build:server
npm run build --workspace=@getpaseo/expo-two-way-audio
PASEO_TERMINAL_ARROW_ARTIFACT_DIR=/tmp/paseo-terminal-arrows \
npm run test:e2e:terminal-command-arrows --workspace=@getpaseo/desktop -- --record
```

The harness owns an isolated daemon and Electron profile and cleans them up afterward. [Prompt for the lappy host](lappy-prompt.md).

Untested: physical-keyboard input, the packaged release build, standalone browser web, iOS, Android, Windows, and Linux desktop keyboard behavior.
