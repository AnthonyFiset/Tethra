#!/bin/sh
# linuxserver creates testuser with the Alpine default shell; the QA suite
# needs bash (like Ubuntu/Debian targets) so shell integration engages.
sed -i 's#^\(testuser:.*\):[^:]*$#\1:/bin/bash#' /etc/passwd
