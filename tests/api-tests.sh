#!/bin/bash
# Snaptor API Test Suite
BASE="https://picktime-app.azurewebsites.net/api"
PASS=0
FAIL=0
SLUG="test-$(date +%s)"

test_endpoint() {
  local desc="$1"
  local expected_code="$2"
  local method="$3"
  local url="$4"
  local data="$5"
  
  if [ -n "$data" ]; then
    actual=$(curl -s -o /tmp/test_response.json -w "%{http_code}" -X "$method" "$url" -H "Content-Type: application/json" -d "$data")
  else
    actual=$(curl -s -o /tmp/test_response.json -w "%{http_code}" -X "$method" "$url")
  fi
  
  if [ "$actual" = "$expected_code" ]; then
    echo "✅ PASS: $desc (HTTP $actual)"
    PASS=$((PASS + 1))
  else
    echo "❌ FAIL: $desc (expected $expected_code, got $actual)"
    echo "   Response: $(cat /tmp/test_response.json | head -c 200)"
    FAIL=$((FAIL + 1))
  fi
}

echo "🧪 Snaptor API Test Suite"
echo "========================="
echo "Slug: $SLUG"
echo ""

# Health
test_endpoint "Health check" "200" "GET" "$BASE/health"

# Business CRUD
test_endpoint "Create business" "201" "POST" "$BASE/businesses" "{\"name\":\"Test $SLUG\",\"slug\":\"$SLUG\",\"type\":\"barber\",\"phone\":\"050$RANDOM\",\"services\":[{\"name\":\"Haircut\",\"duration\":30,\"price\":50,\"currency\":\"ILS\"}],\"workingHours\":{\"sunday\":{\"start\":\"09:00\",\"end\":\"18:00\",\"enabled\":true},\"monday\":{\"start\":\"09:00\",\"end\":\"18:00\",\"enabled\":true},\"tuesday\":{\"start\":\"09:00\",\"end\":\"18:00\",\"enabled\":true},\"wednesday\":{\"start\":\"09:00\",\"end\":\"18:00\",\"enabled\":true},\"thursday\":{\"start\":\"09:00\",\"end\":\"18:00\",\"enabled\":true},\"friday\":{\"start\":\"09:00\",\"end\":\"14:00\",\"enabled\":true},\"saturday\":{\"start\":\"00:00\",\"end\":\"00:00\",\"enabled\":false}}}"
test_endpoint "Get business" "200" "GET" "$BASE/businesses/$SLUG"
test_endpoint "Username taken" "200" "GET" "$BASE/check-username/$SLUG"
test_endpoint "Username available" "200" "GET" "$BASE/check-username/free-$SLUG"

# Availability
TOMORROW=$(date -u -d "+1 day" +%Y-%m-%d)
test_endpoint "Get availability" "200" "GET" "$BASE/businesses/$SLUG/availability?date=$TOMORROW"

# Appointments
test_endpoint "Book appointment" "201" "POST" "$BASE/businesses/$SLUG/appointments" "{\"serviceId\":\"0\",\"customerName\":\"Test User\",\"customerPhone\":\"052$RANDOM\",\"date\":\"$TOMORROW\",\"startTime\":\"10:00\"}"
APPT_ID=$(cat /tmp/test_response.json | python3 -c "import json,sys;print(json.load(sys.stdin).get('_id',''))" 2>/dev/null)
test_endpoint "List appointments" "200" "GET" "$BASE/businesses/$SLUG/appointments"
test_endpoint "Confirm appointment" "200" "PUT" "$BASE/businesses/$SLUG/appointments/$APPT_ID" '{"status":"confirmed"}'

# Customers
test_endpoint "List customers" "200" "GET" "$BASE/businesses/$SLUG/customers"
test_endpoint "Add customer" "201" "POST" "$BASE/businesses/$SLUG/customers" '{"name":"Sarah","phone":"053111222","email":"s@t.com"}'
test_endpoint "Customer groups" "200" "GET" "$BASE/businesses/$SLUG/customers/groups"

# Tasks
test_endpoint "Create task" "201" "POST" "$BASE/businesses/$SLUG/tasks" '{"text":"Order supplies"}'
TASK_ID=$(cat /tmp/test_response.json | python3 -c "import json,sys;print(json.load(sys.stdin).get('_id',''))" 2>/dev/null)
test_endpoint "List tasks" "200" "GET" "$BASE/businesses/$SLUG/tasks"
test_endpoint "Complete task" "200" "PUT" "$BASE/businesses/$SLUG/tasks/$TASK_ID" '{"completed":true}'

# Announcements
test_endpoint "Create announcement" "201" "POST" "$BASE/businesses/$SLUG/announcements" '{"message":"Closed tomorrow"}'
test_endpoint "List announcements" "200" "GET" "$BASE/businesses/$SLUG/announcements"

# Reschedule
test_endpoint "Request reschedule" "200" "POST" "$BASE/businesses/$SLUG/appointments/$APPT_ID/reschedule" "{\"requestedDate\":\"$TOMORROW\",\"requestedTime\":\"14:00\",\"reason\":\"Conflict\"}"

echo ""
echo "========================="
echo "Results: $PASS passed, $FAIL failed"
echo "========================="
