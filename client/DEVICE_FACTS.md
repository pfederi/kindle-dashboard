# Device facts (Kindle 7th generation WP63GW, FW 5.12.2.2, WinterBreak2)

Collected on 2026-11-03 with `Dashboard-Diagnose.sh`; raw files in `testdata/device/`.

| Fact | Expected | Observed | Consequence |
|---|---|---|---|
| Kernel (`osrelease`) | 3.0.35-lab126 | 3.0.35-lab126 | Go 1.23 needs ≥ 2.6.32; ✓ supported |
| Device clock (`date -u`) | current UTC time | 21:32:15 UTC matches real time | TLS certificate validation will succeed |
| fbink | `/var/local/kmc/bin/fbink` and/or `/mnt/us/libkh/bin/fbink` | Both paths present and executable | Display output available |
| Touch device | `cyttsp4_mt` on event1 | `zforce2` on event1 | Use `zforce2` as default `touch.deviceName` |
| Touch X range (TL→TR) | small → large | TL=28 → TR=574 (grows) | No `invertX` flag needed |
| Touch Y range (TL→BL) | small → large | TL=28 → BL=780 (grows) | No `invertY` flag needed |
| Touch axis order | X/Y separate events | ABS_MT_POSITION_X, ABS_MT_POSITION_Y (no swapXY) | No `swapXY` flag needed; raw coords 24..574 × 28..780 |
| Power device / key code | `max77696-onkey` / 116 | `max77696-onkey` on event0 / KEY_POWER 116 | Confirmed; use 116 as `powerKeyCode` |
| `setsid` available | yes | OK (present in PATH) | Dashboard.sh uses `setsid`; fallback to `nohup` not needed |
| `/mnt/us` mount options | without `noexec` | fuse.fsp rw,nosuid,nodev,noatime | ✓ no `noexec`; binary execution from `/mnt/us/dashboard` allowed |
| Wi-Fi `cmState` | CONNECTED | CONNECTED | Network available during test |
| UI restore after `stop`/`start lab126_gui` | library returns | 30 s boot splash (tree + progress bar, no reboot: uptime kept), then appmgrd «Timed out waiting for app to finish GO» for `com.lab126.booklet.home` and the alert `appmgrAppFailedFatal` («Softwarefehler»); appmgrd is not part of `lab126_gui` and keeps its state | The client pauses the UI instead (as KOReader on FW ≥ 5.7.2): framebuffer saved, `disableEnablePillow disable`, `killall -STOP awesome`; on exit `-CONT awesome`, framebuffer restored, pillow enabled, `appmgrd start app://com.lab126.booklet.home` |
| Screen size | 1072 × 1448 (Paperwhite 3) | 600 × 800, 167 ppi: the first start showed only the top-left part of a 1072 × 1448 image | WP63GW is the Kindle 7th generation, not a Paperwhite 3. Server renders 600 × 800 (layout 1072 × 1429 CSS px, scale 0.56); client defaults `screenWidth` 600 / `screenHeight` 800 |

## Decisions

Based on observed facts from the device capture:

1. **Touch device name**: Must change default from `cyttsp4_mt` to `zforce2` in Task 2 (`Defaults().Touch.DeviceName`) and Task 12 (`config.example.json`).

2. **Touch axis calibration**: No `swapXY`, `invertX`, or `invertY` flags needed. Axis order is standard (X increases left→right, Y increases top→bottom).

3. **Touch coordinate scaling**: Raw device coordinates span ~600 × ~800, the same as the 600 × 800 screen (the first version of this note wrongly assumed a 1072 × 1448 screen). Scaling via the `EVIOCGABS` ranges stays in place. Note: Device emits `ABS_MT_TRACKING_ID`, `ABS_MT_POSITION_X`, `ABS_MT_POSITION_Y`, `BTN_TOUCH`, `BTN_TOOL_FINGER`, but never emits `ABS_MT_SLOT` events (implicit slot 0).

4. **Power key code**: Confirmed as 116 (KEY_POWER); use as `powerKeyCode` default.

5. **System readiness**: Kernel ≥ 2.6.32 ✓, device clock correct ✓, fbink available ✓, setsid available ✓, `/mnt/us` executable ✓, Wi-Fi connected ✓. All prerequisites met for dashboard client deployment.
