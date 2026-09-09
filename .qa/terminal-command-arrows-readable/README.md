# macOS terminal keyboard evidence

[Lappy video — 56 seconds](lappy/interaction.mp4) · [Original runtime — 39 seconds](lappy-unpatched/interaction.mp4) · [Passing macOS CI](https://github.com/EasyAsABC123/paseo/actions/runs/34323545745)

Recorded on 2026-09-09 on **lappy (`Justins-MacBook-Pro.local`), macOS 26.6.2 (25G83), arm64, Retina, Electron 44.2.0, Paseo 0.8.0-beta.1**. Both runs use exact PR source `f0b3a6efdf3b9b138b1c44e4128a273c94fcabab`; the negative control replaces only the terminal runtime with its original version.

The video uses 22px text, a real blinking block cursor, visible key labels, and three-second checkpoint holds. Keyboard events travel through Playwright/CDP into the real Electron app and Bash PTY. The recording preserves the captured frames and timing; no cursor is drawn into it.

| Video time    | Action and observed result                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| 00:04         | Cmd+Left moves the block onto the first `e` in `echo`, immediately after the prompt.                          |
| 00:07 / 00:10 | Cmd+Right reaches the end; Cmd+Left returns to the beginning.                                                 |
| 00:13–00:31   | Insert a prefix at the beginning, use Cmd+Right, append a suffix, and execute: the shell prints `one two ok`. |
| 00:38 / 00:41 | Option+Shift+[/] switches between Terminal 2 and Terminal 3.                                                  |
| 00:44 / 00:47 | Cmd+Shift+Left/Right switches the focused pane.                                                               |
| 00:50 / 00:53 | Cmd+Option+Shift+Left/Right moves Terminal 3 to the left pane and back.                                       |

All **15 checkpoints pass**. Line editing retains accessible terminal input focus, the workspace URL, pane, and selected tab. Bash executes the edited command through `tee`; the [actual output file](lappy/command-result.txt) contains exactly `one two ok` followed by a newline. Tab assertions use the controls' actual button roles, accessible names, and selected state. Terminal 2/3 show clean prompts with no startup advisory or stray setup text.

The [negative control](lappy-unpatched/result.json) reaches setup but fails `LINE_BOUNDARY_EDIT`: the prefix lands at the wrong boundary, and its actual output file is empty. Recording finalization succeeds in both runs.

## Verification

| Run                       | Frames | Dimensions |    Duration | Outcome                  |
| ------------------------- | -----: | ---------- | ----------: | ------------------------ |
| Patched lappy             |    424 | 1800×1200  | 56.503703 s | All 15 checkpoints pass  |
| Original runtime on lappy |    212 | 1800×1200  | 38.710939 s | Expected editing failure |

- [Patched results](lappy/result.json), [capture metadata](lappy/recording.json), [encoding audit](lappy/encoding-verification.json), and [independent timing verification](lappy/timing-verification.json).
- [Decoded-video visual review](lappy/visual-review.json): inspected consecutive frames and adjacent blink phases through all cursor and shortcut actions. Both MP4s fully decode; every encoded frame matches the original microsecond concat timing.
- [Original-runtime capture metadata](lappy-unpatched/recording.json) and [encoding audit](lappy-unpatched/encoding-verification.json).
- [Exact tested source](lappy/source-verification.json) and [clean restoration](lappy/restoration.json). The main lappy daemon remained PID 33522 throughout.
- Full [typecheck](lappy/typecheck.log), [lint](lappy/lint.log), and [format](lappy/format.log) pass. Existing terminal-key unit coverage has 27 passing cases.

[CI run 34323545745](https://github.com/EasyAsABC123/paseo/actions/runs/34323545745) passes on macOS 14 using source `943714e691d2f40000b847664a0cd1d38d4a68bd`. Its app, test, docs, and dependency manifests match PR `f0b3a6ef` exactly. It requires the patched run to pass and the original runtime to fail the editing/focus regression after setup; both recordings finalize. Upstream CI, Docker, and Nix workflows still require approval from a maintainer with write access.

The complete lappy bundle, including original frames, logs, and traces, is preserved under `/Users/jschuhmann/github/paseo-lappy-terminal-arrows-evidence` and copied to justindesktop; [bundle verification](lappy/bundle-verification.json). GitHub CI artifacts have 30-day retention. Earlier [runner evidence](https://github.com/EasyAsABC123/paseo/tree/97d6597e5257be2c60f454fdb0307cad95cbd6e2/.qa/terminal-command-arrows-readable) and [lappy evidence](https://github.com/EasyAsABC123/paseo/tree/f61915edb48a1b82a4d41dc891d2698f83c04660/.qa/terminal-command-arrows-readable) remain pinned to their original source versions.

## Reproduce on a Mac

```bash
npm run build:server
npm run build --workspace=@getpaseo/expo-two-way-audio
PASEO_TERMINAL_ARROW_ARTIFACT_DIR=/tmp/paseo-terminal-arrows \
npm run test:e2e:terminal-command-arrows --workspace=@getpaseo/desktop -- --record
```

The harness owns an isolated daemon and Electron profile and cleans them up afterward. [Prompt for the lappy host](lappy-prompt.md). To encode raw frames, run `python3 encode-and-verify.py /path/to/recording` with FFmpeg and ffprobe installed.

Untested: physical-keyboard input, the packaged release build, standalone browser web, iOS, Android, Windows, and Linux desktop keyboard behavior.
