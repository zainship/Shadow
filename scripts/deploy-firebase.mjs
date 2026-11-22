#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function run(command, args, opts = {}) {
  const printable = [command, ...args].join(' ');
  console.log(`\n> ${printable}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readFirebaseConfig() {
  const configPath = path.join(rootDir, 'firebase-applet-config.json');
  if (!fs.existsSync(configPath)) {
    console.error('Error: firebase-applet-config.json not found in project root.');
    process.exit(1);
  }
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!parsed.projectId) {
    console.error('Error: projectId missing in firebase-applet-config.json.');
    process.exit(1);
  }
  return parsed;
}

function hasGlobalFirebaseCli() {
  const probe = spawnSync('firebase', ['--version'], {
    cwd: rootDir,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return probe.status === 0;
}

const args = new Set(process.argv.slice(2));
const skipLint = args.has('--skip-lint');
const withRules = args.has('--with-rules');
const dryRun = args.has('--dry-run');

const firebaseConfig = readFirebaseConfig();
const projectId = firebaseConfig.projectId;
const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';

console.log(`Shadow Firebase Hosting Deploy Workflow`);
console.log(`  Project ID : ${projectId}`);
console.log(`  Database ID: ${databaseId}`);

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!skipLint) {
  run(npmCmd, ['run', 'lint']);
}

run(npmCmd, ['run', 'build']);

const distIndex = path.join(rootDir, 'dist', 'index.html');
if (!fs.existsSync(distIndex)) {
  console.error('Error: Build did not produce dist/index.html.');
  process.exit(1);
}

if (dryRun) {
  console.log('\nDry run complete: dist/ built cleanly and ready for Firebase Hosting.');
  process.exit(0);
}

const onlyTargets = withRules ? 'hosting,firestore:rules' : 'hosting';
const deployArgs = ['deploy', '--only', onlyTargets, '--project', projectId];

if (process.env.FIREBASE_TOKEN) {
  deployArgs.push('--token', process.env.FIREBASE_TOKEN);
}

if (hasGlobalFirebaseCli()) {
  run('firebase', deployArgs);
} else {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  run(npxCmd, ['--yes', 'firebase-tools', ...deployArgs]);
}

console.log(`\nDeployed static bundle to https://${projectId}.web.app`);
