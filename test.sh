#!/bin/bash
CONTRACT_ID="10000001"
BASE_URL="https://pro.edgex.exchange/api/v1/public/funding/getFundingRatePage"
START_TS=1735689600000  # 2025-11-01 00:00 UTC
END_TS=1738304000000    # 2025-12-01 00:00 UTC
SIZE=100
OFFSET=""

echo "timestamp,fundingRate,contractId" > november_funding.csv

while true; do
  URL="${BASE_URL}?contractId=${CONTRACT_ID}&size=${SIZE}&filterBeginTimeInclusive=${START_TS}&filterEndTimeExclusive=${END_TS}"
  [ -n "$OFFSET" ] && URL="${URL}&offsetData=${OFFSET}"
  
  echo "Fetching: $URL"
  DATA=$(curl -s "$URL")
  
  # Extrahiere nextOffset und dataList (jq nötig)
  NEXT_OFFSET=$(echo "$DATA" | jq -r '.data.nextPageOffsetData // empty')
  echo "$DATA" | jq -r '.data.dataList[] | "\(.fundingTimestamp),\(.fundingRate),\(.contractId)"' >> november_funding.csv
  
  [ "$NEXT_OFFSET" = "null" ] || [ -z "$NEXT_OFFSET" ] && break
  OFFSET="$NEXT_OFFSET"
done

echo "Alle November-Daten in november_funding.csv"

