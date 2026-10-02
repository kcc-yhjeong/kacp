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
echo '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' | base64 -d | tar -xz -C "$W" && find "$W" -type f -not -name results.txt | sort

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
