#!/usr/bin/env bash
# KACP spike 06 (2부) — 샌드박스 형제 컨테이너 + 샌드박스 턴에서 MCP 사용 가능 여부. spike 07 환경 위에서 돈다(GCP VM).
# 사용: bash vm-run06b.sh      (먼저 vm-run07.sh 가 성공해 ~/kacp-spike07 이 떠 있어야 함)
set -uo pipefail
W="$HOME/kacp-spike07"; R="$W/results-06b.txt"
cd "$W" || { echo "~/kacp-spike07 없음 — vm-run07.sh 먼저"; exit 1; }
exec > >(tee "$R") 2>&1
say(){ printf '\n===== %s =====\n' "$*"; }
DC="docker compose -f docker-compose.yml -f sandbox/docker-compose.sbx.yml"
GW=kacp-spike07-openclaw-team1-1
G(){ docker exec $GW node openclaw.mjs "$@"; }
wait_healthy(){ for i in $(seq 1 60); do [ "$(docker inspect $GW --format '{{.State.Health.Status}}' 2>/dev/null)" = healthy ] && return 0; sleep 3; done; echo "healthy 안 됨"; docker logs --tail 20 $GW 2>&1 | grep -v '│'; }

say "0. 파일 풀기"
mkdir -p sandbox && echo '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' | base64 -d | tar -xz -C sandbox && ls sandbox

say "1. 이미지 빌드 (샌드박스 기본 이미지, 팀 Gateway + docker CLI)"
docker build -q -t openclaw-sandbox:bookworm-slim -f sandbox/Dockerfile.sandbox sandbox
docker build -q -t kacp/openclaw:2026.9.7-sbx -f sandbox/Dockerfile.gateway sandbox
docker run --rm --entrypoint docker kacp/openclaw:2026.9.7-sbx --version

say "2. 샌드박스 구성으로 재기동 (sbx-proxy, DOCKER_HOST, echo MCP)"
$DC up -d 2>&1 | grep -vE 'Pulling|Download|Extract|Waiting|Verifying' | tail -8
wait_healthy; $DC ps --format '{{.Service}} {{.Status}}'
docker exec $GW sh -c 'echo DOCKER_HOST=$DOCKER_HOST; docker version --format "proxy 경유 docker server {{.Server.Version}}"' 2>&1 | tail -2
G config set mcp.servers.kacp-echo '{"url":"http://echo-mcp:7000/mcp","transport":"streamable-http","headers":{"Authorization":"Bearer team1-mcp-service-token"}}' --strict-json 2>&1 | tail -1
echo "기본 모델: $(G config get agents.defaults.model 2>&1 | tail -1)"

turn(){ # $1=라벨
  local label=$1 t0=$SECONDS
  local msg="다음 두 가지를 순서대로 해줘. 1) 셸 명령 'id; hostname; pwd; ls /workspace | head -5' 를 실행하고 출력을 그대로 보여줘. 2) kacp_whoami 도구를 note \"$label\" 로 호출하고, 결과의 receivedMeta 안 sandbox_mode 값을 알려줘. 도구를 못 쓰면 못 쓴다고 말해줘."
  timeout 300 docker exec $GW node openclaw.mjs agent --session-key "agent:main:spike06-$label" --message "$msg" --json --timeout 240 > "out-$label.json" 2>&1
  echo "[$label] exit=$? ${SECONDS}s-${t0}s"
  python3 - "out-$label.json" <<'PY'
import json,sys,re
raw=open(sys.argv[1],encoding='utf-8',errors='replace').read()
try:
  j=json.loads(raw[raw.index('{'):])
  txt=json.dumps(j,ensure_ascii=False)
  m=[v for k,v in (j.items() if isinstance(j,dict) else []) if k in ('text','reply','output','result')]
  print('응답:', (m[0] if m else txt)[:1500])
except Exception as e:
  print('응답(raw):', raw[-1500:])
PY
  echo "[$label] echo MCP 가 받은 호출:"; docker logs kacp-spike07-echo-mcp-1 2>&1 | grep "CALL" | grep -F "\"note\":\"$label\"" | sed -E 's/.*"sandbox_mode":"([^"]*)".*"sandbox":"([^"]*)".*/  sandbox_mode=\1 sandbox=\2/; s/.*"sandbox":"([^"]*)".*"sandbox_mode":"([^"]*)".*/  sandbox=\1 sandbox_mode=\2/' | head -2
  docker logs kacp-spike07-echo-mcp-1 2>&1 | grep "CALL" | grep -cF "\"note\":\"$label\"" | sed 's/^/  호출 수: /'
  echo "[$label] Gateway 로그(샌드박스·MCP 관련):"; docker logs --since 6m $GW 2>&1 | grep -v '│' | grep -iE 'sandbox|mcp|code mode|exec-server|docker|bwrap' | grep -viE 'res ✓ (sessions|chat|presence)' | tail -8 | cut -c1-240
}

