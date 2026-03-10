import os from 'os';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);

/**
 * Resolves the engine binary path. Returns null if not found (non-fatal).
 * Used by the dev command to pre-resolve and inject the path via env.
 */
export function resolveEngineBinaryPath() {
  const platform = os.platform();
  const arch = os.arch();
  const pkgName = `@titanpl/engine-${platform}-${arch}`;
  const binName = platform === 'win32' ? 'titan-server.exe' : 'titan-server';
  const shortPkgName = pkgName.split('/').pop();

  // 1. Monorepo search (local dev)
  const searchPaths = [
    __dirname,
    process.cwd(),
    path.join(process.cwd(), '..'),
    path.join(process.cwd(), '..', '..')
  ];

  for (let startPath of searchPaths) {
    let current = startPath;
    for (let i = 0; i < 8; i++) {
      // Check built binary (engine/target/release/...)
      const builtBin = path.join(current, 'engine', 'target', 'release', binName);
      if (fs.existsSync(builtBin)) return builtBin;

      // Check package binary (packages/engine-*/bin/...)
      const pkgBin = path.join(current, 'packages', shortPkgName, 'bin', binName);
      if (fs.existsSync(pkgBin)) return pkgBin;

      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  // 2. Resolve from CLI's own context (correct require context for optionalDependencies)
  try {
    const pkgPath = require.resolve(`${pkgName}/package.json`);
    const binaryPath = path.join(path.dirname(pkgPath), 'bin', binName);
    if (fs.existsSync(binaryPath)) return binaryPath;
  } catch (e) { }

  // 3. Fallback: sibling in node_modules (global install layout)
  // We need to handle scoped packages correctly. 
  // If we are at .../node_modules/@titanpl/cli/src
  // Up 1: .../node_modules/@titanpl/cli
  // Up 2: .../node_modules/@titanpl
  // Up 3: .../node_modules (This is where the engine package should be)
  let current = __dirname;
  for (let i = 0; i < 5; i++) {
    const potentialNm = path.join(current, 'node_modules');
    if (fs.existsSync(potentialNm)) {
      const siblingBin = path.join(potentialNm, pkgName, 'bin', binName);
      if (fs.existsSync(siblingBin)) return siblingBin;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // 4. Walk upwards from current dir searching for binary in root or .ext/node_modules
  let searchDir = process.cwd();
  for (let i = 0; i < 5; i++) {
    // Check root (Directly in build/ folder)
    const rootBin = path.join(searchDir, binName);
    if (fs.existsSync(rootBin)) return rootBin;

    // Check node_modules
    const nmBin = path.join(searchDir, 'node_modules', pkgName, 'bin', binName);
    if (fs.existsSync(nmBin)) return nmBin;

    // Check .ext (Release mode layout)
    const extBin = path.join(searchDir, '.ext', pkgName, 'bin', binName);
    if (fs.existsSync(extBin)) return extBin;

    const parent = path.dirname(searchDir);
    if (parent === searchDir) break;
    searchDir = parent;
  }

  // 5. Check global npm
  try {
    const globalModules = execSync('npm root -g').toString().trim();
    const globalBin = path.join(globalModules, pkgName, 'bin', binName);
    if (fs.existsSync(globalBin)) return globalBin;
  } catch (e) { }

  return null;
}

/**
 * Resolves the engine binary path. Exits with a fatal error if not found.
 * Used by the start command.
 */
export function getEngineBinaryPath() {
  const platform = os.platform();
  const arch = os.arch();
  const pkgName = `@titanpl/engine-${platform}-${arch}`;

  const resolved = resolveEngineBinaryPath();
  if (resolved) return resolved;

  console.error(`\n[TITAN FATAL] Unsupported platform: ${platform} (${arch})`);
  console.error(`Or the optional dependency '${pkgName}' failed to install.`);
  console.error(`Try: npm install -g @titanpl/cli\n`);
  process.exit(1);
}

export function startEngine(watchMode = false) {
  const distPath = path.resolve(process.cwd(), 'dist');

  if (!fs.existsSync(distPath)) {
    console.error("❌ 'dist/' directory not found. Please run 'titan build' first.");
    process.exit(1);
  }

  const binaryPath = getEngineBinaryPath();

  // Arguments passed to Rust backend
  const args = ['run', distPath];
  if (watchMode) args.push('--watch');

  console.log(`🚀 Starting Titan Engine...`);

  const engineProcess = spawn(binaryPath, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TITAN_ENV: watchMode ? 'development' : 'production',
      TITAN_DEV: watchMode ? '1' : '0',
      NODE_ENV: watchMode ? 'development' : 'production'
    }
  });

  let stderrBuffer = "";

  engineProcess.stdout.pipe(process.stdout);
  engineProcess.stderr.on('data', (data) => {
    const chunk = data.toString();
    stderrBuffer += chunk;
    process.stderr.write(data);
  });

  engineProcess.on('close', (code) => {
    if (code !== 0 && code !== null) {
      // Check for port binding errors
      const isPortError = stderrBuffer.includes("Address already in use") ||
        stderrBuffer.includes("address in use") ||
        stderrBuffer.includes("os error 10048") || // Windows
        stderrBuffer.includes("EADDRINUSE") ||
        stderrBuffer.includes("AddrInUse");

      if (isPortError) {
        // Try to read intended port
        let port = 5100;
        try {
          const routesPath = path.join(process.cwd(), "dist", "routes.json");
          if (fs.existsSync(routesPath)) {
            const routesConfig = JSON.parse(fs.readFileSync(routesPath, "utf8"));
            if (routesConfig && routesConfig.__config && routesConfig.__config.port) {
              port = routesConfig.__config.port;
            }
          }
        } catch (e) { }

        const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
        const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
        const red = (t) => `\x1b[31m${t}\x1b[0m`;

        console.log("");
        console.log(red("⏣  Your application cannot enter this orbit"));
        console.log(red(`↳  Another application is already bound to port ${port}.`));
        console.log("");

        console.log(yellow("Recommended Actions:"));
        console.log(yellow("  1.") + " Release the occupied orbit (stop the other service).");
        console.log(yellow("  2.") + " Assign your application to a new orbit in " + cyan("app/app.js"));
        console.log(yellow("     Example: ") + cyan(`t.start(${port + 1}, "Titan Running!")`));
        console.log("");
      } else {
        console.error(`\n❌ [Titan Engine died with exit code ${code}]`);
      }
    }
  });

  return engineProcess;
}
