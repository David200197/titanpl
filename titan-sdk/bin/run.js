#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper for colors
const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;

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

function run() {
    console.log(cyan("Titan SDK: Test Runner"));

    // 1. Validate we are in an extension directory
    const cwd = process.cwd();
    const manifestPath = path.join(cwd, "titan.json");
    if (!fs.existsSync(manifestPath)) {
        console.log(red("Error: titan.json not found. Run this command inside your extension folder."));
        process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const name = manifest.name;
    console.log(green(`Extension: ${name}`));

    // 2. Build Native Logic (if properly set up)
    const nativeDir = path.join(cwd, "native");
    if (fs.existsSync(nativeDir) && fs.existsSync(path.join(nativeDir, "Cargo.toml"))) {
        console.log(cyan("Building native Rust module..."));
        try {
            execSync("cargo build --release", { cwd: nativeDir, stdio: "inherit" });
        } catch (e) {
            console.log(red("Failed to build native module."));
            process.exit(1);
        }
    }

    // 3. Create a Test Harness (Mini Titan Project)
    const runDir = path.join(cwd, ".titan_test_run");
    if (fs.existsSync(runDir)) {
        try {
            fs.rmSync(runDir, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 100
            });
        } catch (e) {
            console.log(yellow(`Warning: Could not fully clean ${runDir}. Proceeding anyway...`));
        }
    }

    // Ensure runDir exists (sometimes rmSync + mkdirSync fails on Windows due to locks)
    if (!fs.existsSync(runDir)) {
        fs.mkdirSync(runDir, { recursive: true });
    }

    // Create app structure
    const appDir = path.join(runDir, "app");
    fs.mkdirSync(appDir);

    // Create actions folder (required by Titan build)
    const actionsDir = path.join(appDir, "actions");
    fs.mkdirSync(actionsDir);

    // Copy titan/ and server/ from templates
    const templatesDir = path.join(__dirname, "..", "templates");

    const titanSrc = path.join(templatesDir, "titan");
    const titanDest = path.join(runDir, "titan");
    if (fs.existsSync(titanSrc)) {
        console.log(cyan("→ Setting up Titan runtime..."));
        copyDir(titanSrc, titanDest);
        // Double check titan.js exists
        if (!fs.existsSync(path.join(titanDest, "titan.js"))) {
            console.log(red(`Error: Failed to copy titan.js to ${titanDest}`));
            process.exit(1);
        }
    } else {
        console.log(red(`Error: Titan templates not found at ${titanSrc}`));
        process.exit(1);
    }

    const serverSrc = path.join(templatesDir, "server");
    const serverDest = path.join(runDir, "server");
    if (fs.existsSync(serverSrc)) {
        console.log(cyan("→ Setting up Titan server..."));
        copyDir(serverSrc, serverDest);
    } else {
        console.log(red(`Error: Server templates not found at ${serverSrc}`));
        process.exit(1);
    }

    // Create package.json for the test harness
    const pkgJson = {
        "type": "module"
    };
    fs.writeFileSync(path.join(runDir, "package.json"), JSON.stringify(pkgJson, null, 2));

    // Create 'node_modules' to link the extension
    const nmDir = path.join(runDir, "node_modules");
    fs.mkdirSync(nmDir);

    // Link current extension to node_modules/NAME
    // Use junction for Windows compat without admin rights
    const extDest = path.join(nmDir, name);
    try {
        fs.symlinkSync(cwd, extDest, "junction");
    } catch (e) {
        // Fallback to copy if link fails
        console.log(yellow("Linking failed, copying extension files..."));
        copyDir(cwd, extDest);
    }

    // Create a test action in app/actions/test.js
    const testAction = `export const test = (req) => {
    const ext = t["${name}"];
    
    const results = {
        extension: "${name}",
        loaded: !!ext,
        methods: ext ? Object.keys(ext) : [],
        timestamp: new Date().toISOString()
    };
    
    if (ext && ext.hello) {
        try {
            results.hello_test = ext.hello("World");
        } catch(e) {
            results.hello_error = String(e);
        }
    }
    
    if (ext && ext.calc) {
        try {
            results.calc_test = ext.calc(15, 25);
        } catch(e) {
            results.calc_error = String(e);
        }
    }
    
    return results;
};
`;

    fs.writeFileSync(path.join(actionsDir, "test.js"), testAction);

    // Create a simple test script in app/app.js
    // This script will be executed by Titan
    const testScript = `import t from "../titan/titan.js";
import "${name}";

// Extension test harness for: ${name}
const ext = t["${name}"];

console.log("---------------------------------------------------");
console.log("Testing Extension: ${name}");
console.log("---------------------------------------------------");

if (!ext) {
    console.log("ERROR: Extension '${name}' not found in global 't'.");
} else {
    console.log("✓ Extension loaded successfully!");
    console.log("✓ Available methods:", Object.keys(ext).join(", "));
    
    // Try 'hello' if it exists
    if (typeof ext.hello === 'function') {
        console.log("\\nTesting ext.hello('Titan')...");
        try {
           const res = ext.hello("Titan");
           console.log("✓ Result:", res);
        } catch(e) {
           console.log("✗ Error:", e.message);
        }
    }

    // Try 'calc' if it exists
    if (typeof ext.calc === 'function') {
        console.log("\\nTesting ext.calc(10, 20)...");
        try {
            const res = ext.calc(10, 20);
            console.log("✓ Result:", res);
        } catch(e) {
            console.log("✗ Error:", e.message);
        }
    }
}

console.log("---------------------------------------------------");
console.log("✓ Test complete!");
console.log("\\n📍 Routes:");
console.log("  GET  http://localhost:3000/      → Test harness info");
console.log("  GET  http://localhost:3000/test  → Extension test results (JSON)");
console.log("---------------------------------------------------\\n");

// Create routes
t.get("/test").action("test");
t.get("/").reply("🚀 Extension Test Harness for ${name}\\n\\nVisit /test to see extension test results");

await t.start(3000, "Titan Extension Test Running!");
`;

    fs.writeFileSync(path.join(appDir, "app.js"), testScript);

    // Build the app (bundle actions)
    console.log(cyan("Building test app..."));
    try {
        // Ensure we are in runDir and the file exists
        const appJsPath = path.join(runDir, "app", "app.js");
        if (!fs.existsSync(appJsPath)) {
            throw new Error(`app/app.js missing at ${appJsPath}`);
        }

        execSync("node app/app.js --build", {
            cwd: runDir,
            stdio: "inherit",
            env: { ...process.env, NODE_OPTIONS: "--no-warnings" }
        });
    } catch (e) {
        console.log(red("Failed to build test app. This is expected if your extension has errors."));
        // Don't exit here, attempt to continue to show runtime errors if possible
    }

    // 4. Run Titan Server using cargo run (like dev mode)
    console.log(green("\x1b[1m\n>>> STARTING EXTENSION TEST >>>\n\x1b[0m"));

    const serverDir = path.join(runDir, "server");

    try {
        execSync("cargo run", { cwd: serverDir, stdio: "inherit" });
    } catch (e) {
        console.log(red("Runtime exited."));
    }
}

run();
