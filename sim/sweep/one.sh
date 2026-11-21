#!/bin/bash
# usage: one.sh "<set>" <seed> ; prints: set seed points kills
cd /Users/alexwilliams/Developer/hackathon/buildersmechroyale/mechroyale-bot
out=$(timeout 600 bun sim/run.ts --n 100 --seed "$2" --set "$1" ${3:+--mode $3} 2>&1 | sed -n '2p')
echo "$1|$2|$(echo "$out" | awk '{print $3}')|$(echo "$out" | sed -E 's/.*kills ([0-9.]+).*/\1/')"
