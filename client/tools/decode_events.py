#!/usr/bin/env python3
"""Decode raw input_event captures from the Kindle (32-bit ARM: 16 bytes per event).

Usage: python3 tools/decode_events.py touch.bin [power.bin ...]
Prints every event and a summary (axis ranges, key codes, number of touches).
"""
import struct
import sys

RECORD = struct.Struct("<IIHHi")  # tv_sec, tv_usec, type, code, value

TYPES = {0x00: "EV_SYN", 0x01: "EV_KEY", 0x03: "EV_ABS"}
CODES = {
    0x00: {0x00: "SYN_REPORT"},
    0x01: {116: "KEY_POWER", 325: "BTN_TOOL_FINGER", 330: "BTN_TOUCH", 333: "BTN_TOOL_DOUBLETAP"},
    0x03: {
        0x00: "ABS_X", 0x01: "ABS_Y", 0x18: "ABS_PRESSURE", 0x2F: "ABS_MT_SLOT",
        0x30: "ABS_MT_TOUCH_MAJOR", 0x35: "ABS_MT_POSITION_X", 0x36: "ABS_MT_POSITION_Y",
        0x39: "ABS_MT_TRACKING_ID", 0x3A: "ABS_MT_PRESSURE",
    },
}


def decode(data):
    """Yield (sec, usec, type, code, value) tuples; trailing partial records are ignored."""
    usable = len(data) - len(data) % RECORD.size
    for off in range(0, usable, RECORD.size):
        yield RECORD.unpack_from(data, off)


def summarize(records):
    """Return axis ranges, key codes and the number of touch-downs (tracking id >= 0)."""
    xs, ys, keys, touches = [], [], set(), 0
    for _sec, _usec, typ, code, value in records:
        if typ == 0x03 and code == 0x35:
            xs.append(value)
        elif typ == 0x03 and code == 0x36:
            ys.append(value)
        elif typ == 0x03 and code == 0x39 and value >= 0:
            touches += 1
        elif typ == 0x01:
            keys.add(code)
    return {
        "x": (min(xs), max(xs)) if xs else None,
        "y": (min(ys), max(ys)) if ys else None,
        "keys": sorted(keys),
        "touches": touches,
    }


def describe(rec):
    sec, usec, typ, code, value = rec
    tname = TYPES.get(typ, hex(typ))
    cname = CODES.get(typ, {}).get(code, hex(code))
    return f"{sec}.{usec:06d} {tname:7} {cname:20} {value}"


def main(paths):
    for path in paths:
        with open(path, "rb") as fh:
            data = fh.read()
        print(f"== {path} ({len(data)} bytes)")
        if len(data) % RECORD.size:
            print(f"warning: {len(data) % RECORD.size} trailing bytes ignored", file=sys.stderr)
        records = list(decode(data))
        for rec in records:
            print(describe(rec))
        print("summary:", summarize(records))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
