#!/bin/sh
# Name: Dashboard
# Author: kindle-dashboard
# DontUseFBInk
# Starts the dashboard client detached and returns immediately; the launcher
# would kill -9 a child that is still running when it gets unloaded.
DIR=/mnt/us/dashboard
PID="$DIR/dashboard.pid"
# The pid file lives on persistent storage: after a reboot an unrelated process
# may own the pid, so only a process whose cmdline mentions "dashboard" counts.
P=$(cat "$PID" 2>/dev/null)
if [ -n "$P" ] && { tr '\0' ' ' < "/proc/$P/cmdline" | grep -q dashboard; } 2>/dev/null; then
  exit 0
fi
chmod +x "$DIR/dashboard" 2>/dev/null
cd /
# The binary pauses the Kindle UI (window manager stopped, status bar hidden) and
# gives it back itself on a normal exit (code 0). For any other end (fatal runtime
# error, SIGKILL) the wrapper resumes the UI and shows the library; code 3 means
# another instance owns the screen. It traps TERM/INT so a signal to the wrapper
# cannot skip that restore.
# The binary's stderr (Go crash traces) goes to crash.log, truncated per start.
# shellcheck disable=SC2016  # $0 must expand in the inner shell (it is $DIR)
setsid nohup sh -c 'trap : TERM INT; "$0/dashboard" 2>"$0/crash.log"; case $? in 0|3) ;; *) killall -CONT awesome; lipc-set-prop com.lab126.pillow disableEnablePillow enable; lipc-set-prop com.lab126.powerd preventScreenSaver 0; lipc-set-prop com.lab126.appmgrd start app://com.lab126.booklet.home ;; esac' "$DIR" >/dev/null 2>&1 </dev/null &
exit 0
