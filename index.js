#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";

/* Resolve __dirname for ES modules */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* Colors */
const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;

const args = process.argv.slice(2);
const cmd = args[0];

/* Titan version (read from package.json) */
const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "package.json"), "utf8")
);
const TITAN_VERSION = pkg.version;

/* Safe copy directory */
function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });

    for (const file of fs.readdirSync(src)) {
        const srcPath = path.join(src, file);
        const destPath = path.join(dest, file);

        if (fs.lstatSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/* HELP */
function help() {
    console.log(`
${bold(cyan("Titan CLI"))}  v${TITAN_VERSION}

${green("tit init <project>")}   Create new Titan project
${green("tit dev")}              Dev mode (hot reload)
${green("tit build")}            Build production Rust server
${green("tit start")}            Start production binary
${green("tit update")}           Update Titan engine
${green("tit --version")}        Show Titan CLI version
`);
}

/* INIT PROJECT */
function initProject(name) {
    if (!name) return console.log(red("Usage: tit init <project>"));

    const target = path.join(process.cwd(), name);
    const templateDir = path.join(__dirname, "templates");

    if (fs.existsSync(target)) {
        console.log(yellow(`Folder already exists: ${target}`));
        return;
    }

    console.log(cyan(`Creating Titan project → ${target}`));

    copyDir(templateDir, target);

    [".gitignore", ".dockerignore", "Dockerfile"].forEach((file) => {
        const src = path.join(templateDir, file);
        const dest = path.join(target, file);
        if (fs.existsSync(src)) fs.copyFileSync(src, dest);
    });

    console.log(green("✔ Titan project created!"));
    console.log(cyan("Installing dependencies..."));

    execSync(`npm install esbuild --silent`, {
        cwd: target,
        stdio: "inherit",
    });

    console.log(green("✔ Dependencies installed"));
    console.log(`
Next steps:
  cd ${name}
  tit dev
`);
}

/* BUNDLER (absolute path, Railway-safe) */
function runBundler(root) {
    const bundler = path.join(root, "titan", "bundle.js");

    if (!fs.existsSync(bundler)) {
        console.log(red("ERROR: titan/bundle.js missing."));
        process.exit(1);
    }

    execSync(`node "${bundler}"`, { stdio: "inherit" });
}

/* DEV SERVER — HOT RELOAD */
async function devServer() {
    const root = process.cwd();
    console.log(cyan("Titan Dev Mode — Hot Reload Enabled"));

    let rustProcess = null;

    function launchRust(done) {
        const processHandle = spawn("cargo", ["run"], {
            cwd: path.join(root, "server"),
            stdio: "inherit",
            shell: true,
        });

        processHandle.on("spawn", () => setTimeout(done, 200));
        processHandle.on("close", (code) =>
            console.log(`[Titan] Rust server exited: ${code}`)
        );

        return processHandle;
    }

    function startRust() {
        return new Promise((resolve) => {
            if (rustProcess) {
                console.log("[Titan] Restarting Rust server...");

                if (process.platform === "win32") {
                    const killer = spawn("taskkill", ["/PID", rustProcess.pid, "/T", "/F"], {
                        stdio: "ignore",
                        shell: true,
                    });

                    killer.on("exit", () => {
                        rustProcess = launchRust(resolve);
                    });
                } else {
                    rustProcess.kill();
                    rustProcess.on("close", () => {
                        rustProcess = launchRust(resolve);
                    });
                }
            } else {
                rustProcess = launchRust(resolve);
            }
        });
    }

    /* Build logic */
    function rebuild() {
        execSync(`node "${path.join(root, "app", "app.js")}"`, {
            stdio: "inherit",
        });

        runBundler(root);
    }

    rebuild();
    startRust();

    const chokidar = (await import("chokidar")).default;
    const watcher = chokidar.watch("app", { ignoreInitial: true });

    let timer = null;

    watcher.on("all", (event, file) => {
        if (timer) clearTimeout(timer);

        timer = setTimeout(() => {
            console.log(yellow(`Change → ${file}`));
            rebuild();
            startRust();
        }, 250);
    });
}

/* PRODUCTION BUILD */
function buildProd() {
    const root = process.cwd();
    const appJs = path.join(root, "app", "app.js");

    console.log(cyan("Titan: Building production output..."));

    if (!fs.existsSync(appJs)) {
        console.log(red("ERROR: app/app.js missing."));
        process.exit(1);
    }

    /* Generate routes */
    execSync(`node "${appJs}"`, { stdio: "inherit" });

    /* Bundle actions */
    runBundler(root);

    /* Copy bundles → server/actions */
    const outDir = path.join(root, "server", "actions");
    fs.mkdirSync(outDir, { recursive: true });

    const builtActions = path.join(root, "titan", "actions");

    if (fs.existsSync(builtActions)) {
        for (const file of fs.readdirSync(builtActions)) {
            if (file.endsWith(".jsbundle")) {
                fs.copyFileSync(
                    path.join(builtActions, file),
                    path.join(outDir, file)
                );
            }
        }
    }

    console.log(green("✔ Actions copied to server/actions"));

    /* Rust release build */
    execSync(`cargo build --release`, {
        cwd: path.join(root, "server"),
        stdio: "inherit",
    });

    console.log(green("✔ Rust binary built successfully."));
}

/* START PRODUCTION BINARY */
function startProd() {
    const isWin = process.platform === "win32";
    const bin = isWin ? "titan-server.exe" : "titan-server";

    const exe = path.join(process.cwd(), "server", "target", "release", bin);
    execSync(`"${exe}"`, { stdio: "inherit" });
}

/* UPDATE TITAN */
function updateTitan() {
    const root = process.cwd();
    const projectTitan = path.join(root, "titan");

    const cliTemplatesRoot = path.join(__dirname, "templates");
    const cliTitan = path.join(cliTemplatesRoot, "titan");

    if (!fs.existsSync(projectTitan)) {
        console.log(red("Not a Titan project (titan/ missing)."));
        return;
    }

    fs.rmSync(projectTitan, { recursive: true, force: true });
    copyDir(cliTitan, projectTitan);

    console.log(green("✔ Titan runtime updated"));
}

/* ROUTER */
switch (cmd) {
    case "init":
        initProject(args[1]);
        break;

    case "dev":
        devServer();
        break;

    case "build":
        buildProd();
        break;

    case "start":
        startProd();
        break;

    case "update":
        updateTitan();
        break;

    case "--version":
    case "-v":
    case "version":
        console.log(green(`Titan v${TITAN_VERSION}`));
        break;

    default:
        help();
}
