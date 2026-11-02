import {spawn} from 'node:child_process';

// Keep both SSH and elevation passwords inside native askpass/process pipes.
// Neither password is written to a file, command line, or application log.
const mode = process.argv[2];
if (!['su', 'sudo'].includes(mode)) throw new Error('Expected su or sudo');
const git = 'C:/Users/roonawa/AppData/Local/Programs/Git';
const askpass = `${git}/mingw64/bin/git-askpass.exe`;
const env = {...process.env, SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ':0'};
const rootShell = 'export HISTFILE=/dev/null; exec bash --noprofile --norc -i';
const elevate = mode === 'su'
  ? `LC_ALL=C su - root -c '${rootShell}'`
  : `sudo -S -p '[WPQA_ROOT_PASSWORD] ' -i -- bash --noprofile --norc -i`;
const remote = `stty -echo; printf '\\nWPQA_ELEVATE_BEGIN\\n'; ${elevate}`;
const ssh = spawn(`${git}/usr/bin/ssh.exe`, [
  '-tt', '-o', 'StrictHostKeyChecking=yes',
  '-o', 'UserKnownHostsFile=C:/Users/roonawa/.ssh/known_hosts',
  '-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no',
  '-o', 'NumberOfPasswordPrompts=1', '-o', 'ConnectTimeout=10',
  'usshuser@WPQA-SRV', remote,
], {env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});

let outputTail = '';
let elevationStarted = false;
let passwordRequested = false;
let dialog = null;
let closed = false;
function requestElevationPassword() {
  passwordRequested = true;
  const prompt = mode === 'su'
    ? 'WPQA-SRV: enter the ROOT password for su (not the SSH user password)'
    : 'WPQA-SRV: enter the USSHUSER password for sudo';
  dialog = spawn(askpass, [prompt], {env, windowsHide: false, stdio: ['ignore', 'pipe', 'ignore']});
  const chunks = [];
  dialog.stdout.on('data', chunk => chunks.push(chunk));
  dialog.on('error', () => {
    for (const chunk of chunks) chunk.fill(0);
    process.stderr.write('\nElevation dialog could not be opened.\n');
    ssh.kill();
  });
  dialog.on('close', code => {
    const secret = Buffer.concat(chunks);
    for (const chunk of chunks) chunk.fill(0);
    let length = secret.length;
    if (length && secret[length - 1] === 10) length--;
    if (length && secret[length - 1] === 13) length--;
    if (code !== 0 || length === 0 || closed) {
      secret.fill(0);
      process.stderr.write('\nElevation cancelled; no password retained.\n');
      ssh.kill();
      return;
    }
    const line = Buffer.alloc(length + 1);
    secret.copy(line, 0, 0, length);
    line[length] = 10;
    secret.fill(0);
    ssh.stdin.write(line, () => line.fill(0));
  });
}
function relay(chunk, destination) {
  destination.write(chunk);
  outputTail = (outputTail + chunk.toString('utf8')).slice(-2048);
  if (outputTail.includes('WPQA_ELEVATE_BEGIN')) elevationStarted = true;
  if (elevationStarted && !passwordRequested && /Password:\s*$|\[WPQA_ROOT_PASSWORD\]/.test(outputTail)) {
    requestElevationPassword();
  }
}
ssh.stdout.on('data', chunk => relay(chunk, process.stdout));
ssh.stderr.on('data', chunk => relay(chunk, process.stderr));
ssh.stdin.on('error', () => {});
ssh.on('error', error => { process.stderr.write(`SSH launch failed: ${error.message}\n`); });
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', chunk => { if (!closed) ssh.stdin.write(chunk); });
ssh.on('close', code => {
  closed = true;
  if (dialog && dialog.exitCode === null) dialog.kill();
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.exitCode = code ?? 1;
});
