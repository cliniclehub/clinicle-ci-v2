"""Transcript -> flat span list. The one seam that isolates input-format
handling from extraction/review/ACL, so a future ingest source (live
bot-join capture, chunked-ASR audio) only has to emit the same span shape --
nothing downstream changes.

A span is ``{"idx": int, "start_ts": str|None, "end_ts": str|None,
"speaker": str|None, "text": str}``. Plain-paste has no timestamps (each
paragraph becomes one span with ``start_ts``/``end_ts``/``speaker`` all
None); ``.vtt``/``.srt`` give real ones, enabling exact transcript-span
citation instead of paragraph-level.

Audio -> text is intentionally NOT handled here for v1 (see meetings.py's
docstring for why raw meeting audio was cut from v1 rather than shipped
half-working against the short-clip ASR path).

Stdlib-only regex parsing, no new dependency for either format.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

SUPPORTED_SOURCE_TYPES = ("text", "vtt", "srt")

_VTT_TIME = r"(\d{2}:)?\d{2}:\d{2}[.,]\d{3}"
_CUE_TIME_RE = re.compile(rf"({_VTT_TIME})\s*-->\s*({_VTT_TIME})")


def parse_plain_text(text: str) -> List[Dict[str, Any]]:
    """One span per non-empty paragraph (blank-line-separated block). No
    timestamps -- action items linked to this transcript cite the paragraph,
    not a moment in time."""
    spans: List[Dict[str, Any]] = []
    for idx, block in enumerate(re.split(r"\n\s*\n", text.strip())):
        block = block.strip()
        if not block:
            continue
        spans.append({"idx": len(spans), "start_ts": None, "end_ts": None, "speaker": None, "text": block})
    return spans


def _normalize_ts(raw: str) -> str:
    """SRT uses a comma decimal separator, VTT a dot -- normalize to dot so
    downstream code (and the UI) only ever deals with one format."""
    return raw.replace(",", ".")


def _extract_speaker(text: str) -> Tuple[Any, str]:
    """A leading ``Speaker Name:`` on the cue's first line, if present (common
    in Zoom/Meet/Teams exports) -- split off so it renders separately rather
    than duplicated into every span's body text."""
    m = re.match(r"^([A-Za-z0-9 ._'-]{1,40}):\s+(.*)$", text, re.DOTALL)
    if m and len(m.group(1)) < 40:
        return m.group(1).strip(), m.group(2).strip()
    return None, text


def _parse_cue_blocks(content: str) -> List[Dict[str, Any]]:
    """Shared VTT/SRT cue-block parser -- the two formats differ only in
    header line and decimal separator, both already normalized by the time
    this runs."""
    spans: List[Dict[str, Any]] = []
    lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        m = _CUE_TIME_RE.search(line)
        if not m:
            i += 1
            continue
        start_ts, end_ts = _normalize_ts(m.group(1)), _normalize_ts(m.group(2))
        i += 1
        text_lines = []
        while i < len(lines) and lines[i].strip():
            text_lines.append(lines[i].strip())
            i += 1
        text = " ".join(text_lines).strip()
        if text:
            speaker, body = _extract_speaker(text)
            spans.append({
                "idx": len(spans), "start_ts": start_ts, "end_ts": end_ts,
                "speaker": speaker, "text": body,
            })
    return spans


def parse_vtt(content: str) -> List[Dict[str, Any]]:
    return _parse_cue_blocks(content)


def parse_srt(content: str) -> List[Dict[str, Any]]:
    return _parse_cue_blocks(content)


def ingest(source_type: str, content: str) -> Tuple[str, List[Dict[str, Any]]]:
    """Returns ``(raw_text, spans)``. ``raw_text`` is the content as given
    (kept verbatim for the record and for re-parsing if the format detector
    ever improves); ``spans`` is what extraction and citation use."""
    if source_type not in SUPPORTED_SOURCE_TYPES:
        raise ValueError(f"unsupported transcript source_type: {source_type!r}")
    if source_type == "text":
        spans = parse_plain_text(content)
    elif source_type == "vtt":
        spans = parse_vtt(content)
    else:
        spans = parse_srt(content)
    if not spans:
        raise ValueError("transcript parsed to zero spans -- check the file format")
    return content, spans


def demo() -> None:
    """Smoke check: ``python -m agent.tools.meetings.transcript_ingest``."""
    text = "Alice: We agreed to ship Friday.\n\nBob: I'll write the release notes."
    spans = parse_plain_text(text)
    assert len(spans) == 2, spans
    assert spans[0]["text"].startswith("Alice:")

    vtt = (
        "WEBVTT\n\n"
        "1\n00:00:00.000 --> 00:00:02.500\nAlice: We agreed to ship Friday.\n\n"
        "2\n00:00:02.500 --> 00:00:05.000\nBob: I'll write the release notes.\n"
    )
    vtt_spans = parse_vtt(vtt)
    assert len(vtt_spans) == 2, vtt_spans
    assert vtt_spans[0]["speaker"] == "Alice", vtt_spans[0]
    assert vtt_spans[0]["start_ts"] == "00:00:00.000"

    srt = (
        "1\n00:00:00,000 --> 00:00:02,500\nAlice: We agreed to ship Friday.\n\n"
        "2\n00:00:02,500 --> 00:00:05,000\nBob: I'll write the release notes.\n"
    )
    srt_spans = parse_srt(srt)
    assert len(srt_spans) == 2, srt_spans
    assert srt_spans[0]["start_ts"] == "00:00:00.000"

    print("transcript_ingest.demo: OK")


if __name__ == "__main__":
    demo()
