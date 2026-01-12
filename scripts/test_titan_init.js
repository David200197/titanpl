#!/usr/bin/env node
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TITANPL_DIR = path.join(__dirname, "..")
const TEST_DIR = "/tmp/test-project";

console.log("🔄 Testing Titan CLI changes...\n");

// 1. npm link
console.log("→ Linking titanpl...");
execSync("npm link", { cwd: TITANPL_DIR, stdio: "inherit" });

// 2. Remove old test project
if (fs.existsSync(TEST_DIR)) {
    console.log("→ Removing old test-project...");
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
}

// 3. Create new project
console.log("→ Creating test-project...");
execSync("titan init test-project", { cwd: "/tmp", stdio: "inherit" });

// 4. Show results
console.log("\n📁 Contents of test-project:");
execSync("ls -la", { cwd: TEST_DIR, stdio: "inherit" });