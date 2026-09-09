#!/usr/bin/env python3
"""Encode a Paseo CDP recording and audit the resulting video against its metadata."""

import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


def decimal(value):
    return Decimal(str(value))


def seconds_to_us(value):
    return decimal(value) * 1_000_000


def number(value):
    return float(value)


def probe(ffprobe, video, *arguments):
    result = subprocess.run(
        [ffprobe, "-v", "error", *arguments, "-of", "json", str(video)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recording_directory", type=Path)
    parser.add_argument(
        "--disable-b-frames", action="store_true",
        help="Apply -bf 0 to encoding only; preserve the source recording metadata, frames, and timing",
    )
    args = parser.parse_args()
    directory = args.recording_directory.resolve()
    metadata_path = directory / "recording.json"
    verification_path = directory / "encoding-verification.json"
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if ffmpeg is None or ffprobe is None:
        parser.error("ffmpeg and ffprobe must be installed")

    metadata = json.loads(metadata_path.read_text())
    frames = metadata["frames"]
    if not frames:
        parser.error("recording.json contains no frames")
    encoding = metadata["encoding"]
    recorded_args = encoding["args"]
    if not isinstance(recorded_args, list) or not all(isinstance(arg, str) for arg in recorded_args):
        parser.error("encoding.args must be an array of strings")
    if encoding["command"] != "ffmpeg" or encoding.get("cwd", ".") != ".":
        parser.error("Expected the recorder's ffmpeg command and recording-directory cwd")
    encoding_args = list(recorded_args)
    overrides = []
    if args.disable_b_frames:
        encoding_args[-1:-1] = ["-bf", "0"]
        overrides.append({
            "option": "--disable-b-frames",
            "insertedArguments": ["-bf", "0"],
            "reason": "Disable encoder B-frame reordering so the MP4 duration includes the final variable-rate capture.",
            "sourceMetadataModified": False,
            "sourceFramesModified": False,
            "sourceTimestampsModified": False,
            "concatIntervalsModified": False,
        })
    video_path = (directory / encoding_args[-1]).resolve()
    if video_path.parent != directory or video_path.suffix != ".mp4":
        parser.error("Expected an MP4 output directly inside the recording directory")

    report = {
        "recordingDirectory": str(directory),
        "recordingMetadataSha256": hashlib.sha256(metadata_path.read_bytes()).hexdigest(),
        "concatSha256": hashlib.sha256((directory / "frames.ffconcat").read_bytes()).hexdigest(),
        "video": str(video_path),
        "encoding": {
            "command": ffmpeg,
            "args": encoding_args,
            "recordedArgs": recorded_args,
            "overrides": overrides,
            "cwd": str(directory),
            "extraProcessFlags": ["-hide_banner", "-nostdin", "-y"],
        },
        "checks": {},
        "limitations": [
            "CDP screencasts are variable-rate captures; gaps retain the preceding recorded frame.",
            "Video uses the recorder's encoding arguments plus any explicitly listed overrides; actual and recorded arguments are retained separately.",
            "H.264 yuv420p is lossy. Odd dimensions receive black padding at the right/bottom.",
            "Frame timestamps in frames.ffconcat round each interval to six decimal seconds; accumulated rounding can differ from the original timestamps.",
            "The final screenshot uses its recorded completion timestamp, not an invented display hold.",
            "Full decoding and MP4/H.264 metadata are checked; this does not claim playback in every browser or device.",
        ],
    }
    try:
        encoded = subprocess.run(
            [ffmpeg, "-hide_banner", "-nostdin", "-y", *encoding_args],
            cwd=directory, capture_output=True, text=True,
        )
        (directory / "ffmpeg-encode.log").write_text(encoded.stdout + encoded.stderr)
        report["checks"]["encode"] = {"passed": encoded.returncode == 0, "exitCode": encoded.returncode}
        if encoded.returncode != 0:
            raise RuntimeError("ffmpeg encoding failed; see ffmpeg-encode.log")

        container = probe(ffprobe, video_path, "-show_streams", "-show_format")
        (directory / "ffprobe.json").write_text(json.dumps(container, indent=2) + "\n")
        stream = next(item for item in container["streams"] if item.get("codec_type") == "video")
        observed = probe(
            ffprobe, video_path, "-select_streams", "v:0", "-show_frames",
            "-show_entries", "frame=pts_time,best_effort_timestamp_time,pkt_duration_time,width,height",
        )["frames"]
        origin = decimal(frames[0]["timestampSeconds"])
        expected_us = [(decimal(frame["timestampSeconds"]) - origin) * 1_000_000 for frame in frames]
        actual_us = [seconds_to_us(frame["pts_time"]) for frame in observed]
        deltas = [actual - expected for actual, expected in zip(actual_us, expected_us)]
        same_count = len(observed) == len(frames)
        maximum_delta = max((abs(delta) for delta in deltas), default=Decimal(0))
        tolerance_us = Decimal(2)
        strictly_increasing = all(later > earlier for earlier, later in zip(actual_us, actual_us[1:]))

        concat_durations = [
            decimal(line.split(maxsplit=1)[1]) * 1_000_000
            for line in (directory / "frames.ffconcat").read_text().splitlines()
            if line.startswith("duration ")
        ]
        concat_us = [Decimal(0)]
        for duration in concat_durations:
            concat_us.append(concat_us[-1] + duration)
        concat_deltas = [actual - expected for actual, expected in zip(actual_us, concat_us)]
        maximum_concat_delta = max((abs(delta) for delta in concat_deltas), default=Decimal(0))
        concat_match = len(actual_us) == len(concat_us) and maximum_concat_delta <= tolerance_us
        cumulative_rounding_bound = decimal(max(0, len(frames) - 1)) / 2
        report["checks"]["frameCount"] = {
            "passed": same_count, "recorded": len(frames), "encoded": len(observed),
        }
        report["checks"]["presentationTimestamps"] = {
            "passed": same_count and maximum_delta <= tolerance_us and strictly_increasing,
            "toleranceMicroseconds": number(tolerance_us),
            "maxAbsoluteDifferenceMicroseconds": number(maximum_delta),
            "strictlyIncreasing": strictly_increasing,
            "concatMatchesWithinTolerance": concat_match,
            "maxAbsoluteDifferenceFromConcatMicroseconds": number(maximum_concat_delta),
            "perIntervalRoundingCumulativeBoundMicroseconds": number(cumulative_rounding_bound),
            "assessment": (
                "Every encoded frame matches its original capture timestamp within tolerance."
                if same_count and maximum_delta <= tolerance_us
                else "Original-timestamp tolerance was exceeded; inspect per-frame differences and concat rounding. Evidence was not retimed."
            ),
            "frames": [
                {
                    "index": index,
                    "file": frames[index]["file"] if index < len(frames) else None,
                    "recordedRelativeMicroseconds": number(expected_us[index]) if index < len(frames) else None,
                    "encodedRelativeMicroseconds": number(value),
                    "differenceMicroseconds": number(deltas[index]) if index < len(deltas) else None,
                }
                for index, value in enumerate(actual_us)
            ],
        }

        width = frames[0]["width"]
        height = frames[0]["height"]
        expected_width = width + width % 2
        expected_height = height + height % 2
        same_source_size = all(frame["width"] == width and frame["height"] == height for frame in frames)
        same_encoded_size = all(
            frame["width"] == expected_width and frame["height"] == expected_height
            for frame in observed
        )
        report["checks"]["dimensions"] = {
            "passed": same_source_size and same_encoded_size,
            "recorded": {"width": width, "height": height},
            "expectedEncoded": {"width": expected_width, "height": expected_height},
            "encoded": {"width": stream["width"], "height": stream["height"]},
            "padding": {"rightPixels": width % 2, "bottomPixels": height % 2},
            "allSourceFramesSameSize": same_source_size,
            "allEncodedFramesExpectedSize": same_encoded_size,
        }
        report["durationSeconds"] = number(decimal(container["format"]["duration"]))
        report["recordedSpanSeconds"] = number(expected_us[-1] / 1_000_000)
        report["lastFrameDisplayDurationSeconds"] = number(
            decimal(stream["duration"]) - actual_us[-1] / 1_000_000
        )
        report["checks"]["containerDuration"] = {
            "passed": seconds_to_us(stream["duration"]) >= actual_us[-1],
            "streamDurationSeconds": number(decimal(stream["duration"])),
            "lastFramePresentationSeconds": number(actual_us[-1] / 1_000_000),
            "lastFrameDisplayDurationSeconds": report["lastFrameDisplayDurationSeconds"],
        }
        report["keys"] = [
            {
                **key,
                "relativeSeconds": number(decimal(key["timestampSeconds"]) - origin),
            }
            for key in metadata.get("keys", [])
        ]
        report["checks"]["mp4Portability"] = {
            "passed": stream["codec_name"] == "h264" and stream.get("pix_fmt") in ("yuv420p", "yuvj420p"),
            "codec": stream["codec_name"],
            "profile": stream.get("profile"),
            "level": stream.get("level"),
            "pixelFormat": stream.get("pix_fmt"),
            "colorRange": stream.get("color_range"),
            "timeBase": stream.get("time_base"),
            "faststartRequested": "+faststart" in encoding_args,
            "notes": "H.264 4:2:0 and faststart suit MP4 web playback; yuvj420p denotes full-range 4:2:0. Variable frame rate and long static intervals are intentional. fps=60/1 configures H.264 nominal timing; actual presentation timestamps are verified separately.",
        }
        decoded = subprocess.run(
            [
                ffmpeg, "-hide_banner", "-nostdin", "-v", "error", "-xerror",
                "-i", str(video_path), "-map", "0:v:0", "-fps_mode", "passthrough",
                "-enc_time_base:v", "1:1000000", "-f", "null", "-",
            ],
            capture_output=True, text=True,
        )
        (directory / "ffmpeg-decode.log").write_text(decoded.stdout + decoded.stderr)
        report["checks"]["fullDecode"] = {
            "passed": decoded.returncode == 0 and not decoded.stderr.strip(),
            "exitCode": decoded.returncode,
            "diagnostics": decoded.stderr.strip(),
        }
        report["videoSha256"] = hashlib.sha256(video_path.read_bytes()).hexdigest()
        report["videoBytes"] = video_path.stat().st_size
        report["passed"] = all(check["passed"] for check in report["checks"].values())
    except Exception as error:
        report["passed"] = False
        report["error"] = str(error)
    finally:
        verification_path.write_text(json.dumps(report, indent=2) + "\n")
        summary = {key: value for key, value in report.items() if key not in ("keys",)}
        if "presentationTimestamps" in summary["checks"]:
            summary["checks"] = {
                **summary["checks"],
                "presentationTimestamps": {
                    key: value for key, value in summary["checks"]["presentationTimestamps"].items()
                    if key != "frames"
                },
            }
        print(json.dumps(summary, indent=2))
        print(f"Full verification: {verification_path}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
