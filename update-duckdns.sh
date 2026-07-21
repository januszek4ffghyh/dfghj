#!/bin/bash
TOKEN="cfb3fa1c-695f-4b11-a592-5ededb71fe44"
DOMAIN="botmargo"

curl -s "https://www.duckdns.org/update?domains=${DOMAIN}&token=${TOKEN}&ip=" > /dev/null
echo "[$(date)] DuckDNS updated"