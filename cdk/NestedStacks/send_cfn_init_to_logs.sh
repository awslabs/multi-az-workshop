TOKEN=$(curl --silent -X PUT 'http://169.254.169.254/latest/api/token' -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600')
INSTANCE_ID=$(curl --silent -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
LOG_STREAM=${INSTANCE_ID}-cfn-init
LOG_GROUP=/multi-az-workshop/frontend
LOG_FILE=/var/log/cfn-init.log
MAX_EVENTS=10000
MAX_SIZE=1048576
ADDITIONAL_BYTES_PER_LOG=26
TIMESTAMP_REGEX="^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3}"
if ! aws logs describe-log-streams --log-group-name "$LOG_GROUP" --log-stream-name-prefix "$LOG_STREAM" | grep -q "$LOG_STREAM"; then
  aws logs create-log-stream --log-group-name "$LOG_GROUP" --log-stream-name "$LOG_STREAM"
fi
log_events=()
current_size=0
current_entry=''
current_ts=0
while IFS= read -r line
do
  if [[ "$line" =~ $TIMESTAMP_REGEX ]]; then
    timestamp_str=$(echo $line | awk '{print $1 " " $2}' | sed 's/,/./')
    timestamp_epoch=$(date -d "$timestamp_str" +%s%3N)
    if [[ -n "$current_entry" ]]; then
      escaped_msg=$(echo $current_entry | jq -R .)
      item="{\"timestamp\": $current_ts, \"message\": ${escaped_msg}}"
      element_size=$(printf "%s" "$item" | wc -c)
      line_size=$(($element_size + $ADDITIONAL_BYTES_PER_LOG))
      if [[ ${#log_events[@]} -eq $MAX_EVENTS ]] || [[ $(($current_size + $line_size)) -gt $MAX_SIZE ]]; then
        log_events_json=$(printf "%s\n" "${log_events[@]}" | jq -s '.')
        aws logs put-log-events --log-group-name $LOG_GROUP --log-stream-name $LOG_STREAM --log-events "$log_events_json"
        log_events=("$item")
        current_size=$line_size
      else
        log_events+=("$item")
        current_size=$(($current_size + $line_size))
      fi
    fi
    current_ts=$timestamp_epoch
    current_entry=$(echo $line | sed 's/^[^ ]\+ [^ ]\+ //')
  else
    current_entry="$current_entry"$'\n'"$line"
  fi
done < $LOG_FILE
if [[ ${#log_events[@]} -gt 0 ]]; then
  log_events_json=$(printf "%s\n" "${log_events[@]}" | jq -s '.')
  aws logs put-log-events --log-group-name "$LOG_GROUP" --log-stream-name "$LOG_STREAM" --log-events "$log_events_json"
fi
