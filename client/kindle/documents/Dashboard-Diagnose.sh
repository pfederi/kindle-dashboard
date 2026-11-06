#!/bin/sh
# Name: Dashboard-Diagnose
# Author: kindle-dashboard
# Collects device facts for the dashboard client. The Kindle UI keeps running.
# Output (shown on screen via the launcher's fbink pipe) is German for the user;
# results go to /mnt/us/dashboard/diag.txt, touch.bin and power.bin.
OUT=/mnt/us/dashboard
mkdir -p "$OUT"
D="$OUT/diag.txt"

handler() { # $1 = device name in /proc/bus/input/devices, $2 = fallback
  h=$(awk -v name="$1" '
    /^N: Name=/ { n = $0 }
    /^H: Handlers=/ { sub(/^H: Handlers=/, ""); if (index(n, "\"" name "\"")) for (i = 1; i <= NF; i++) if ($i ~ /^event/) print $i }
  ' /proc/bus/input/devices | head -n 1)
  [ -n "$h" ] && echo "$h" || echo "$2"
}

TOUCH=$(handler cyttsp4_mt event1)
POWER=$(handler max77696-onkey event0)

{
  echo "== date"; date; date -u
  echo "== uname"; uname -a
  echo "== osrelease"; cat /proc/sys/kernel/osrelease
  echo "== id"; id
  echo "== fbink"
  for p in /var/local/kmc/bin/fbink /mnt/us/libkh/bin/fbink; do
    if [ -f "$p" ]; then echo "OK $p"; else echo "MISSING $p"; fi
  done
  echo "== tools"
  for t in setsid nohup awk lipc-get-prop lipc-set-prop stop start initctl; do
    command -v "$t" >/dev/null 2>&1 && echo "OK $t" || echo "MISSING $t"
  done
  echo "== input devices"; cat /proc/bus/input/devices
  echo "== chosen handlers"; echo "touch=$TOUCH power=$POWER"
  echo "== wifi cmState"; lipc-get-prop com.lab126.wifid cmState
  echo "== upstart"; initctl list 2>/dev/null | grep -E 'lab126_gui|framework|kmc'
  echo "== mount /mnt/us"; grep ' /mnt/us ' /proc/mounts
} > "$D" 2>&1

echo "Dashboard-Diagnose"
echo "In 5 s: die vier Ecken antippen,"
echo "oben links, oben rechts, unten rechts, unten links."
echo "Danach: Ein/Aus-Taste kurz druecken"
echo "und den Kindle wieder aufwecken."
sleep 5
if [ -e "/dev/input/$TOUCH" ]; then
  cat "/dev/input/$TOUCH" > "$OUT/touch.bin" &
  TP=$!
else
  echo "MISSING /dev/input/$TOUCH" >> "$D"
  TP=""
fi
if [ -e "/dev/input/$POWER" ]; then
  cat "/dev/input/$POWER" > "$OUT/power.bin" &
  PP=$!
else
  echo "MISSING /dev/input/$POWER" >> "$D"
  PP=""
fi
echo "Aufnahme laeuft (20 s) ..."
sleep 20
[ -n "$TP" ] && kill "$TP" 2>/dev/null
[ -n "$PP" ] && kill "$PP" 2>/dev/null
echo "== capture" >> "$D"
ls -l "$OUT/touch.bin" "$OUT/power.bin" >> "$D" 2>&1
sync
echo "Fertig. Ergebnisse in /mnt/us/dashboard"
