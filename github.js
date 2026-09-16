const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const REPO = 'RealmsNetwork/Bot';
const BRANCH = 'main';
const REPO_URL = `https://github.com/${REPO}.git`;
const ROOT = path.resolve(__dirname);
const RUNTIME_DIR = path.join(ROOT, '.github-runtime');
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'realms-bot-update-'));
const TEMP_REPO = path.join(TEMP_ROOT, 'repo');
const ISOGIT_VERSION = '1.42.2';

function log(message) {
  console.log(`[GitHub] ${message}`);
}

function fail(message, error) {
  console.error(`[GitHub] ${message}`);
  if (error) console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
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
      if (code === 0) return resolve();
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function hasModule(moduleName) {
  try {
    require.resolve(moduleName, { paths: [RUNTIME_DIR] });
    return true;
  } catch {
    return false;
  }
}

async function ensureIsomorphicGit() {
  if (hasModule('isomorphic-git')) {
    return require(require.resolve('isomorphic-git', { paths: [RUNTIME_DIR] }));
  }

  log(`Installing isomorphic-git@${ISOGIT_VERSION}...`);
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });

  await run(npmCommand(), [
    'install',
    '--prefix',
    RUNTIME_DIR,
    '--no-save',
    '--no-package-lock',
    '--no-audit',
    '--no-fund',
    `isomorphic-git@${ISOGIT_VERSION}`
  ]);

  if (!hasModule('isomorphic-git')) {
    throw new Error('isomorphic-git installed but could not be loaded');
  }

  return require(require.resolve('isomorphic-git', { paths: [RUNTIME_DIR] }));
}

async function preserveEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return null;

  return {
    path: envPath,
    data: await fs.promises.readFile(envPath)
  };
}

async function restoreEnv(backup) {
  if (!backup) return;
  await fs.promises.writeFile(backup.path, backup.data, { mode: 0o600 });
  log('Preserved existing .env');
}

async function copyRepository(source, destination) {
  const entries = await fs.promises.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.env') continue;

    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);

    await fs.promises.cp(from, to, {
      recursive: true,
      force: true
    });
  }
}

async function cloneFresh(git, fsClient, http) {
  log(`Cloning ${REPO}@${BRANCH} with isomorphic-git...`);

  await git.clone({
    fs: fsClient,
    http,
    dir: TEMP_REPO,
    url: REPO_URL,
    ref: BRANCH,
    singleBranch: true,
    depth: 1,
    noTags: true,
    onProgress: progress => {
      if (progress?.phase === 'Receiving objects') {
        const total = Number(progress.total) || 0;
        const loaded = Number(progress.loaded) || 0;
        if (total > 0) {
          process.stdout.write(`\r[GitHub] Receiving objects ${loaded}/${total}`);
        }
      }
    }
  });

  process.stdout.write('\n');
  await copyRepository(TEMP_REPO, ROOT);
}

async function updateExisting(git, fsClient, http) {
  log(`Fetching ${REPO}@${BRANCH} with isomorphic-git...`);

  await git.fetch({
    fs: fsClient,
    http,
    dir: ROOT,
    remote: 'origin',
    ref: BRANCH,
    singleBranch: true,
    prune: true,
    tags: false
  });

  log(`Checking out origin/${BRANCH}...`);

  await git.checkout({
    fs: fsClient,
    dir: ROOT,
    remote: 'origin',
    ref: `origin/${BRANCH}`,
    noUpdateHead: true,
    force: true
  });
}

async function installBotDependencies() {
  if (!fs.existsSync(path.join(ROOT, 'package.json'))) {
    throw new Error('package.json was not found after the repository update');
  }

  log('Installing bot dependencies...');

  await run(npmCommand(), [
    'install',
    '--no-audit',
    '--no-fund'
  ]);
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
    const fsClient = fs;
    const http = require('isomorphic-git/http/node');

    if (fs.existsSync(path.join(ROOT, '.git'))) {
      await updateExisting(git, fsClient, http);
    } else {
      await cloneFresh(git, fsClient, http);
    }

    await restoreEnv(envBackup);
    await installBotDependencies();
    await startBot();
  } catch (error) {
    try {
      await restoreEnv(envBackup);
    } catch (restoreError) {
      console.error('[GitHub] Failed to restore .env:', restoreError.message);
    }

    fail('Deployment failed.', error);
  } finally {
    fs.rmSync(TEMP_ROOT, {
      recursive: true,
      force: true
    });
  }
}

main();
