import chokidar from "chokidar";
import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";
import { bundle } from "./bundle.js";

// ============================================================
// Global Server State
// ============================================================

/** @type {import('child_process').ChildProcess | null} */
let serverProcess = null;

/** @type {boolean} */
let isKilling = false;

// ============================================================
// Configuration Constants
// ============================================================

/** Time to wait before retrying after a crash (ms) */
const RETRY_WAIT_TIME = 2000;

/** Standard wait time before starting server (ms) */
const STANDARD_WAIT_TIME = 1000;

/** Maximum time to wait for process to be killed (ms) */
const KILL_TIMEOUT = 3000;

/** Time window to detect rapid crashes (ms) */
const CRASH_DETECTION_WINDOW = 10000;

/** Maximum number of automatic retry attempts */
const MAX_RETRY_ATTEMPTS = 3;

/** Debounce delay for file watcher (ms) */
const DEBOUNCE_DELAY = 500;

// ============================================================
// Application Entry Detection
// ============================================================

/**
 * Entry point information for the application.
 * @typedef {Object} AppEntry
 * @property {string} path - Absolute path to the entry file
 * @property {boolean} isTS - Whether the entry file is TypeScript
 */

/**
 * Detects whether the project uses TypeScript or JavaScript as its entry point.
 * Checks for `app/app.ts` first, then falls back to `app/app.js`.
 *
 * @param {string} [root=process.cwd()] - Project root directory
 * @returns {AppEntry | null} Entry point information, or null if no entry file found
 *
 * @example
 * const entry = getAppEntry('/path/to/project');
 * if (entry?.isTS) {
 *   console.log('TypeScript project detected');
 * }
 */
export function getAppEntry(root = process.cwd()) {
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
// TypeScript/JavaScript Compilation
// ============================================================

/**
 * Creates an esbuild plugin that marks titan.js imports as external.
 * This prevents esbuild from bundling the titan.js file, allowing it
 * to be resolved at runtime.
 *
 * @param {string} titanJsAbsolutePath - Absolute path to titan.js
 * @returns {import('esbuild').Plugin} esbuild plugin configuration
 *
 * @example
 * const plugin = createTitanExternalPlugin('/project/titan/titan.js');
 * await esbuild.build({ plugins: [plugin] });
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
 * Generates the esbuild configuration for TypeScript compilation.
 *
 * @param {string} entryPath - Path to the entry file
 * @param {string} outFile - Path for the compiled output file
 * @param {import('esbuild').Plugin} titanPlugin - Titan external plugin instance
 * @returns {import('esbuild').BuildOptions} esbuild build configuration
 */
function getEsbuildConfig(entryPath, outFile, titanPlugin) {
    return {
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
    };
}

/**
 * Finds the index of the first non-comment, non-empty line in the code.
 * Used to determine where to inject import statements.
 *
 * @param {string[]} lines - Array of code lines
 * @returns {number} Index of the first code line (0 if none found)
 */
function findFirstCodeLineIndex(lines) {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith("//")) {
            return i;
        }
    }
    return 0;
}

/**
 * Injects the titan.js import statement into compiled code if missing.
 * This enables the global `t` variable usage pattern without explicit imports.
 *
 * @param {string} compiled - Compiled JavaScript code
 * @param {string} titanJsAbsolutePath - Absolute path to titan.js
 * @param {string} outFile - Output file path (will be overwritten if modified)
 * @returns {string} Modified code with titan.js import, or original if already present
 *
 * @example
 * // If compiled code uses `t.post()` but has no import:
 * const modified = injectTitanImportIfMissing(code, '/project/titan/titan.js', outPath);
 * // Result: import t from "/project/titan/titan.js"; prepended
 */
function injectTitanImportIfMissing(compiled, titanJsAbsolutePath, outFile) {
    if (compiled.includes("titan.js")) {
        return compiled;
    }

    console.log("[Titan] Auto-injecting titan.js import (global t usage detected)...");

    const lines = compiled.split("\n");
    const insertIndex = findFirstCodeLineIndex(lines);
    const importStatement = `import t from "${titanJsAbsolutePath}";`;

    lines.splice(insertIndex, 0, importStatement);
    const modifiedCode = lines.join("\n");

    fs.writeFileSync(outFile, modifiedCode);

    return modifiedCode;
}

