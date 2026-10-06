# deploy/app-runtime

앱 작업본·공개본이 쓰는 기본 이미지 3종(`05-urls-and-storage.md` §6 앱 기본 이미지).

| 이미지 | 기반 | 기본 명령 |
|---|---|---|
| `kacp/app-runtime-node:1` | `node:22-bookworm-slim` | `npm start`(scripts.start) 또는 `node server.js`·`index.js`·`app.js` |
| `kacp/app-runtime-python:1` | `python:3.12-slim-bookworm` | `python app.py`·`main.py` |
| `kacp/app-runtime-static:1` | `busybox:1.36` | `httpd -f -p $PORT -h /src` |

시작 스크립트(`entrypoint.sh`): 원본 `/src`(읽기 전용) → `/app` 복사 → 의존성 설치(`npm ci`/`npm install`, `pip install --target /app/.deps`) → `KACP_COMMAND` 실행. 정적 사이트는 `/src`를 바로 서빙한다. 데이터는 `/app-data`(`APP_DATA_DIR`), 서버는 `0.0.0.0:$PORT`(`HOST`, `PORT` 환경변수).

빌드: `docker compose -f deploy/infra/docker-compose.yml --profile build build app-runtime-node app-runtime-python app-runtime-static`
