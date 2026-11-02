#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "$WPQA_APP" "$WPQA_STATE" "$WPQA_BACKUP" "$WPQA_UPDATE" "$WPQA_CANDIDATE"
phase=preflight
program_changed=no
stopped=no
compose(){ docker compose -p deploy --env-file "$WPQA_APP/deploy/.env" -f "$WPQA_APP/deploy/compose.yaml" "$@"; }
recover(){
  rc=$?
  trap - ERR
  printf 'CUTOVER_FAILED phase=%s exit=%s\n' "$phase" "$rc"
  printf '%s\n' "$phase" > "$WPQA_BACKUP/failure-phase.txt"
  if test "$program_changed" = yes; then
    if bash "$WPQA_STATE/rollback.sh" > "$WPQA_BACKUP/rollback.log" 2>&1; then printf 'AUTOMATIC_PROGRAM_ROLLBACK=PASS\n'; else printf 'AUTOMATIC_PROGRAM_ROLLBACK=FAILED\n'; fi
  elif test "$stopped" = yes; then
    if compose start > "$WPQA_BACKUP/restart-old.log" 2>&1; then printf 'OLD_SERVICES_RESTARTED\n'; else printf 'OLD_SERVICE_RESTART_FAILED\n'; fi
  fi
  exit "$rc"
}
trap recover ERR
test "$(cat "$WPQA_STATE/build-permissions.exit")" = 0
test -s "$WPQA_BACKUP/old-images.tar.gz"
test -s "$WPQA_BACKUP/old-images.contents.txt"
test "$(cat "$WPQA_STATE/compat-final.exit")" = 0
python3 - <<'PY'
import os,pathlib,json,subprocess
app=pathlib.Path(os.environ['WPQA_APP']).resolve(); backup=pathlib.Path(os.environ['WPQA_BACKUP']).resolve()
assert not backup.is_relative_to(app)
assert not any(p.is_symlink() for p in app.rglob('*')), 'Application symlink needs separate inventory'
s=pathlib.Path(os.environ['WPQA_STATE']); old=json.loads((s/'containers-before.json').read_text())
now=json.loads(subprocess.check_output(['docker','inspect','deploy-qa-1','deploy-proxy-1'],text=True))
for a,b in zip(old,now):
 assert a['Id']==b['Id'] and a['Image']==b['Image'] and a['Mounts']==b['Mounts'],'Live configuration changed'
for n in ['deploy_qa_data','deploy_caddy_data','deploy_caddy_config']:
 subprocess.run(['docker','volume','inspect',n],check=True,stdout=subprocess.DEVNULL)
