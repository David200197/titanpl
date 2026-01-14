import chokidar from "chokidar";
import { spawn, execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { createRequire } from "module";

// Required for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// Colors
// ============================================================
const COLORS = {
  cyan: (t) => `\x1b[36m${t}\x1b[0m`,
  green: (t) => `\x1b[32m${t}\x1b[0m`,
  yellow: (t) => `\x1b[33m${t}\x1b[0m`,
  red: (t) => `\x1b[31m${t}\x1b[0m`,
  gray: (t) => `\x1b[90m${t}\x1b[0m`,
  bold: (t) => `\x1b[1m${t}\x1b[0m`,
};

// ============================================================
// Global Server State
// ============================================================

/** @type {import('child_process').ChildProcess | null} */
let serverProcess = null;

/** @type {boolean} */
let isKilling = false;

/** @type {boolean} */
let isFirstBoot = true;

// ============================================================
// Configuration Constants
// ============================================================

const RETRY_WAIT_TIME = 2000;
const STANDARD_WAIT_TIME = 200;
const RETRY_STANDARD_WAIT_TIME = 500;
const KILL_TIMEOUT = 3000;
const CRASH_DETECTION_WINDOW = 15000;
const MAX_RETRY_ATTEMPTS = 5;
const DEBOUNCE_DELAY = 300;
const SLOW_BUILD_THRESHOLD = 15000;

// ============================================================
// Spinner
// ============================================================

/** @type {NodeJS.Timeout | null} */
let spinnerTimer = null;

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let frameIdx = 0;

/**
 * Starts an animated spinner with the given text.
 * @param {string} text
 */
function startSpinner(text) {
  if (spinnerTimer) clearInterval(spinnerTimer);
  process.stdout.write("\x1B[?25l");
  spinnerTimer = setInterval(() => {
    process.stdout.write(
      `\r  ${COLORS.cyan(spinnerFrames[frameIdx])} ${COLORS.gray(text)}`
    );
    frameIdx = (frameIdx + 1) % spinnerFrames.length;
  }, 80);
}

/**
 * Stops the spinner and optionally displays a final message.
 * @param {boolean} [success=true]
 * @param {string} [text=""]
 */
function stopSpinner(success = true, text = "") {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  }
  process.stdout.write("\r\x1B[K");
  process.stdout.write("\x1B[?25h");
  if (text) {
    if (success) {
      console.log(`  ${COLORS.green("✔")} ${COLORS.green(text)}`);
    } else {
      console.log(`  ${COLORS.red("✖")} ${COLORS.red(text)}`);
    }
  }
}

// ============================================================
// Version Detection
// ============================================================

/**
 * Gets the Titan framework version.
 * @returns {string}
 */
function getTitanVersion() {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@ezetgalaxy/titan/package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;
  } catch (e) {
    try {
      let cur = __dirname;
      for (let i = 0; i < 5; i++) {
        const pkgPath = path.join(cur, "package.json");
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          if (pkg.name === "@ezetgalaxy/titan") return pkg.version;
        }
        cur = path.join(cur, "..");
      }
    } catch (e2) {}

    try {
      const output = execSync("tit --version", { encoding: "utf-8" }).trim();
      const match = output.match(/v(\d+\.\d+\.\d+)/);
      if (match) return match[1];
    } catch (e3) {}
  }
  return "0.1.0";
}

// ============================================================
// Application Entry Detection
// ============================================================

/**
 * @typedef {Object} AppEntry
 * @property {string} path
 * @property {boolean} isTS
 */

/**
 * Detects whether the project uses TypeScript or JavaScript as entry point.
 * @param {string} [root=process.cwd()]
 * @returns {AppEntry | null}
 */
function getAppEntry(root = process.cwd()) {
  const tsEntry = path.join(root, "app", "app.ts");
  const jsEntry = path.join(root, "app", "app.js");

  if (fs.existsSync(tsEntry)) {
    return { path: tsEntry, isTS: true };
  }

  if (fs.existsSync(jsEntry)) {
    return { path: jsEntry, isTS: false };
  }

  return null;
}

// ============================================================
// TypeScript Compilation
// ============================================================

/**
 * Creates an esbuild plugin that marks titan.js imports as external.
 * @param {string} titanJsAbsolutePath
 * @returns {import('esbuild').Plugin}
 */
