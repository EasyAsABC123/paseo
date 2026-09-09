#!/usr/bin/env python3
"""Export recorded Playwright screencast frames without frame interpolation."""

import argparse
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile
from PIL import Image


def microseconds(value):
    return int(Decimal(str(value)) * 1000)


def subtitle_time(value):
    milliseconds = max(0, value // 1000)
    seconds, millis = divmod(milliseconds, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02}:{minutes:02}:{seconds:02},{millis:03}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trace", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--page-id", help="Required when the trace contains multiple page screencasts")
    parser.add_argument(
        "--captions", action="store_true",
        help="Include an optional MP4 subtitle track and sidecar SRT for keyboardPress events",
    )
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.trace) as archive:
        events = [json.loads(line) for line in archive.read("trace.trace").splitlines()]
        frames = [event for event in events if event.get("type") == "screencast-frame"]
        page_ids = sorted({frame["pageId"] for frame in frames})
        page_id = args.page_id
        if page_id is None and len(page_ids) == 1:
            page_id = page_ids[0]
        if page_id not in page_ids:
            parser.error(f"Choose --page-id from {page_ids}")
        frames = sorted(
            (frame for frame in frames if frame["pageId"] == page_id),
            key=lambda frame: frame["timestamp"],
        )
        dimensions = {
            Image.open(io.BytesIO(archive.read("resources/" + frame["sha1"]))).size
            for frame in frames
        }
        if len(dimensions) != 1:
            parser.error("Frame dimensions change; export a fixed-size trace to avoid rescaling evidence")
        width, height = next(iter(dimensions))
        timestamps = [microseconds(frame["timestamp"]) for frame in frames]
        if any(later <= earlier for earlier, later in zip(timestamps, timestamps[1:])):
            parser.error("Frame timestamps must increase strictly; refusing to drop or retime frames")
        origin = timestamps[0]
        relative = [timestamp - origin for timestamp in timestamps]
        with tempfile.TemporaryDirectory(prefix="paseo-trace-video-") as temporary:
            workdir = Path(temporary)
            concat = ["ffconcat version 1.0"]
            for index, frame in enumerate(frames):
                extension = Path(frame["sha1"]).suffix
                name = f"frame-{index:06}{extension}"
                (workdir / name).write_bytes(archive.read("resources/" + frame["sha1"]))
                concat.extend([f"file '{name}'", "option framerate 1000000"])
                if index + 1 < len(frames):
                    duration = relative[index + 1] - relative[index]
                    concat.append(f"duration {duration / 1_000_000:.6f}")
            (workdir / "frames.ffconcat").write_text("\n".join(concat) + "\n")

            command = [
                "/usr/bin/ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
                "-safe", "0", "-f", "concat", "-i", str(workdir / "frames.ffconcat"),
            ]
            captions = []
            if args.captions:
                key_events = [
                    event for event in events
                    if event.get("type") == "before"
                    and event.get("method") == "keyboardPress"
                    and event.get("pageId") == page_id
                ]
                key_events.sort(key=lambda event: event["startTime"])
                for index, event in enumerate(key_events):
                    start = max(0, microseconds(event["startTime"]) - origin)
                    end = min(start + 1_500_000, relative[-1])
                    if index + 1 < len(key_events):
                        end = min(end, microseconds(key_events[index + 1]["startTime"]) - origin)
                    if end <= start:
                        continue
                    key = event["params"]["key"].replace("Meta", "Cmd")
                    captions.append(
                        f"{len(captions) + 1}\n{subtitle_time(start)} --> {subtitle_time(end)}\n{key}\n"
                    )
                if captions:
                    subtitle_path = args.output.with_suffix(".srt").resolve()
                    subtitle_path.write_text("\n".join(captions))
                    command.extend(["-i", str(subtitle_path)])

            command.extend([
                "-map", "0:v:0", "-c:v", "libx264", "-crf", "18", "-preset", "medium",
                "-x264-params", "fps=60/1",
                "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:black",
                "-pix_fmt", "yuv420p", "-bf", "0", "-fps_mode", "passthrough",
                "-enc_time_base:v", "1:1000000", "-video_track_timescale", "1000000",
            ])
            if captions:
                command.extend([
                    "-map", "1:s:0", "-c:s", "mov_text", "-disposition:s:0", "default",
                    "-metadata:s:s:0", "title=Recorded keyboard actions",
                ])
            command.extend(["-movflags", "+faststart", str(args.output.resolve())])
            subprocess.run(command, check=True)

    probe = json.loads(subprocess.check_output([
        "/usr/bin/ffprobe", "-v", "error", "-select_streams", "v:0", "-show_frames",
        "-show_entries", "frame=pts_time", "-of", "json", str(args.output),
    ], text=True))
    encoded = [int(Decimal(frame["pts_time"]) * 1_000_000) for frame in probe["frames"]]
    if encoded != relative:
        raise RuntimeError(f"Encoded timestamps differ from trace: {encoded!r} != {relative!r}")
    subprocess.run([
        "/usr/bin/ffmpeg", "-v", "error", "-i", str(args.output), "-map", "0:v:0",
        "-fps_mode", "passthrough", "-enc_time_base:v", "1:1000000", "-f", "null", "-",
    ], check=True)
    context = next(event for event in events if event.get("type") == "context-options")
    report = {
        "source": str(args.trace.resolve()),
        "sourceSha256": hashlib.sha256(args.trace.read_bytes()).hexdigest(),
        "platform": context.get("platform"),
        "pageId": page_id,
        "frameCount": len(frames),
        "width": width,
        "height": height,
        "encodedWidth": width + width % 2,
        "encodedHeight": height + height % 2,
        "firstFrameTimestampMs": frames[0]["timestamp"],
        "lastFrameTimestampMs": frames[-1]["timestamp"],
        "recordedSpanSeconds": relative[-1] / 1_000_000,
        "frameTimestampsPreserved": True,
        "videoDecodePassed": True,
        "captions": len(captions),
        "limitations": [
            "Playwright records variable-rate snapshots; gaps hold the preceding recorded frame.",
            "No frames are synthesized, interpolated, duplicated, or dropped.",
            "The final recorded frame receives a one-microsecond display duration.",
            "Video is re-encoded as H.264 yuv420p; compression is lossy.",
            "Odd source dimensions receive a one-pixel black border on the right/bottom; recorded pixels are not resized or cropped.",
            "Optional captions are a selectable MP4 subtitle track; browser players may ignore that track.",
        ],
    }
    args.output.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
