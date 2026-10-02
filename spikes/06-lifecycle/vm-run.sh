#!/usr/bin/env bash
# KACP spike 06 — GCP VM 자동 측정 (1부: 생명주기·권한·UID·콜드스타트·비정상 종료 회복·argon2)
# 사용: bash vm-run.sh        (sudo 권한 필요. 결과는 ~/kacp-spike06/results.txt 와 화면에 출력)
set -uo pipefail
W="$HOME/kacp-spike06"; R="$W/results.txt"
mkdir -p "$W" && cd "$W"
exec > >(tee "$R") 2>&1
say(){ printf '\n===== %s =====\n' "$*"; }

say "0. 파일 풀기"
echo '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' | base64 -d | tar -xz -C "$W" && ls -R "$W" | head -20

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