function createTitanExternalPlugin(titanJsAbsolutePath) {
  return {
    name: "titan-external",
    setup(build) {
      build.onResolve({ filter: /titan\/titan\.js$/ }, () => ({
        path: titanJsAbsolutePath,
        external: true,
      }));
    },
  };
}

/**
 * Injects the titan.js import statement into compiled code if missing.
 * @param {string} compiled
 * @param {string} titanJsAbsolutePath
 * @param {string} outFile
 * @returns {string}
 */
function injectTitanImportIfMissing(compiled, titanJsAbsolutePath, outFile) {
  if (compiled.includes("titan.js")) {
    return compiled;
  }

  const lines = compiled.split("\n");
  let insertIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith("//")) {
      insertIndex = i;
      break;
    }
  }

  const importStatement = `import t from "${titanJsAbsolutePath}";`;
  lines.splice(insertIndex, 0, importStatement);
  const modifiedCode = lines.join("\n");

  fs.writeFileSync(outFile, modifiedCode);
  return modifiedCode;
}

/**
 * Compiles TypeScript entry file using esbuild.
 * @param {string} root
 * @param {string} entryPath
 * @returns {Promise<void>}
 */
async function compileTypeScript(root, entryPath) {
  const esbuild = await import("esbuild");
  const titanDir = path.join(root, ".titan");
  const outFile = path.join(titanDir, "app.compiled.mjs");

  if (fs.existsSync(titanDir)) {
    fs.rmSync(titanDir, { recursive: true, force: true });
  }
  fs.mkdirSync(titanDir, { recursive: true });

  const titanJsAbsolutePath = path
    .join(root, "titan", "titan.js")
    .replace(/\\/g, "/");

  const titanPlugin = createTitanExternalPlugin(titanJsAbsolutePath);

  await esbuild.build({
    entryPoints: [entryPath],
    outfile: outFile,
    format: "esm",
    platform: "node",
    target: "node18",
    bundle: true,
    plugins: [titanPlugin],
    loader: { ".ts": "ts" },
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: true,
      },
    },
  });

  let compiled = fs.readFileSync(outFile, "utf8");
  injectTitanImportIfMissing(compiled, titanJsAbsolutePath, outFile);

  execSync(`node "${outFile}"`, { stdio: "ignore", cwd: root });
}

// ============================================================
// Server Manager
// ============================================================

/**
 * Kills the currently running server process.
 * @returns {Promise<void>}
 */
