#!/bin/bash
cd /home/itziktdk/.openclaw/workspace/picktime
pkill -f "node server.js" 2>/dev/null
sleep 1
node server.js &
sleep 2
echo "server restarted"