/**
 * Logs a preview of the first 5 lines of compiled output for debugging.
 *
 * @param {string} compiled - Compiled JavaScript code
 */
function logCompiledPreview(compiled) {
    console.log("[Titan] Compiled output preview:");
    const lines = compiled.split("\n").slice(0, 5);
    lines.forEach((line, i) => console.log(`  ${i + 1}: ${line}`));
}

/**
 * Verifies that the compiled output contains the required import statement.
 * Logs a warning if the import appears to be missing.
 *
 * @param {string} compiled - Compiled JavaScript code
 */
function verifyImportExists(compiled) {
    if (!compiled.includes("import") || !compiled.includes("titan.js")) {
        console.error("[Titan] WARNING: Import statement may be missing from compiled output!");
        console.error("[Titan] First 200 chars:", compiled.substring(0, 200));
    }
}

/**
 * Compilation result containing output file path and compiled code.
 * @typedef {Object} CompilationResult
 * @property {string} outFile - Path to the compiled output file
 * @property {string} compiled - The compiled JavaScript code
 */

/**
 * Compiles a TypeScript entry file using esbuild.
 * Handles directory setup, compilation, import injection, and optional execution.
 *
 * @param {string} root - Project root directory
 * @param {string} entryPath - Path to the TypeScript entry file
 * @param {boolean} skipExec - If true, skip executing the compiled output
 * @returns {Promise<CompilationResult>} Compilation result with output path and code
 * @throws {Error} If esbuild compilation fails
 *
 * @example
 * const result = await compileTypeScript('/project', '/project/app/app.ts', false);
 * console.log('Compiled to:', result.outFile);
 */
async function compileTypeScript(root, entryPath, skipExec) {
    console.log("[Titan] Compiling app.ts with esbuild...");

    const esbuild = await import("esbuild");
    const titanDir = path.join(root, ".titan");
    const outFile = path.join(titanDir, "app.compiled.mjs");

    // Clean and recreate .titan directory to avoid cache issues
    if (fs.existsSync(titanDir)) {
        fs.rmSync(titanDir, { recursive: true, force: true });
    }
    fs.mkdirSync(titanDir, { recursive: true });

    // Calculate the absolute path to titan.js
    const titanJsAbsolutePath = path.join(root, "titan", "titan.js").replace(/\\/g, "/");

    // Compile TS to JS
    const titanPlugin = createTitanExternalPlugin(titanJsAbsolutePath);
    const buildConfig = getEsbuildConfig(entryPath, outFile, titanPlugin);
    await esbuild.build(buildConfig);

    // Read and process compiled output
    let compiled = fs.readFileSync(outFile, "utf8");
    compiled = injectTitanImportIfMissing(compiled, titanJsAbsolutePath, outFile);

    // Debug output
    logCompiledPreview(compiled);
    verifyImportExists(compiled);

    // Execute if not skipped
    if (!skipExec) {
        execSync(`node "${outFile}"`, { stdio: "inherit", cwd: root });
    }

    return { outFile, compiled };
}

/**
 * Bundles a JavaScript entry file using esbuild.
 * Processes the file through esbuild to resolve imports and inject titan.js dependency.
 *
 * @param {string} root - Project root directory
 * @param {string} entryPath - Path to the JavaScript entry file
 * @param {boolean} skipExec - If true, skip executing the bundled output
 * @returns {Promise<CompilationResult>} Compilation result with output path and code
 * @throws {Error} If esbuild bundling fails
 *
 * @example
 * const result = await processJavaScript('/project', '/project/app/app.js', false);
 * console.log('Bundled to:', result.outFile);
 */
