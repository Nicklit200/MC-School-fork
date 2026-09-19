#!/usr/bin/env bash
# Creates a teacher and a student on a locally running backend.
# Usage:  ./scripts/seed-local.sh
set -euo pipefail

API="${API:-http://localhost:8080/api/v1}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@mcschool.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-ChangeMe123!}"

jqval() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }

echo "→ logging in as admin"
ADMIN_TOKEN=$(curl -sf -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | jqval "['accessToken']")

echo "→ creating teacher maria@mcschool.local"
TINV=$(curl -sf -X POST "$API/teachers" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"fullName":"Maria Teacher","email":"maria@mcschool.local"}' | jqval "['invitationToken']")

# Non-student roles must confirm their e-mail when activating.
curl -sf -X POST "$API/auth/activate" -H 'Content-Type: application/json' \
  -d "{\"invitationToken\":\"$TINV\",\"email\":\"maria@mcschool.local\",\"password\":\"TeacherPass123!\"}" \
  > /dev/null
TEACHER_TOKEN=$(curl -sf -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"maria@mcschool.local","password":"TeacherPass123!"}' | jqval "['accessToken']")

echo "→ creating student sam@mcschool.local"
curl -sf -X POST "$API/students" -H "Authorization: Bearer $TEACHER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"fullName":"Sam Student","email":"sam@mcschool.local"}' > /dev/null

SINV=$(curl -sf "$API/students" -H "Authorization: Bearer $TEACHER_TOKEN" | jqval "[0]['invitationToken']")
# Students may activate without supplying an e-mail.
curl -sf -X POST "$API/auth/activate" -H 'Content-Type: application/json' \
  -d "{\"invitationToken\":\"$SINV\",\"password\":\"StudentPass123!\"}" > /dev/null

USERNAME=$(curl -sf "$API/students" -H "Authorization: Bearer $TEACHER_TOKEN" | jqval "[0].get('username','(none)')")
STUDENT_ID=$(curl -sf "$API/students" -H "Authorization: Bearer $TEACHER_TOKEN" | jqval "[0]['id']")

# Optional: a class that needs no Google Calendar. Only works when the backend
# runs with ONLINE_CLASS_ALLOW_TEST_CLASSES=true.
CLASS_LINE="(set ONLINE_CLASS_ALLOW_TEST_CLASSES=true on the backend to auto-create one)"
if CLASS_ID=$(curl -sf -X POST "$API/online-classes/test-class?studentId=$STUDENT_ID&title=QA%20class" \
      -H "Authorization: Bearer $TEACHER_TOKEN" 2>/dev/null | jqval "['id']" 2>/dev/null); then
  CLASS_LINE="http://localhost:5173/online-classes/$CLASS_ID"
fi

cat <<SUMMARY

Done. Log in at http://localhost:5173

  TEACHER   maria@mcschool.local / TeacherPass123!
  STUDENT   sam@mcschool.local   / StudentPass123!   (username: $USERNAME)
  ADMIN     $ADMIN_EMAIL / $ADMIN_PASSWORD

  Test class: $CLASS_LINE

SUMMARY
