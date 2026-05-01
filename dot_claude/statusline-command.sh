#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name // empty')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
DURATION_MS=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')

# Rate limits — absent for non-Pro/Max users; "// empty" suppresses output
FIVE_H=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
WEEK=$(echo "$input"  | jq -r '.rate_limits.seven_day.used_percentage // empty')

COST_FMT=$(printf '$%.2f' "$COST")
MINS=$((DURATION_MS / 60000))
SECS=$(((DURATION_MS % 60000) / 1000))

# 10-block context bar
FILLED=$((PCT / 10))
EMPTY=$((10 - FILLED))
printf -v FILL "%${FILLED}s"
printf -v PAD  "%${EMPTY}s"
BAR="${FILL// /█}${PAD// /░}"

# Compact reminder once context crosses 80%
WARN=""
[ "$PCT" -ge 80 ] && WARN=" ⚠️ /compact"

LINE2="${BAR} ${PCT}%${WARN}"
[ -n "$FIVE_H" ] && LINE2="${LINE2} | 5h: $(printf '%.0f' "$FIVE_H")%"
[ -n "$WEEK"   ] && LINE2="${LINE2} | 7d: $(printf '%.0f' "$WEEK")%"

echo "[${MODEL}] 💰 ${COST_FMT} | ⏱️ ${MINS}m ${SECS}s"
echo "${LINE2}"
