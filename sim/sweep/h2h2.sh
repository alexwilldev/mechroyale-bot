#!/bin/bash
cd /Users/alexwilliams/Developer/hackathon/buildersmechroyale/mechroyale-bot
r=$(timeout 900 bun sim/run.ts --n 150 --seed "$3" --mode ffa --ours 4 --nb 4 --set "$1" --b "$2" 2>&1 | grep HEAD2HEAD)
echo "A[$1] B[$2] seed$3 | $r"
