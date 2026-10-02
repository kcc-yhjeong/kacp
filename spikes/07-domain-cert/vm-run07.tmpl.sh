#!/usr/bin/env bash
# KACP spike 07 — kacp.cloud 와일드카드 인증서(DNS-01, Cloud DNS) + https 로 spike 03 구성 올리기. GCP VM 전용.
# 사용: bash vm-run07.sh            # Let's Encrypt staging (기본, 발급 한도 걱정 없음 — 브라우저는 경고)
#       PROD=1 bash vm-run07.sh     # 실제 인증서 (staging 성공 후)
set -uo pipefail
W="$HOME/kacp-spike07"; R="$W/results.txt"; DATA_ROOT=${DATA_ROOT:-/data}
mkdir -p "$W" && cd "$W"
exec > >(tee "$R") 2>&1
say(){ printf '\n===== %s =====\n' "$*"; }
md(){ curl -s -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/$1"; }

say "0. 파일 풀기"
echo '__BUNDLE__' | base64 -d | tar -xz -C "$W" && find "$W" -type f -not -name results.txt | sort

say "1. VM·DNS 사전 확인"
PROJECT=$(md project/project-id); EXT_IP=$(md instance/network-interfaces/0/access-configs/0/external-ip)
echo "project=$PROJECT external_ip=$EXT_IP machine=$(md instance/machine-type | awk -F/ '{print $NF}') zone=$(md instance/zone | awk -F/ '{print $NF}')"
echo "scopes: $(md instance/service-accounts/default/scopes | tr '\n' ' ')"
echo "service account: $(md instance/service-accounts/default/email)"
for h in kacp.cloud team1.kacp.cloud; do echo "$h → $(getent ahostsv4 $h | awk '{print $1; exit}')"; done
TOKEN=$(md instance/service-accounts/default/token | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
echo "Cloud DNS managedZones (서비스 계정 권한 확인):"
curl -s -H "Authorization: Bearer $TOKEN" "https://dns.googleapis.com/dns/v1/projects/$PROJECT/managedZones" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("error",{}).get("message") or [(z["name"],z["dnsName"]) for z in d.get("managedZones",[])])'

say "2. 폴더·.env"
sudo mkdir -p "$DATA_ROOT/traefik" "$DATA_ROOT/spike07/team1/openclaw"
sudo touch "$DATA_ROOT/traefik/acme.json" && sudo chmod 600 "$DATA_ROOT/traefik/acme.json"
if ! sudo test -s "$DATA_ROOT/traefik/basic-users"; then
  BA_PW=$(openssl rand -base64 12 | tr -d '/+=')
  echo "kacp:$(openssl passwd -apr1 "$BA_PW")" | sudo tee "$DATA_ROOT/traefik/basic-users" >/dev/null
  echo "$BA_PW" | sudo tee "$DATA_ROOT/traefik/basic-password.txt" >/dev/null; sudo chmod 600 "$DATA_ROOT/traefik/basic-password.txt"
fi
BA_PW=$(sudo cat "$DATA_ROOT/traefik/basic-password.txt")
echo "브라우저 basicAuth: 아이디 kacp / 비밀번호 $BA_PW  (다시 보기: sudo cat $DATA_ROOT/traefik/basic-password.txt)"
if ! sudo test -f "$DATA_ROOT/spike07/team1/openclaw/openclaw.json"; then   # sudo: 폴더가 700/1000 이라 일반 사용자는 못 봄
  sudo cp "$W/openclaw/seed-openclaw.json" "$DATA_ROOT/spike07/team1/openclaw/openclaw.json" && echo "seed written"
else echo "seed skipped (exists — 첫 기동 이후에는 덮어쓰지 않는다)"; fi
sudo chown -R 1000:1000 "$DATA_ROOT/spike07/team1" && sudo chmod 700 "$DATA_ROOT/spike07/team1/openclaw"
CA=https://acme-staging-v02.api.letsencrypt.org/directory; [ "${PROD:-0}" = 1 ] && CA=https://acme-v02.api.letsencrypt.org/directory
PW=$(grep -s '^TEAM1_GATEWAY_PASSWORD=' .env | cut -d= -f2); [ -n "$PW" ] || PW=$(openssl rand -hex 24)
printf 'OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:2026.9.7\nTEAM1_GATEWAY_PASSWORD=%s\nGCE_PROJECT=%s\nDATA_ROOT=%s\nACME_CA_SERVER=%s\n' "$PW" "$PROJECT" "$DATA_ROOT" "$CA" > .env
sed 's/PASSWORD=.*/PASSWORD=(생략)/' .env
if [ "${RESET_ACME:-0}" = 1 ] || { [ "${PROD:-0}" = 1 ] && sudo grep -q 'acme-staging' "$DATA_ROOT/traefik/acme.json" 2>/dev/null; }; then
  echo "acme.json 비우기 (0바이트 — 빈 줄을 쓰면 Traefik 이 JSON 오류로 resolver 를 끈다)"; sudo truncate -s 0 "$DATA_ROOT/traefik/acme.json"; sudo chmod 600 "$DATA_ROOT/traefik/acme.json"
fi

say "3. 기동"
docker rm -f kacp-team-team1 >/dev/null 2>&1 && echo "(spike 06 팀 컨테이너 정리)"
docker compose up -d --force-recreate traefik && docker compose up -d
for i in $(seq 1 45); do s=$(docker inspect kacp-spike07-openclaw-team1-1 --format '{{.State.Health.Status}}' 2>/dev/null); [ "$s" = healthy ] && break; sleep 4; done
docker compose ps --format '{{.Service}} {{.Status}}'

say "4. 인증서 발급 대기 (DNS-01, 최대 5분)"
t0=$SECONDS
for i in $(seq 1 60); do
  sudo python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));c=[x for r in d.values() for x in (r.get("Certificates") or [])];print(len(c));sys.exit(0 if c else 1)' "$DATA_ROOT/traefik/acme.json" >/dev/null 2>&1 && { echo "acme.json 에 인증서 저장됨 ($((SECONDS-t0))s)"; break; }
  sleep 5