async function processJavaScript(root, entryPath, skipExec) {
    console.log("[Titan] Bundling app.js with esbuild...");

    const esbuild = await import("esbuild");
    const titanDir = path.join(root, ".titan");
    const outFile = path.join(titanDir, "app.compiled.mjs");

    // Clean and recreate .titan directory to avoid cache issues
    if (fs.existsSync(titanDir)) {
        fs.rmSync(titanDir, { recursive: true, force: true });
    }
    fs.mkdirSync(titanDir, { recursive: true });

    // Calculate the absolute path to titan.js
    const titanJsAbsolutePath = path.join(root, "titan", "titan.js").replace(/\\/g, "/");

    // Bundle JS with esbuild
    const titanPlugin = createTitanExternalPlugin(titanJsAbsolutePath);

    await esbuild.build({
        entryPoints: [entryPath],
        outfile: outFile,
        format: "esm",
        platform: "node",
        target: "node18",
        bundle: true,
        plugins: [titanPlugin],
    });

    // Read and process compiled output
    let compiled = fs.readFileSync(outFile, "utf8");
    compiled = injectTitanImportIfMissing(compiled, titanJsAbsolutePath, outFile);

    // Debug output
    logCompiledPreview(compiled);
    verifyImportExists(compiled);

    // Execute if not skipped
    if (!skipExec) {
        execSync(`node "${outFile}"`, { stdio: "inherit", cwd: root });
    }

    return { outFile, compiled };
}

/**
 * Options for compiling and running the application entry point.
 * @typedef {Object} CompileOptions
 * @property {boolean} [skipExec=false] - Skip execution after compilation
 */

/**
 * Compiles and optionally executes the application entry point.
 * Automatically detects whether the project uses TypeScript or JavaScript
 * and processes accordingly using esbuild.
 *
 * @param {string} [root=process.cwd()] - Project root directory
 * @param {CompileOptions} [options] - Compilation options
 * @returns {Promise<CompilationResult>} Compilation result with output path and code
 * @throws {Error} If no app.ts or app.js found in the app/ directory
 *
 * @example
 * // Compile and execute
 * await compileAndRunAppEntry('/project');
 *
 * @example
 * // Compile only, skip execution
 * const result = await compileAndRunAppEntry('/project', { skipExec: true });
 */
export async function compileAndRunAppEntry(root = process.cwd(), options = { skipExec: false }) {
    const { skipExec = false } = options;
    const entry = getAppEntry(root);

    if (!entry) {
        throw new Error("[Titan] No app.ts or app.js found in app/");
    }

    if (entry.isTS) {
        return compileTypeScript(root, entry.path, skipExec);
    }

    return processJavaScript(root, entry.path, skipExec);
}

// ============================================================
// Server Manager
// ============================================================

/**
 * Forcefully terminates a process on Windows using taskkill.
 * Silently ignores errors if the process is already dead.
 *
 * @param {number} pid - Process ID to kill
 */
function killWindowsProcess(pid) {
    try {
        execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore' });
    } catch (e) {
        // Ignore errors if process is already dead
    }
}

/**
 * Terminates a process on Unix systems using SIGKILL.
 * Attempts to kill the entire process group first, then falls back to direct kill.
 *
 * @param {number} pid - Process ID to kill
 * @param {import('child_process').ChildProcess} serverProc - Server process object
 */
function killUnixProcess(pid, serverProc) {
    try {
        process.kill(-pid, 'SIGKILL');
    } catch (e) {
        // Fallback to regular kill
        try {
            serverProc.kill('SIGKILL');
        } catch (e2) { }
    }
}

/**
 * Waits for a process to close with a timeout.
 * Resolves when either the process closes or the timeout is reached.
 *
 * @param {Promise<void>} killPromise - Promise that resolves when process closes
 * @returns {Promise<void>}
 */
async function waitForProcessClose(killPromise) {
    try {
        await Promise.race([
            killPromise,
            new Promise(r => setTimeout(r, KILL_TIMEOUT))
        ]);
    } catch (e) { }
}

/**
 * Kills the currently running server process.
 * Handles both Windows and Unix systems appropriately.
 * Sets the `isKilling` flag to prevent restart loops during intentional shutdown.
 *
 * @returns {Promise<void>} Resolves when the server is killed or timeout is reached
 *
 * @example
 * await killServer();
 * console.log('Server stopped');
 */
