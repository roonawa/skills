#!/usr/bin/env bash
set -euo pipefail
umask 077
: "$WPQA_APP" "$WPQA_STATE" "$WPQA_BACKUP"
restored="$WPQA_BACKUP/verification/application/wordpress-qa-linux"
test -d "$restored"
ids=$(docker ps -q --filter label=com.docker.compose.project=deploy)
if test -n "$ids"; then docker stop -t 30 $ids; fi
install -d -m 700 "$WPQA_BACKUP/failed-program"
for part in bin lib builtin tests ui; do
  if test -e "$WPQA_APP/$part"; then mv -- "$WPQA_APP/$part" "$WPQA_BACKUP/failed-program/$part"; fi
  /bin/cp -a "$restored/$part" "$WPQA_APP/$part"
done
for file in Dockerfile .dockerignore package.json package-lock.json playwright.config.mjs MANIFEST.json SHA256SUMS START-HERE.txt; do
  if test -f "$restored/$file"; then /bin/cp -a "$restored/$file" "$WPQA_APP/$file"; fi
done
for file in compose.yaml .env Caddyfile; do
  /bin/cp -a "$restored/deploy/$file" "$WPQA_APP/deploy/$file"
done
cmp --silent "$restored/deploy/secrets/key" "$WPQA_APP/deploy/secrets/key"
cmp --silent "$restored/deploy/secrets/users.json" "$WPQA_APP/deploy/secrets/users.json"
cat > "$WPQA_STATE/rollback-images.yaml" <<'JSON'
{"services":{"qa":{"image":"wpqa-rollback-20261030-0lvm9w:qa"},"proxy":{"image":"wpqa-rollback-20261030-0lvm9w:proxy"}}}
JSON
docker compose -p deploy --project-directory "$WPQA_APP/deploy" --env-file "$WPQA_APP/deploy/.env" -f "$WPQA_APP/deploy/compose.yaml" -f "$WPQA_STATE/rollback-images.yaml" up -d --no-build --pull never
TZ=Asia/Tokyo date +'%Y-%m-%dT%H:%M:%S%z' > "$WPQA_BACKUP/rollback-time.txt"
printf 'ROLLBACK_PROGRAM_ONLY_COMPLETE\n'