async function killServer() {
  if (!serverProcess) return;

  isKilling = true;
  const pid = serverProcess.pid;

  const killPromise = new Promise((resolve) => {
    if (serverProcess.exitCode !== null) return resolve();
    serverProcess.once("close", resolve);
  });

  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${pid} /f /t`, { stdio: "ignore" });
    } catch (e) {}
  } else {
    serverProcess.kill();
  }

  try {
    await Promise.race([
      killPromise,
      new Promise((r) => setTimeout(r, KILL_TIMEOUT)),
    ]);
  } catch (e) {}

  serverProcess = null;
  isKilling = false;
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Starts the Rust server using cargo run.
 * @param {number} [retryCount=0]
 * @returns {Promise<void>}
 */
async function startRustServer(retryCount = 0) {
  const waitTime =
    retryCount > 0 ? RETRY_STANDARD_WAIT_TIME : STANDARD_WAIT_TIME;

  await killServer();
  await delay(waitTime);

  const serverPath = path.join(process.cwd(), "server");
  const startTime = Date.now();

  startSpinner("Stabilizing your app on its orbit...");

  let isReady = false;
  let stdoutBuffer = "";
  let buildLogs = "";

  const slowTimer = setTimeout(() => {
    if (!isReady && !isKilling) {
      startSpinner("Still stabilizing... (the first orbit takes longer)");
    }
  }, SLOW_BUILD_THRESHOLD);

  serverProcess = spawn("cargo", ["run", "--quiet"], {
    cwd: serverPath,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CARGO_INCREMENTAL: "1" },
  });

  serverProcess.on("error", (err) => {
    stopSpinner(false, "Failed to start orbit");
    console.error(COLORS.red(`[Titan] Error: ${err.message}`));
  });

  serverProcess.stderr.on("data", (data) => {
    const str = data.toString();
    if (isReady) {
      process.stderr.write(data);
    } else {
      buildLogs += str;
    }
  });

  serverProcess.stdout.on("data", (data) => {
    const out = data.toString();

    if (!isReady) {
      stdoutBuffer += out;
      if (
        stdoutBuffer.includes("Titan server running") ||
        stdoutBuffer.includes("████████╗")
      ) {
        isReady = true;
        clearTimeout(slowTimer);
        stopSpinner(true, "Your app is now orbiting Titan Planet");

        if (isFirstBoot) {
          process.stdout.write(stdoutBuffer);
          isFirstBoot = false;
        } else {
          const lines = stdoutBuffer.split("\n");
          for (const line of lines) {
            const isBanner =
              line.includes("Titan server running") ||
              line.includes("████████╗") ||
              line.includes("╚══") ||
              line.includes("   ██║") ||
              line.includes("   ╚═╝");
            if (!isBanner && line.trim()) {
              process.stdout.write(line + "\n");
            }
          }
        }
        stdoutBuffer = "";
      }
    } else {
      process.stdout.write(data);
    }
  });

  serverProcess.on("close", async (code) => {
    clearTimeout(slowTimer);
    if (isKilling) return;

    const runTime = Date.now() - startTime;

    if (code !== 0 && code !== null) {
      stopSpinner(false, "Orbit stabilization failed");

      if (!isReady) {
        console.log(COLORS.gray("\n--- Build Logs ---"));
        console.log(buildLogs);
        console.log(COLORS.gray("------------------\n"));
      }

      if (runTime < CRASH_DETECTION_WINDOW && retryCount < MAX_RETRY_ATTEMPTS) {
        await delay(RETRY_WAIT_TIME);
        await startRustServer(retryCount + 1);
      }
    }
  });
}

// ============================================================
// Build and Reload
// ============================================================

/**
 * Rebuilds the project.
 * Detects TS/JS entry and compiles accordingly.
 * @returns {Promise<void>}
 */
async function rebuild() {
  const root = process.cwd();
  const entry = getAppEntry(root);

  try {
    if (entry?.isTS) {
      await compileTypeScript(root, entry.path);
    } else {
      execSync("node app/app.js", { stdio: "ignore" });
    }
  } catch (e) {
    stopSpinner(false, "Failed to prepare runtime");
    console.log(COLORS.red(`[Titan] Error: ${e.message}`));
  }
}

// ============================================================
// Development Mode
// ============================================================

/**
 * Starts the development server with hot reload.
 * @returns {Promise<void>}
 */
async function startDev() {
  const root = process.cwd();
  const actionsDir = path.join(root, "app", "actions");
  const entry = getAppEntry(root);

  let hasRust = false;
  if (fs.existsSync(actionsDir)) {
    hasRust = fs.readdirSync(actionsDir).some((f) => f.endsWith(".rs"));
  }

  const entryType = entry?.isTS ? "TypeScript" : "JavaScript";
  const mode = hasRust ? `Rust + ${entryType} Actions` : `${entryType} Actions`;
  const version = getTitanVersion();

  console.clear();
  console.log("");
  console.log(
    `  ${COLORS.bold(COLORS.cyan("Titan Planet"))}   ${COLORS.gray("v" + version)}   ${COLORS.yellow("[ Dev Mode ]")}`
  );
  console.log("");
  console.log(`  ${COLORS.gray("Type:       ")} ${mode}`);
  console.log(`  ${COLORS.gray("Hot Reload: ")} ${COLORS.green("Enabled")}`);

  if (fs.existsSync(path.join(root, ".env"))) {
    console.log(`  ${COLORS.gray("Env:        ")} ${COLORS.yellow("Loaded")}`);
  }
  console.log("");

  try {
    await rebuild();
    await startRustServer();
  } catch (e) {
    // Initial build failed, waiting for changes
  }

  const watcher = chokidar.watch(["app", ".env"], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  let timer = null;

  watcher.on("all", async (event, file) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await killServer();
        await rebuild();
        await startRustServer();
      } catch (e) {
        // Build failed, waiting for changes
      }
    }, DEBOUNCE_DELAY);
  });
}

// ============================================================
// Exit Signal Handling
// ============================================================

async function handleExit() {
  stopSpinner();
  console.log(COLORS.gray("\n[Titan] Stopping server..."));
  await killServer();
  process.exit(0);
}

process.on("SIGINT", handleExit);
process.on("SIGTERM", handleExit);

startDev();