say "3. 턴 A — 샌드박스 끔 (기준선)"
turn A

say "4. 샌드박스 켬 (mode all, scope session, workspaceAccess rw, network none, user 1000:1000)"
G config set agents.defaults.sandbox '{"mode":"all","backend":"docker","scope":"session","workspaceAccess":"rw","docker":{"image":"openclaw-sandbox:bookworm-slim","containerPrefix":"kacp-sbx-team1-","network":"none","user":"1000:1000","readOnlyRoot":true,"capDrop":["ALL"],"pidsLimit":256,"memory":"1g","cpus":1}}' --strict-json 2>&1 | tail -1
sleep 4; docker logs --since 20s $GW 2>&1 | grep -E 'reload|restart' | tail -3 | cut -c1-160
$DC restart openclaw-team1 >/dev/null 2>&1; wait_healthy; echo "재기동 후 healthy"

say "5. 턴 B — 샌드박스 켬 + 기본 런타임"
turn B
echo "샌드박스 컨테이너:"; docker ps -a --filter name=kacp-sbx-team1- --format '  {{.Names}} {{.Image}} {{.Status}}'
S=$(docker ps -aq --filter name=kacp-sbx-team1- | head -1)
[ -n "$S" ] && docker inspect "$S" --format '  User={{.Config.User}} Network={{.HostConfig.NetworkMode}} ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} CapDrop={{.HostConfig.CapDrop}} Memory={{.HostConfig.Memory}}
  Labels={{json .Config.Labels}}
  Mounts={{range .Mounts}}{{.Type}}:{{.Source}}->{{.Destination}}({{if .RW}}rw{{else}}ro{{end}}) {{end}}'

say "6. 턴 C — 샌드박스 켬 + 내장 OpenClaw 런타임 강제"
PROV=$(G config get agents.defaults.model 2>&1 | tail -1 | tr -d '"' | grep -oE '^[a-z0-9-]+/' | tr -d /); PROV=${PROV:-openai}; echo "provider=$PROV"
G config set agents.defaults.models "{\"$PROV/*\":{\"agentRuntime\":{\"id\":\"openclaw\"}}}" --strict-json 2>&1 | tail -1
$DC restart openclaw-team1 >/dev/null 2>&1; wait_healthy
turn C

say "7. 샌드박스 socket-proxy 가 받은 Docker API (경로별 횟수)"
docker logs kacp-spike07-sbx-proxy-1 2>&1 | grep -oE '"(GET|POST|PUT|DELETE|HEAD) [^ ?"]+' | sed -E 's#/[0-9a-f]{12,}#/{id}#g; s#/kacp-sbx-[^/" ]+#/{sbx}#g; s#/v1\.[0-9]+##' | sort | uniq -c | sort -rn | head -25
docker logs kacp-spike07-sbx-proxy-1 2>&1 | grep -E ' 403 ' | head -5

say "8. 팀별 UID 2001 실패 원인 (로그 전체 꼬리)"
sudo mkdir -p /data/teams/team2/openclaw && sudo chown -R 2001:2001 /data/teams/team2 && sudo chmod 700 /data/teams/team2/openclaw
docker rm -f kacp-uidtest >/dev/null 2>&1
docker run -d --name kacp-uidtest --user 2001:2001 -e HOME=/home/node -e OPENCLAW_GATEWAY_PASSWORD=x \
  -v /data/teams/team2/openclaw:/home/node/.openclaw ghcr.io/openclaw/openclaw:2026.9.7 >/dev/null
sleep 45; docker inspect kacp-uidtest --format 'status={{.State.Status}} exit={{.State.ExitCode}}'
docker logs kacp-uidtest 2>&1 | grep -v '│' | grep -vE '^\s*$' | tail -15 | cut -c1-220
docker rm -f kacp-uidtest >/dev/null 2>&1

say "끝 — 출력 전체(또는 $R)를 Claude 에게 붙여 주세요"
