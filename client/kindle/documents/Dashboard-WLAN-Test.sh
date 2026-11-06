#!/bin/sh
# Name: Dashboard-WLAN-Test
# Author: kindle-dashboard
# DontUseFBInk
# Checks the night power saving on the device: with the Kindle UI paused as the
# dashboard pauses it, the WLAN is turned off for 60 s and on again; the script
# records whether it reconnects and how long that takes. About 2 minutes; the
# dashboard must not be running. Results go to /mnt/us/dashboard/wlan-test.txt.
# Runs detached: the launcher would kill -9 a child still running when it unloads.
OUT=/mnt/us/dashboard/wlan-test.txt
# shellcheck disable=SC2016  # the body expands in the inner shell
setsid nohup sh -c '
OUT=$0
FBINK=/var/local/kmc/bin/fbink
[ -x "$FBINK" ] || FBINK=/mnt/us/libkh/bin/fbink
say() { "$FBINK" -q -m -y 8 "$1                    " >/dev/null 2>&1; echo "$(date +%T) $1"; }
state() { lipc-get-prop com.lab126.wifid cmState 2>&1; }
restore() {
  lipc-set-prop com.lab126.cmd wirelessEnable 1
  killall -CONT awesome
  lipc-set-prop com.lab126.pillow disableEnablePillow enable
  lipc-set-prop com.lab126.powerd preventScreenSaver 0
  lipc-set-prop com.lab126.appmgrd start app://com.lab126.booklet.home
}
trap "restore; exit 1" TERM INT
{
  echo "== start $(date)"
  echo "battLevel=$(lipc-get-prop com.lab126.powerd battLevel 2>&1) isCharging=$(lipc-get-prop com.lab126.powerd isCharging 2>&1)"
  echo "cmState=$(state) wirelessEnable=$(lipc-get-prop com.lab126.cmd wirelessEnable 2>&1)"
  # The same takeover as the dashboard client.
  lipc-set-prop com.lab126.powerd preventScreenSaver 1
  lipc-set-prop com.lab126.pillow disableEnablePillow disable
  killall -STOP awesome
  say "WLAN-Test laeuft (ca. 2 Min.), nichts antippen"
  lipc-set-prop com.lab126.cmd wirelessEnable 0
  echo "off: rc=$?"
  for s in 5 30 60; do
    sleep $(( s - ${last:-0} )); last=$s
    echo "after ${s}s off: cmState=$(state) wirelessEnable=$(lipc-get-prop com.lab126.cmd wirelessEnable 2>&1)"
  done
  say "WLAN wird wieder eingeschaltet ..."
  lipc-set-prop com.lab126.cmd wirelessEnable 1
  echo "on: rc=$?"
  n=0
  while [ $n -lt 60 ]; do
    sleep 1; n=$((n + 1))
    st=$(state)
    [ "$st" = CONNECTED ] && break
  done
  echo "after ${n}s on: cmState=$st"
  if [ "$st" = CONNECTED ]; then
    echo "RESULT ok: connected after ${n}s"
    say "OK: WLAN nach ${n} s wieder verbunden"
  else
    echo "RESULT fail: not connected after 60s"
    say "FEHLER: WLAN nach 60 s nicht verbunden"
  fi
  echo "== messages (wifi)"
  grep -iE "wifid|wpa|wlan|cmd\[" /var/log/messages 2>&1 | tail -n 60
  sleep 5
  restore
  echo "== end $(date)"
} > "$OUT" 2>&1
sync
' "$OUT" >/dev/null 2>&1 </dev/null &
exit 0
