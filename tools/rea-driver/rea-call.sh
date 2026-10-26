#!/bin/zsh
# Sends one tool call to a running rea-driver.mjs and waits for the reply.
# usage: REA_SESSION_DIR=<workDir> tools/rea-driver/rea-call.sh <id> <tool> '<json args>' [wait_seconds]
# prints "RESULT <file>" when the reply arrived, or "PENDING <id>" if it is still running (check res/<id>.json later).
W="${REA_SESSION_DIR:?set REA_SESSION_DIR to the driver's work directory}"
id=$1; tool=$2; args=$3; wait=${4:-120}
python3 -I -c "import json,sys; json.dump({'name':sys.argv[1],'arguments':json.loads(sys.argv[2])}, open(sys.argv[3]+'.tmp','w'))" "$tool" "$args" "$W/req/$id.json" \
  && mv "$W/req/$id.json.tmp" "$W/req/$id.json"
for i in $(seq 1 "$wait"); do [ -f "$W/res/$id.json" ] && break; sleep 1; done
[ -f "$W/res/$id.json" ] && echo "RESULT $W/res/$id.json" || echo "PENDING $id"