done
docker compose logs traefik 2>&1 | grep -iE 'acme|certificate|challenge|error|gcloud|unable' | tail -12 | cut -c1-260
echo | openssl s_client -connect 127.0.0.1:443 -servername team1.kacp.cloud 2>/dev/null | openssl x509 -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null
echo "acme.json 인증서 목록:"
sudo python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));[print("  main=%s sans=%s" % (x["domain"].get("main"), x["domain"].get("sans"))) for r in d.values() for x in (r.get("Certificates") or [])]' "$DATA_ROOT/traefik/acme.json"

say "5. https 동작 확인 (VM 안에서, --resolve 127.0.0.1)"
K=-k; [ "${PROD:-0}" = 1 ] && K=""
C(){ curl -s $K -u "kacp:$BA_PW" --resolve team1.kacp.cloud:443:127.0.0.1 --resolve kacp.cloud:443:127.0.0.1 "$@"; }
curl -s $K --resolve team1.kacp.cloud:443:127.0.0.1 -o /dev/null -w 'https basicAuth 없이 /  -> %{http_code} (401 이어야 함)
' https://team1.kacp.cloud/
curl -s -o /dev/null -w 'http :80 /           -> %{http_code} %{redirect_url}\n' -H 'Host: team1.kacp.cloud' http://127.0.0.1/
C -o /dev/null -w 'https 비로그인 /      -> %{http_code} %{redirect_url}\n' https://team1.kacp.cloud/
C -o /dev/null -w 'https carol /claw/    -> %{http_code}\n' -b kacp_dev_user=carol https://team1.kacp.cloud/claw/
C -o /dev/null -w 'https bob /claw/      -> %{http_code} %{content_type}\n' -b kacp_dev_user=bob https://team1.kacp.cloud/claw/
C -D - -o /dev/null -b kacp_dev_user=bob https://team1.kacp.cloud/claw/ | grep -ioE 'frame-ancestors [^;]*|^x-frame-options.*|^strict-transport-security.*'
C -o /dev/null -w 'wss bob /claw (upgrade) -> %{http_code}\n' --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -m 4 -b kacp_dev_user=bob https://team1.kacp.cloud/claw
C -b 'kacp_dev_user=bob; kacp_session=SECRET; app_pref=dark' -H 'X-Forwarded-User: evil@x' https://team1.kacp.cloud/_debug/ | grep -iE '^(cookie|x-forwarded-user|x-forwarded-proto):'
for h in team1.kacp.cloud x.kacp.cloud kacp.cloud; do
  echo "[$h 에 나가는 인증서] $(echo | openssl s_client -connect 127.0.0.1:443 -servername $h 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName 2>/dev/null | tr '\n' ' ')"
done
ss -ltnp 2>/dev/null | grep -E ':(80|443|18789|18790) ' | awk '{print "listen", $4}'

say "끝 — 출력 전체(또는 $R)를 Claude 에게 붙여 주세요. 그다음 브라우저 확인 안내를 드립니다."
