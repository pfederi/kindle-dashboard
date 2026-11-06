import struct
import unittest

from decode_events import RECORD, decode, describe, summarize


def ev(typ, code, value, sec=1, usec=0):
    return RECORD.pack(sec, usec, typ, code, value)


class DecodeEventsTest(unittest.TestCase):
    def test_decode_and_summary(self):
        data = b"".join([
            ev(3, 0x39, 5), ev(3, 0x35, 10), ev(3, 0x36, 20), ev(0, 0, 0),
            ev(3, 0x35, 1060), ev(3, 0x36, 1440), ev(0, 0, 0),
            ev(3, 0x39, -1), ev(0, 0, 0),
            ev(1, 116, 1),
        ]) + b"\x00\x01"  # partial trailing record
        records = list(decode(data))
        self.assertEqual(len(records), 10)
        s = summarize(records)
        self.assertEqual(s["x"], (10, 1060))
        self.assertEqual(s["y"], (20, 1440))
        self.assertEqual(s["keys"], [116])
        self.assertEqual(s["touches"], 1)

    def test_describe_names_codes(self):
        line = describe((1, 5, 3, 0x39, -1))
        self.assertIn("EV_ABS", line)
        self.assertIn("ABS_MT_TRACKING_ID", line)
        self.assertTrue(line.endswith("-1"))

    def test_record_size_matches_32bit_arm(self):
        self.assertEqual(RECORD.size, 16)
        self.assertEqual(struct.calcsize("<IIHHi"), 16)


if __name__ == "__main__":
    unittest.main()
