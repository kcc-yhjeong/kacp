#!/usr/bin/env bash
# KACP spike 06 — GCP VM 자동 측정 (1부: 생명주기·권한·UID·콜드스타트·비정상 종료 회복·argon2)
# 사용: bash vm-run.sh        (sudo 권한 필요. 결과는 ~/kacp-spike06/results.txt 와 화면에 출력)
set -uo pipefail
W="$HOME/kacp-spike06"; R="$W/results.txt"
mkdir -p "$W" && cd "$W"
exec > >(tee "$R") 2>&1
say(){ printf '\n===== %s =====\n' "$*"; }

say "0. 파일 풀기"
echo '__BUNDLE__' | base64 -d | tar -xz -C "$W" && ls -R "$W" | head -20

say "1. 환경"
date -u; uname -a; nproc; free -g | head -2
. /etc/os-release && echo "$PRETTY_NAME"
docker version --format 'docker engine {{.Server.Version}} / client {{.Client.Version}}' || { echo "docker 없음 — 중단"; exit 1; }
docker compose version || { echo "docker compose 플러그인 없음 — 중단"; exit 1; }
docker info --format 'DockerRootDir={{.DockerRootDir}} Storage={{.Driver}} Cgroup={{.CgroupVersion}}'
df -h /data 2>/dev/null || echo "/data 없음(05 §5 데이터 디스크 확인 필요)"
DATA_ROOT=${DATA_ROOT:-/data}

say "2. 상태 폴더 (bind mount, 1000:1000 0700)"
sudo mkdir -p "$DATA_ROOT/teams/team1/openclaw"
sudo chown -R 1000:1000 "$DATA_ROOT/teams/team1"
sudo chmod 700 "$DATA_ROOT/teams/team1/openclaw"
ls -ldn "$DATA_ROOT/teams/team1/openclaw"

say "3. .env"
if [ ! -f .env ]; then
  printf 'OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:2026.9.7\nTEAM1_GATEWAY_PASSWORD=%s\nSTATE_MODE=bind\nDATA_ROOT=%s\n' "$(openssl rand -hex 24)" "$DATA_ROOT" > .env
fi
sed 's/PASSWORD=.*/PASSWORD=(생략)/' .env

say "4. 이미지 받기"
for i in ghcr.io/openclaw/openclaw:2026.9.7 tecnativa/docker-socket-proxy:v0.5.0 node:22-alpine node:22; do
  s=$SECONDS; docker pull -q "$i" >/dev/null && echo "$i $((SECONDS-s))s"
done
docker image inspect ghcr.io/openclaw/openclaw:2026.9.7 --format 'openclaw digest {{index .RepoDigests 0}}'

say "5. socket-proxy·orch 기동"
docker compose up -d && sleep 3 && docker compose ps --format '{{.Service}} {{.Status}}'
O(){ docker exec kacp-spike06-orch-1 node /orch/lifecycle.mjs "$@"; }

say "6. 권한 차단 (deny)"
O deny team1

say "7. 첫 생성·시드·기동 (bind mount)"
docker rm -f kacp-team-team1 >/dev/null 2>&1
O up team1
docker inspect kacp-team-team1 --format 'health={{.State.Health.Status}} ports={{json .NetworkSettings.Ports}} mounts={{range .Mounts}}{{.Type}}:{{.Source}}->{{.Destination}} {{end}}'
docker exec kacp-team-team1 id
sudo ls -ln "$DATA_ROOT/teams/team1/openclaw" | head
docker exec kacp-team-team1 node openclaw.mjs config get gateway.roles.definitions.member.sessions.others 2>&1 | tail -1
O deny team1 | grep exec

say "8. 콜드·웜 5회"
O bench team1 5

say "9. 비정상 종료(docker kill) 뒤 회복 시간"
docker kill kacp-team-team1 >/dev/null; t0=$(date +%s)
for i in $(seq 1 80); do
  docker start kacp-team-team1 >/dev/null 2>&1; sleep 8
  st=$(docker inspect kacp-team-team1 --format '{{.State.Status}}/{{.State.Health.Status}}')
  case "$st" in running/healthy) echo "kill 후 healthy 까지 $(( $(date +%s)-t0 ))s (시도 $i)"; break;; esac
done
docker logs --since 10m kacp-team-team1 2>&1 | grep -iE 'owner lease|state ownership' | tail -2

say "10. 팀별 UID (User=2001:2001) 호환성"
sudo mkdir -p "$DATA_ROOT/teams/team2/openclaw" && sudo chown -R 2001:2001 "$DATA_ROOT/teams/team2" && sudo chmod 700 "$DATA_ROOT/teams/team2/openclaw"
docker rm -f kacp-uidtest >/dev/null 2>&1
docker run -d --name kacp-uidtest --user 2001:2001 -e HOME=/home/node -e OPENCLAW_GATEWAY_PASSWORD=x \
  -v "$DATA_ROOT/teams/team2/openclaw:/home/node/.openclaw" ghcr.io/openclaw/openclaw:2026.9.7 >/dev/null
sleep 60; docker inspect kacp-uidtest --format 'uid2001 status={{.State.Status}} exit={{.State.ExitCode}}'
docker logs kacp-uidtest 2>&1 | grep -v '│' | grep -iE 'error|EACCES|EPERM|ready|denied' | head -5
sudo ls -ln "$DATA_ROOT/teams/team2/openclaw" | head -5
docker rm -f kacp-uidtest >/dev/null 2>&1

say "11. argon2id"
docker run --rm -v "$W/orch:/w:ro" node:22 sh -c 'cd /tmp && npm i --silent @node-rs/argon2@2 >/dev/null 2>&1 && cp /w/argon2-bench.mjs . && node argon2-bench.mjs'

say "끝 — 이 출력 전체(또는 $R)를 Claude 에게 붙여 주세요"
