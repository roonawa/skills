import os,json,pathlib,hashlib,subprocess
state=pathlib.Path(os.environ['WPQA_STATE']); backup=pathlib.Path(os.environ['WPQA_BACKUP']); app=pathlib.Path(os.environ['WPQA_APP'])
old=json.loads((state/'containers-before.json').read_text())
names=['deploy-qa-1','deploy-proxy-1','deploy-egress-1','deploy-chromium-1','deploy-firefox-1']
now=json.loads(subprocess.check_output(['docker','inspect',*names],text=True))
(backup/'containers-verified.json').write_text(json.dumps(now))
by={c['Config']['Labels']['com.docker.compose.service']:c for c in now}
assert all(c['State']['Running'] and not c['State']['Restarting'] and c['RestartCount']==0 for c in now),'Service restart or stopped state'
for c in old:
 service=c['Config']['Labels']['com.docker.compose.service']; current=by[service]
 assert current['Config']['Labels']['com.docker.compose.project']=='deploy'
 mounts={m['Destination']:m for m in current['Mounts']}
 for m in c['Mounts']:
  actual=mounts[m['Destination']]
  assert all(actual.get(k)==m.get(k) for k in ['Type','Name','Source','Destination','RW']),'Persistent mount changed'
assert by['proxy']['HostConfig']['PortBindings']==old[1]['HostConfig']['PortBindings']
assert by['proxy']['Image']==old[1]['Image'],'Proxy image unexpectedly changed'
for n in ['qa','egress','chromium','firefox']:
 assert not by[n]['HostConfig'].get('PortBindings'),'New externally published port'
 image=json.loads(subprocess.check_output(['docker','image','inspect',by[n]['Image']],text=True))[0]
 qa_image=json.loads(subprocess.check_output(['docker','image','inspect',by['qa']['Image']],text=True))[0]
 assert image['RootFS']['Layers']==qa_image['RootFS']['Layers'],'Application filesystem mismatch'
env=dict(x.split('=',1) for x in by['qa']['Config']['Env'] if '=' in x)
assert env['WPQA_ADMINS']=='roonawa'
oldenv=dict(x.split('=',1) for x in old[0]['Config']['Env'] if '=' in x)
for key in ['WPQA_PUBLIC_ORIGIN','WPQA_DATA_DIR','WPQA_ENCRYPTION_KEY_FILE','WPQA_USERS_FILE']: assert env[key]==oldenv[key]
for n in ['deploy_backend_v2','deploy_control']:
 net=json.loads(subprocess.check_output(['docker','network','inspect',n],text=True))[0]; assert net['Internal']
assert set(by['qa']['NetworkSettings']['Networks'])=={'deploy_backend_v2','deploy_control'}
baseline=json.loads((state/'baseline-before.json').read_text()); root=pathlib.Path('/var/lib/docker/volumes/deploy_qa_data/_data')
for name,digest in baseline['files'].items(): assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,'Existing data file changed: '+name
restored=backup/'verification/application/wordpress-qa-linux'
for name in ['deploy/secrets/key','deploy/secrets/users.json','deploy/Caddyfile']: assert (app/name).read_bytes()==(restored/name).read_bytes()
old_env=(restored/'deploy/.env').read_bytes()
expected_env=old_env+(b'' if old_env.endswith(b'\n') else b'\n')+b'WPQA_ADMINS=roonawa\n'
assert (app/'deploy/.env').read_bytes()==expected_env
manifest=json.loads((app/'MANIFEST.json').read_text())
for row in manifest['files']:
 b=(app/row['path']).read_bytes(); assert len(b)==row['bytes'] and hashlib.sha256(b).hexdigest()==row['sha256'],'Program hash mismatch'
policy=json.loads(pathlib.Path('/var/lib/docker/volumes/deploy_policy_data/_data/egress.json').read_text())
summary={'version':manifest['version'],'servicesRunning':len(now),'restartCounts':[c['RestartCount'] for c in now],'sites':len(baseline['sites']),'histories':sum(len(s['runs']) for s in baseline['sites']),'existingDataFilesUnchanged':len(baseline['files']),'users':len(json.loads((app/'deploy/secrets/users.json').read_text())),'keyAndUsersIdentical':True,'originalMountsPreserved':True,'installedFilesVerified':len(manifest['files']),'isolatedNetworks':True,'newPublishedPorts':False,'allowedSiteOrigins':len(policy),'administrator':'roonawa'}
(backup/'verification-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
for k,v in summary.items(): print(str(k)+'='+str(v))

