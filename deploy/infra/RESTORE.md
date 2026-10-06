# KACP 복구 절차 (VM)

백업은 두 가지다.

| 무엇 | 어디 | 주기 | 보관 |
|---|---|---|---|
| Postgres 덤프 | `/data/backups/postgres/kacp-YYYYMMDD-HHMM.dump` (`backup.sh`, cron `/etc/cron.d/kacp-backup`, 로그 `/var/log/kacp-backup.log`) | 매일 03:30 | 최근 14개 |
| 데이터 디스크 `/data` 전체 (드라이브, 팀 상태, 앱 스냅샷, MCP 업로드, 위 덤프) | GCP 디스크 스냅샷 일정 | 매일 (콘솔에서 설정) | 7일 |

데이터 디스크 스냅샷 일정 설정(한 번): GCP 콘솔 → Compute Engine → 스냅샷 → 스냅샷 일정 만들기(매일, 7일 보관, 리전 `asia-northeast3`) → 디스크(`/data` 데이터 디스크) → 수정 → 스냅샷 일정 연결.

## 1. 지금 바로 덤프 하나 만들기

```bash
sudo /opt/kacp/deploy/infra/backup.sh
```

## 2. 복구 리허설 (운영 DB는 건드리지 않음)

임시 DB `kacp_restore_test`에 풀어 보고 행 수를 비교한 뒤 지운다.

```bash
cd /opt/kacp/deploy/infra
C="sudo docker compose -f docker-compose.yml -f docker-compose.vm.yml --env-file .env.vm"
F=$(ls -1t /data/backups/postgres/kacp-*.dump | head -1)
$C exec -T postgres createdb -U kacp kacp_restore_test
$C exec -T postgres pg_restore -U kacp -d kacp_restore_test --no-owner < "$F"
for t in users teams apps mcp_packages posts; do
  a=$($C exec -T postgres psql -U kacp -d kacp -tAc "select count(*) from $t")
  b=$($C exec -T postgres psql -U kacp -d kacp_restore_test -tAc "select count(*) from $t")
  echo "$t 운영=$a 복구=$b"
done
$C exec -T postgres dropdb -U kacp kacp_restore_test
```

## 3. 실제 복구 (DB를 덤프 시점으로 되돌림)

덤프 이후의 DB 변경은 사라진다. 팀 컨테이너·드라이브 파일은 `/data`에 그대로 있다.

```bash
cd /opt/kacp/deploy/infra
C="sudo docker compose -f docker-compose.yml -f docker-compose.vm.yml --env-file .env.vm"
F=/data/backups/postgres/kacp-YYYYMMDD-HHMM.dump     # 되돌릴 덤프
$C stop api orchestrator platform-mcp                  # 쓰는 쪽을 먼저 멈춘다
$C exec -T postgres dropdb -U kacp kacp
$C exec -T postgres createdb -U kacp kacp
$C exec -T postgres pg_restore -U kacp -d kacp --no-owner < "$F"
$C up -d                                               # api가 남은 마이그레이션을 적용하고 실행 중인 팀에 설정을 다시 반영
```

## 4. 디스크째 복구 (VM·디스크 손상)

GCP 콘솔에서 스냅샷으로 새 디스크를 만들어 VM에 붙이고 `/data`로 마운트한 뒤 `vm-deploy.sh`를 실행한다. `.env.vm`은 `/opt/kacp/deploy/infra/`에 있어 디스크 스냅샷에 들어가지 않으므로 **따로 안전한 곳에 보관**한다(`INTERNAL_TOKEN`·`APP_ENCRYPTION_KEY`가 바뀌면 저장된 Gateway 비밀번호·공용 API 키를 풀 수 없다).
