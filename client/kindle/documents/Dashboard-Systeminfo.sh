#!/bin/sh
# Name: Dashboard-Systeminfo
# Author: kindle-dashboard
# Read-only: collects the UI service setup and the system log after a failed
# UI restore. The Kindle UI keeps running. Writes /mnt/us/dashboard/sysinfo.txt.
OUT=/mnt/us/dashboard/sysinfo.txt
{
  echo "== date / uptime"; date -u; cat /proc/uptime
  echo "== version"; cat /etc/prettyversion.txt 2>/dev/null; cat /etc/version.txt 2>/dev/null
  echo "== initctl list"; initctl list 2>&1
  echo "== /etc/init.d"; ls -la /etc/init.d 2>&1
  echo "== /etc/upstart"; ls -la /etc/upstart 2>&1
  for j in lab126_gui framework webreader pillow x appmgrd; do
    f=/etc/upstart/$j.conf
    [ -f "$f" ] && { echo "== $f"; cat "$f"; }
  done
  echo "== /var/local/log"; ls -la /var/local/log 2>&1
  echo "== messages (errors, crashes, restarts)"
  grep -iE 'crash|fatal|segfault|reboot|restart|watchdog|softwar|error|lab126_gui|framework' /var/log/messages 2>&1 | tail -n 400
  echo "== messages (tail)"; tail -n 300 /var/log/messages 2>&1
} > "$OUT" 2>&1
# The rotated system logs of today hold the earlier UI restores.
mkdir -p /mnt/us/dashboard/logs
for g in $(ls -t /var/local/log/messages_*.gz 2>/dev/null | head -n 3); do
  cp "$g" /mnt/us/dashboard/logs/
done
echo "Systeminfo gespeichert:"
echo "dashboard/sysinfo.txt"
