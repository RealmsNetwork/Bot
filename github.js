const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const REPO = 'RealmsNetwork/Bot';
const BRANCH = 'main';
const REPO_URL = `https://github.com/${REPO}.git`;

const ROOT = process.cwd();
const RUNTIME_DIR = path.join(ROOT, '.github-runtime');
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'realmsnetwork-bot-'));
const TEMP_REPO = path.join(TEMP_ROOT, 'repo');
const ISOGIT_VERSION = '1.42.2';

function log(message) {
  console.log(`[GitHub] ${message}`);
}

function resolveModule(name) {
  try {
    return require.resolve(name, { paths: [RUNTIME_DIR] });
  } catch {
    return null;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      stdio: 'inherit',
      shell: false,
      env: process.env
    });

    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function ensureIsomorphicGit() {
  const existing = resolveModule('isomorphic-git');
  if (existing) return require(existing);

  log(`Installing isomorphic-git@${ISOGIT_VERSION}...`);
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  await run(npm, [
    'install',
    '--prefix', RUNTIME_DIR,
    '--no-save',
    '--no-package-lock',
    '--no-audit',
    '--no-fund',
    `isomorphic-git@${ISOGIT_VERSION}`
  ]);

  const installed = resolveModule('isomorphic-git');
  if (!installed) throw new Error('isomorphic-git could not be loaded after installation');

  return require(installed);
}

async function preserveEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return null;

  return {
    data: await fs.promises.readFile(envPath),
    mode: fs.statSync(envPath).mode & 0o777
  };
}

async function restoreEnv(backup) {
  if (!backup) return;

  await fs.promises.writeFile(path.join(ROOT, '.env'), backup.data, {
    mode: backup.mode || 0o600
  });

  log('Preserved existing .env');
}

async function copyRepository(source, destination) {
  const entries = await fs.promises.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.env' || entry.name === '.github-runtime') continue;

    await fs.promises.cp(
      path.join(source, entry.name),
      path.join(destination, entry.name),
      { recursive: true, force: true }
    );
  }
}

async function cloneRepository(git, http) {
  log(`Cloning ${REPO}@${BRANCH}...`);

  await git.clone({
    fs,
    http,
    dir: TEMP_REPO,
    url: REPO_URL,
    ref: BRANCH,
    singleBranch: true,
    depth: 1,
    noTags: true,
    onProgress(progress) {
      if (!progress) return;
      const loaded = Number(progress.loaded) || 0;
      const total = Number(progress.total) || 0;
      if (total > 0) {
        process.stdout.write(`\r[GitHub] ${progress.phase || 'Downloading'} ${loaded}/${total}`);
      }
    }
  });

  process.stdout.write('\n');
  await copyRepository(TEMP_REPO, ROOT);
}

async function updateRepository(git, http) {
  log(`Fetching ${REPO}@${BRANCH}...`);

  await git.fetch({
    fs,
    http,
    dir: ROOT,
    remote: 'origin',
    ref: BRANCH,
    singleBranch: true,
    prune: true,
    tags: false,
    depth: 1
  });

  const commit = await git.resolveRef({
    fs,
    dir: ROOT,
    ref: `refs/remotes/origin/${BRANCH}`
  });

  log(`Updating to ${commit.slice(0, 12)}...`);

  await git.writeRef({
    fs,
    dir: ROOT,
    ref: `refs/heads/${BRANCH}`,
    value: commit,
    force: true
  });

  await git.checkout({
    fs,
    dir: ROOT,
    ref: BRANCH,
    force: true
  });
}

async function updateOrClone(git, http) {
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    await cloneRepository(git, http);
    return;
  }

  try {
    await updateRepository(git, http);
  } catch {
    log('Existing repository could not be updated.');
    log('Falling back to a fresh clone...');
    await cloneRepository(git, http);
  }
}

async function startBot() {
  log('Starting RealmsNetwork Bot...');
  await run(process.execPath, ['.']);
}

async function main() {
  let envBackup = null;

  try {
    log(`Repository: ${REPO}`);
    log(`Branch: ${BRANCH}`);

    envBackup = await preserveEnv();

    const git = await ensureIsomorphicGit();
    const http = require(require.resolve('isomorphic-git/http/node', {
      paths: [RUNTIME_DIR]
    }));

    await updateOrClone(git, http);
    await restoreEnv(envBackup);
    await startBot();
  } catch (error) {
    try {
      await restoreEnv(envBackup);
    } catch (restoreError) {
      console.error('[GitHub] Failed to restore .env:', restoreError.message);
    }

    console.error('[GitHub] Deployment failed:', error?.stack || error?.message || error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  }
}

main();