export async function killServer() {
    if (!serverProcess) {
        return;
    }

    isKilling = true;
    const pid = serverProcess.pid;

    const killPromise = new Promise((resolve) => {
        if (serverProcess.exitCode !== null) {
            return resolve();
        }
        serverProcess.once("close", resolve);
    });

    if (process.platform === "win32") {
        killWindowsProcess(pid);
    } else {
        killUnixProcess(pid, serverProcess);
    }

    await waitForProcessClose(killPromise);

    serverProcess = null;
    isKilling = false;
}

/**
 * Handles the server process close event.
 * Implements automatic restart logic for crash detection within the time window.
 *
 * @param {number | null} code - Process exit code (null if terminated by signal)
 * @param {number} startTime - Timestamp when the server was started
 * @param {number} retryCount - Current retry attempt count
 * @param {string} root - Project root directory
 * @returns {Promise<void>}
 */
async function handleServerClose(code, startTime, retryCount, root) {
    if (isKilling) {
        return;
    }

    console.log(`[Titan] Rust server exited: ${code}`);

    const runTime = Date.now() - startTime;
    const shouldRetry = code !== 0 &&
        code !== null &&
        runTime < CRASH_DETECTION_WINDOW &&
        retryCount < MAX_RETRY_ATTEMPTS;

    if (shouldRetry) {
        console.log(`\x1b[31m[Titan] Server crash detected (possibly file lock). Retrying automatically...\x1b[0m`);
        await startRustServer(retryCount + 1, root);
    }
}

/**
 * Generates spawn options for the cargo process.
 *
 * @param {string} serverPath - Path to the server directory containing Cargo.toml
 * @returns {import('child_process').SpawnOptions} Spawn options for cargo
 */
function getCargoSpawnOptions(serverPath) {
    return {
        cwd: serverPath,
        stdio: "inherit",
        shell: true,
        detached: true,
        env: { ...process.env, CARGO_INCREMENTAL: "0" }
    };
}

/**
 * Starts the Rust server using cargo run.
 * Automatically kills any existing server instance before starting.
 * Implements retry logic for handling file lock issues on Windows.
 *
 * @param {number} [retryCount=0] - Current retry attempt (used internally for crash recovery)
 * @param {string} [root=process.cwd()] - Project root directory
 * @returns {Promise<import('child_process').ChildProcess>} The spawned server process
 *
 * @example
 * const server = await startRustServer();
 *
 * @example
 * // Manual retry after failure
 * const server = await startRustServer(1, '/project');
 */
export async function startRustServer(retryCount = 0, root = process.cwd()) {
    const waitTime = retryCount > 0 ? RETRY_WAIT_TIME : STANDARD_WAIT_TIME;

    // Ensure any previous instance is killed
    await killServer();

    // Give the OS a moment to release file locks on the binary
    await new Promise(r => setTimeout(r, waitTime));

    const serverPath = path.join(root, "server");
    const startTime = Date.now();

    if (retryCount > 0) {
        console.log(`\x1b[33m[Titan] Retrying Rust server (Attempt ${retryCount})...\x1b[0m`);
    }

    // Windows often has file locking issues during concurrent linking/metadata generation
    const spawnOptions = getCargoSpawnOptions(serverPath);
    serverProcess = spawn("cargo", ["run", "--jobs", "1"], spawnOptions);

    serverProcess.on("close", (code) => handleServerClose(code, startTime, retryCount, root));

    return serverProcess;
}

// ============================================================
// Build and Reload
// ============================================================

/**
 * Rebuilds the entire project.
 * Regenerates routes.json and action_map.json by compiling and executing the app entry,
 * then bundles all JavaScript actions.
 *
 * @param {string} [root=process.cwd()] - Project root directory
 * @returns {Promise<void>}
 * @throws {Error} If compilation or bundling fails
 *
 * @example
 * await rebuild('/project');
 * console.log('Project rebuilt successfully');
 */
export async function rebuild(root = process.cwd()) {
    console.log("[Titan] Regenerating routes.json & action_map.json...");
    await compileAndRunAppEntry(root);

    console.log("[Titan] Bundling JS actions...");
    await bundle(root);
}

