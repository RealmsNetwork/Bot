const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

const REPO = process.env.GITHUB_REPO || 'RealmsNetwork/Bot';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const ROOT = path.resolve(__dirname);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'realms-bot-'));

function log(message) {
  console.log(`[GitHub] ${message}`);
}

function fail(message, error) {
  console.error(`[GitHub] ${message}`);
  if (error) console.error(error.message || error);
  process.exitCode = 1;
}

function request(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));

    const request = https.get(url, {
      headers: {
        'User-Agent': 'RealmsNetwork-Bot-Launcher',
        'Accept': '*/*'
      }
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return resolve(request(response.headers.location, redirects + 1));
      }

      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`HTTP ${response.statusCode} while downloading ${url}`));
      }

      resolve(response);
    });

    request.setTimeout(30000, () => request.destroy(new Error('Request timed out')));
    request.on('error', reject);
  });
}

async function download(url, destination) {
  const response = await request(url);
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    response.pipe(output);
    output.on('finish', () => output.close(resolve));
    output.on('error', reject);
    response.on('error', reject);
  });
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    shell: false
  });
  return !result.error && result.status === 0;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      stdio: 'inherit',
      shell: false,
      env: process.env
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function updateWithGit() {
  log('Git detected, updating repository...');
  await run('git', ['fetch', 'origin', BRANCH]);

  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: ROOT,
    encoding: 'utf8'
  });

  if (status.status !== 0) throw new Error('Unable to inspect the local Git repository');

  if (status.stdout.trim()) {
    log('Local changes detected. Resetting tracked files before update.');
    await run('git', ['reset', '--hard']);
  }

  await run('git', ['checkout', BRANCH]);
  await run('git', ['reset', '--hard', `origin/${BRANCH}`]);
}

async function updateWithoutGit() {
  log('Git is unavailable, using the GitHub archive fallback...');

  const archive = path.join(TMP, 'repo.tar.gz');
  const extract = path.join(TMP, 'extract');
  fs.mkdirSync(extract, { recursive: true });

  await download(`https://codeload.github.com/${REPO}/tar.gz/refs/heads/${encodeURIComponent(BRANCH)}`, archive);
  log('Downloaded latest repository archive.');

  if (!commandExists('tar')) {
    throw new Error('Git and tar are both unavailable. This host needs at least one of them to deploy the repository.');
  }

  await run('tar', ['-xzf', archive, '-C', extract]);

  const entries = fs.readdirSync(extract);
  const source = entries.find(entry => entry.startsWith(`${REPO.split('/')[1]}-`));
  if (!source) throw new Error('Could not locate the extracted repository directory.');

  const sourceRoot = path.join(extract, source);
  const items = fs.readdirSync(sourceRoot);

  for (const item of items) {
    const sourcePath = path.join(sourceRoot, item);
    const destinationPath = path.join(ROOT, item);

    await fs.promises.cp(sourcePath, destinationPath, {
      recursive: true,
      force: true
    });
  }
}

async function startBot() {
  log('Starting bot with `node .`...');
  await run(process.execPath, ['.']);
}

async function main() {
  try {
    log(`Repository: ${REPO}`);
    log(`Branch: ${BRANCH}`);

    if (fs.existsSync(path.join(ROOT, '.git')) && commandExists('git')) {
      await updateWithGit();
    } else {
      await updateWithoutGit();
    }

    await startBot();
  } catch (error) {
    fail('Deployment failed.', error);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
}

main();
