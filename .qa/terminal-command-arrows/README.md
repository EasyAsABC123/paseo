# PR 4220 macOS Electron evidence

[Successful macOS run](https://github.com/EasyAsABC123/paseo/actions/runs/34313869809).
The run used macOS 14.8.9 (23J631), arm64, Electron 41.2.0, and Paseo 0.7.2 from source.

The tested QA commit is `45db561c548688b40a1bfb808df918be58d69f09`.
Its app, daemon, test, and documentation files match PR commit
`d1e8cb61d`; the only difference is the QA branch's workflow.
The patched runtime blob is `641e1add60dd3581c62df70dd591ad6c940330da`.
The original runtime blob is `56350ef9b7ca4b634959a282c4e9cbeca3fa7225`
from `ff0171cf7`.

- [Patched interaction video](patched/interaction.mp4)
- [Original runtime video](unpatched/interaction.mp4)
- [Patched results](patched/result.json)
- [Original runtime failure](unpatched/result.json)
- [Raw macOS check output](macos-check.log)

The videos export the real Playwright trace screencast frames with their original
timing. Their companion JSON records frame counts and conversion details; SRT files
contain keyboard captions. Full-resolution PNGs are alongside each video. Full
traces and daemon/Electron logs are in the Actions run's artifact.

The patched check keeps the same terminal textarea focused through Cmd+Left/Right,
executes a command edited at both boundaries, focuses split panes with
Cmd+Shift+Left/Right, and moves a terminal tab with Cmd+Alt+Shift+Left/Right.
The original runtime fails at Cmd+Left: cursor column 16 remains 16 instead of 4.

This is an automated check of the real macOS Electron dev app through CDP, using a
real daemon, PTY, and Bash shell. It does not claim a physical-keyboard check on
macOS 26.6.2 or coverage of iOS, Android, standalone browser web, Windows, or Linux.