// ============================================================
// Development Mode
// ============================================================

/**
 * Logs the detected project type (TypeScript or JavaScript).
 *
 * @param {AppEntry | null} entry - Application entry point information
 */
function logProjectDetection(entry) {
    if (entry) {
        const projectType = entry.isTS ? "TypeScript" : "JavaScript";
        console.log(`[Titan] Detected ${projectType} project`);
    }
}

/**
 * Logs the environment configuration status if .env file exists.
 *
 * @param {string} root - Project root directory
 */
function logEnvStatus(root) {
    if (fs.existsSync(path.join(root, ".env"))) {
        console.log("\x1b[33m[Titan] Env Configured\x1b[0m");
    }
}

/**
 * Performs the initial project build and starts the server.
 * Gracefully handles build failures and waits for file changes.
 *
 * @param {string} root - Project root directory
 * @returns {Promise<void>}
 */
async function performInitialBuild(root) {
    try {
        await rebuild(root);
        await startRustServer(0, root);
    } catch (e) {
        console.log("\x1b[31m[Titan] Initial build failed. Waiting for changes...\x1b[0m");
        console.error(e.message);
    }
}

/**
 * Handles file change events from the watcher.
 * Rebuilds the project and restarts the server on each change.
 *
 * @param {string} file - Path to the changed file
 * @param {string} root - Project root directory
 * @returns {Promise<void>}
 */
async function handleFileChange(file, root) {
    if (file.includes(".env")) {
        console.log("\x1b[33m[Titan] Env Refreshed\x1b[0m");
    } else {
        console.log(`[Titan] Change detected: ${file}`);
    }

    try {
        await rebuild(root);
        console.log("[Titan] Restarting Rust server...");
        await startRustServer(0, root);
    } catch (e) {
        console.log("\x1b[31m[Titan] Build failed -- waiting for changes...\x1b[0m");
        console.error(e.message);
    }
}

/**
 * Creates a file watcher with debounced change handling.
 * Watches the `app/` directory and `.env` file for changes.
 *
 * @param {string} root - Project root directory
 * @returns {import('chokidar').FSWatcher} Chokidar watcher instance
 */
function createFileWatcher(root) {
    const watcher = chokidar.watch(["app", ".env"], {
        ignoreInitial: true,
    });

    /** @type {NodeJS.Timeout | null} */
    let timer = null;

    watcher.on("all", async (event, file) => {
        if (timer) {
            clearTimeout(timer);
        }

        timer = setTimeout(() => handleFileChange(file, root), DEBOUNCE_DELAY);
    });

    return watcher;
}

/**
 * Starts the development server with hot reload capability.
 * Performs initial build, starts the Rust server, and watches for file changes.
 *
 * @returns {Promise<import('chokidar').FSWatcher>} The file watcher instance
 *
 * @example
 * const watcher = await startDev();
 * // Development server is now running with hot reload
 *
 * // To stop watching:
 * await watcher.close();
 */
export async function startDev() {
    console.log("[Titan] Dev mode starting...");

    const root = process.cwd();
    const entry = getAppEntry(root);

    logProjectDetection(entry);
    logEnvStatus(root);

    await performInitialBuild(root);

    return createFileWatcher(root);
}

// ============================================================
// Exit Signal Handling
// ============================================================

/**
 * Handles graceful shutdown on SIGINT (Ctrl+C) or SIGTERM signals.
 * Ensures the server process is properly terminated before exiting.
 *
 * @returns {Promise<never>} Never returns; exits the process
 */
async function handleExit() {
    console.log("\n[Titan] Stopping server...");
    await killServer();
    process.exit(0);
}

process.on("SIGINT", handleExit);
process.on("SIGTERM", handleExit);

// ============================================================
// Auto-start in Development Mode
// ============================================================

const isMainModule = process.argv[1]?.endsWith('dev.js');
if (isMainModule && !process.env.VITEST) {
    startDev();
}

// ============================================================
// Exports for Testing
// ============================================================

export { serverProcess, isKilling };