assert subprocess.run(['docker','volume','inspect','deploy_policy_data'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0, 'New policy volume already exists; inspect before proceeding'
PY
compose config --quiet
compose config > "$WPQA_BACKUP/compose-before.yaml"
/bin/cp -a "$WPQA_STATE/containers-before.json" "$WPQA_STATE/baseline-before.json" "$WPQA_BACKUP/"
phase=stopping
TZ=Asia/Tokyo date +'%Y-%m-%dT%H:%M:%S%z' > "$WPQA_BACKUP/stop-started.txt"
stopped=yes
compose stop > "$WPQA_BACKUP/stop.log" 2>&1
printf 'SERVICES_STOPPED\n'
phase=backup
tar --acls --xattrs --numeric-owner -czpf "$WPQA_BACKUP/application.tgz" -C "$(dirname "$WPQA_APP")" "$(basename "$WPQA_APP")"
gzip -t "$WPQA_BACKUP/application.tgz"
install -d -m 700 "$WPQA_BACKUP/verification/application"
tar --acls --xattrs --numeric-owner -xzpf "$WPQA_BACKUP/application.tgz" -C "$WPQA_BACKUP/verification/application"
tar -dzf "$WPQA_BACKUP/application.tgz" -C "$(dirname "$WPQA_APP")" > "$WPQA_BACKUP/application-original-compare.log" 2>&1
tar -dzf "$WPQA_BACKUP/application.tgz" -C "$WPQA_BACKUP/verification/application" > "$WPQA_BACKUP/application-restored-compare.log" 2>&1
old_image=$(docker inspect --format '{{.Image}}' deploy-qa-1)
for volume in deploy_qa_data deploy_caddy_data deploy_caddy_config; do
  docker volume inspect "$volume" > "$WPQA_BACKUP/$volume.inspect.json"
  docker run --rm --network none --read-only --user 0 --entrypoint tar --mount "type=volume,src=$volume,dst=/source,readonly" "$old_image" --acls --xattrs --numeric-owner -czpf - -C /source . > "$WPQA_BACKUP/$volume.tgz"
  gzip -t "$WPQA_BACKUP/$volume.tgz"
  install -d -m 700 "$WPQA_BACKUP/verification/$volume"
  tar --acls --xattrs --numeric-owner -xzpf "$WPQA_BACKUP/$volume.tgz" -C "$WPQA_BACKUP/verification/$volume"
  source_path=$(docker volume inspect --format '{{.Mountpoint}}' "$volume")
  tar -dzf "$WPQA_BACKUP/$volume.tgz" -C "$source_path" > "$WPQA_BACKUP/$volume-original-compare.log" 2>&1
  tar -dzf "$WPQA_BACKUP/$volume.tgz" -C "$WPQA_BACKUP/verification/$volume" > "$WPQA_BACKUP/$volume-restored-compare.log" 2>&1
done
cmp --silent "$WPQA_APP/deploy/secrets/key" "$WPQA_BACKUP/verification/application/wordpress-qa-linux/deploy/secrets/key"
cmp --silent "$WPQA_APP/deploy/secrets/users.json" "$WPQA_BACKUP/verification/application/wordpress-qa-linux/deploy/secrets/users.json"
python3 - <<'PY'
import pathlib,os,json,hashlib
root=pathlib.Path('/var/lib/docker/volumes/deploy_qa_data/_data')
before=json.loads((pathlib.Path(os.environ['WPQA_STATE'])/'baseline-before.json').read_text())
actual={p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
assert actual==before['files'], 'Data changed during preparation; retain backup and recheck baseline'
(pathlib.Path(os.environ['WPQA_BACKUP'])/'backup-verified.json').write_text(json.dumps({'application':True,'volumes':3,'restoredAndCompared':True,'dataFiles':len(actual),'keyAndUsersMatch':True}))
PY
printf 'BACKUP_RESTORE_VERIFIED\n'
phase=deploying
program_changed=yes
install -d -m 700 "$WPQA_BACKUP/previous-program"
stage="$WPQA_UPDATE/wordpress-qa-linux"
for part in bin lib builtin tests ui; do
  mv -- "$WPQA_APP/$part" "$WPQA_BACKUP/previous-program/$part"
  /bin/cp -a "$stage/$part" "$WPQA_APP/$part"
done
python3 - <<'PY'
import pathlib,os,json,shutil,hashlib
app=pathlib.Path(os.environ['WPQA_APP']); stage=pathlib.Path(os.environ['WPQA_UPDATE'])/'wordpress-qa-linux'; state=pathlib.Path(os.environ['WPQA_STATE'])
m=json.loads((stage/'MANIFEST.json').read_text())
for row in m['files']:
 rel=pathlib.PurePosixPath(row['path'])
 if rel.parts[0] in ['bin','lib','builtin','tests','ui']: continue
 assert rel.as_posix()!='deploy/.env' and 'secrets' not in rel.parts
 target=app/rel; target.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(stage/rel,target)
shutil.copy2(state/'compose-next.yaml',app/'deploy/compose.yaml')
env=app/'deploy/.env'; data=env.read_bytes(); assert not any(line.strip().startswith(b'WPQA_ADMINS=') for line in data.splitlines())
with env.open('ab') as f: f.write((b'' if data.endswith(b'\n') else b'\n')+b'WPQA_ADMINS=roonawa\n')
for row in m['files']:
 p=app/row['path']; b=p.read_bytes()
 if row['path']=='deploy/compose.yaml':
  row['sha256']=hashlib.sha256(b).hexdigest(); row['bytes']=len(b)
 else: assert len(b)==row['bytes'] and hashlib.sha256(b).hexdigest()==row['sha256'],'Installed file mismatch'
m['deploymentPatch']['modifiedFiles']=['Dockerfile','.dockerignore','deploy/compose.yaml']
m['deploymentPatch']['backendNetwork']='deploy_backend_v2'
(app/'MANIFEST.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
(app/'SHA256SUMS').write_text(''.join(r['sha256']+'  '+r['path']+'\n' for r in m['files']))
shutil.copy2(stage/'START-HERE.txt',app/'START-HERE.txt')
print('INSTALLED_PROGRAM_HASHES_VERIFIED='+str(len(m['files'])))
PY
docker volume create --label com.docker.compose.project=deploy --label com.docker.compose.volume=policy_data deploy_policy_data > "$WPQA_BACKUP/new-policy-volume.txt"
docker run --rm --network none --user 0 --mount type=volume,src=deploy_policy_data,dst=/policy --mount type=volume,src=deploy_qa_data,dst=/data,readonly "$WPQA_CANDIDATE" node --input-type=module -e 'import fs from "node:fs";import {validateDestinations} from "/app/lib/egress-policy.mjs";const rules=[...new Set(fs.readdirSync("/data/projects").filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>new URL(JSON.parse(fs.readFileSync("/data/projects/"+n)).config.baseURL).origin))].map(origin=>({origin,privateIPs:[]}));const checked=validateDestinations(rules);fs.writeFileSync("/policy/egress.json",JSON.stringify(checked),{flag:"wx",mode:0o644});fs.chownSync("/policy",1000,1000);fs.chownSync("/policy/egress.json",1000,1000);console.log("EXISTING_SITE_ORIGINS_ALLOWED="+checked.length);'
cmp --silent "$WPQA_APP/deploy/secrets/key" "$WPQA_BACKUP/verification/application/wordpress-qa-linux/deploy/secrets/key"
cmp --silent "$WPQA_APP/deploy/secrets/users.json" "$WPQA_BACKUP/verification/application/wordpress-qa-linux/deploy/secrets/users.json"
phase=build
compose config --quiet
compose config > "$WPQA_BACKUP/compose-after.yaml"
compose --progress plain build > "$WPQA_BACKUP/compose-build.log" 2>&1
printf 'ALL_SERVICE_BUILDS_COMPLETE\n'
phase=starting
compose up -d --no-build --pull never > "$WPQA_BACKUP/start.log" 2>&1
TZ=Asia/Tokyo date +'%Y-%m-%dT%H:%M:%S%z' > "$WPQA_BACKUP/services-started.txt"
docker inspect deploy-qa-1 deploy-proxy-1 deploy-egress-1 deploy-chromium-1 deploy-firefox-1 > "$WPQA_BACKUP/containers-after.json"
phase=started
printf 'CUTOVER_STARTED_ALL_SERVICES\n'

