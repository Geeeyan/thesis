const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const publicModules = path.join(publicDir, 'node_modules');
const buildDir = path.resolve(root, process.env.FRONTEND_BUILD_DIR || 'build');
const relativeBuildDir = path.relative(root, buildDir);

if (!relativeBuildDir || relativeBuildDir === '..' || relativeBuildDir.startsWith(`..${path.sep}`) || path.isAbsolute(relativeBuildDir)) {
  throw new Error('FRONTEND_BUILD_DIR must point to a directory inside the project.');
}

const reactScripts = require.resolve('react-scripts/scripts/build.js');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'villa-frontend-build-'));
const appDir = path.join(tempDir, 'app');
const outputDir = path.join(tempDir, 'output');

try {
  fs.mkdirSync(appDir);
  fs.cpSync(path.join(root, 'src'), path.join(appDir, 'src'), { recursive: true });
  fs.cpSync(publicDir, path.join(appDir, 'public'), {
    recursive: true,
    filter: (source) => path.resolve(source) !== publicModules,
  });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(appDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

  const result = spawnSync(process.execPath, [reactScripts], {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production', BABEL_ENV: 'production', BUILD_PATH: outputDir },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Frontend build failed with exit code ${result.status}.`);
  if (!fs.existsSync(path.join(outputDir, 'index.html'))) throw new Error('Frontend build completed without index.html.');

  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.cpSync(outputDir, buildDir, { recursive: true });
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log(`Frontend build written to ${buildDir}`);
