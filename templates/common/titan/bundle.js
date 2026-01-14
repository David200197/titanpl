import fs from "fs";
import path from "path";
import esbuild from "esbuild";

// ============================================================
// Constants
// ============================================================
/** @constant {string} */
const BUNDLE_EXTENSION = ".jsbundle";

// ============================================================
// Path Builders
// ============================================================
/**
 * Builds the directory paths for actions source and output.
 * @param {string} root - The root directory of the project.
 * @returns {{ actionsDir: string, jsOutDir: string, rustOutDir: string }}
 */
function buildPaths(root) {
  return {
    actionsDir: path.join(root, "app", "actions"),
    jsOutDir: path.join(root, "server", "actions"),
    rustOutDir: path.join(root, "server", "src", "actions_rust"),
  };
}

// ============================================================
// File System Utilities
// ============================================================
/**
 * Removes all files from a directory.
 * @param {string} dir - The directory to clean.
 * @returns {void}
 */
function cleanDirectory(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const file of fs.readdirSync(dir)) {
    fs.unlinkSync(path.join(dir, file));
  }
}

/**
 * Ensures a directory exists, creating it if necessary.
 * @param {string} dir - The directory path.
 */
function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ============================================================
// JavaScript Bundling
// ============================================================
/**
 * Retrieves all valid JS/TS action files from the actions directory.
 * @param {string} actionsDir - The directory containing action files.
 * @returns {string[]} Array of action filenames.
 */
function getJsActionFiles(actionsDir) {
  return fs
    .readdirSync(actionsDir)
    .filter((f) => f.endsWith(".js") || f.endsWith(".ts"));
}

/**
 * Generates the footer script that exposes the action to the global scope.
 * @param {string} actionName - The name of the action to expose globally.
 * @returns {string} The footer JavaScript code.
 */
function createFooterScript(actionName) {
  return `
(function () {
  const fn =
    __titan_exports["${actionName}"] ||
    __titan_exports.default;

  if (typeof fn !== "function") {
    throw new Error("[Titan] Action '${actionName}' not found or not a function");
  }

  globalThis["${actionName}"] = function(request_arg) {
     globalThis.req = request_arg;
     return fn(request_arg);
  };
})();
`;
}

/**
 * Creates the esbuild configuration for bundling an action file.
 * @param {string} entry - The entry file path.
 * @param {string} outfile - The output bundle file path.
 * @param {string} actionName - The name of the action being bundled.
 * @returns {import('esbuild').BuildOptions}
 */
function createEsbuildConfig(entry, outfile, actionName) {
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "iife",
    globalName: "__titan_exports",
    platform: "neutral",
    target: "es2020",
    logLevel: "silent",
    loader: {
      ".ts": "ts",
      ".js": "js",
    },
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: true,
      },
    },
    banner: {
      js: "const defineAction = (fn) => fn;",
    },
    footer: {
      js: createFooterScript(actionName),
    },
  };
}

/**
 * Bundles all JavaScript/TypeScript action files.
 * @param {string} actionsDir - Source directory.
 * @param {string} outDir - Output directory.
 */
async function bundleJs(actionsDir, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  cleanDirectory(outDir);

  const files = getJsActionFiles(actionsDir);
  if (files.length === 0) {
    return;
  }

  for (const file of files) {
    const actionName = path.basename(file, path.extname(file));
    const entry = path.join(actionsDir, file);
    const outfile = path.join(outDir, actionName + BUNDLE_EXTENSION);

    const config = createEsbuildConfig(entry, outfile, actionName);
    await esbuild.build(config);
  }
}

// ============================================================
// Rust Bundling
// ============================================================
/**
 * Retrieves all Rust action files from the actions directory.
 * @param {string} actionsDir - The directory containing action files.
 * @returns {string[]} Array of .rs filenames.
 */
function getRustActionFiles(actionsDir) {
  return fs.readdirSync(actionsDir).filter((f) => f.endsWith(".rs"));
}

/**
 * Processes a single Rust action file.
 * @param {string} file - The filename.
 * @param {string} actionsDir - Source directory.
 * @param {string} rustOutDir - Output directory.
 * @returns {string} The action module name.
 */
function processRustAction(file, actionsDir, rustOutDir) {
  const actionName = path.basename(file, ".rs");
  const entry = path.join(actionsDir, file);
  const outfile = path.join(rustOutDir, file);

  let content = fs.readFileSync(entry, "utf-8");

  // Prepend implicit imports if not present
  let finalContent = content;
  if (!content.includes("use crate::extensions::t;")) {
    finalContent = "use crate::extensions::t;\n" + content;
  }

  // Basic validation - check if it has a run function
  if (!content.includes("async fn run")) {
    console.warn(
      `[Titan] Warning: ${file} does not appear to have an 'async fn run'. It might fail to compile.`
    );
  }

  fs.writeFileSync(outfile, finalContent);
  return actionName;
}

/**
 * Generates the mod.rs content for Rust actions.
 * @param {string[]} modules - Array of module names.
 * @returns {string} The mod.rs content.
 */
function generateModRs(modules) {
  let content = `// Auto-generated by Titan. Do not edit.
use axum::response::IntoResponse;
use axum::http::Request;
use axum::body::Body;
use std::future::Future;
use std::pin::Pin;

`;

  // Add mod declarations
  for (const mod of modules) {
    content += `pub mod ${mod};\n`;
  }

  content += `
pub type ActionFn = fn(Request<Body>) -> Pin<Box<dyn Future<Output = axum::response::Response> + Send>>;

pub fn get_action(name: &str) -> Option<ActionFn> {
    match name {
`;

  for (const mod of modules) {
    content += `        "${mod}" => Some(|req| Box::pin(async move { 
            ${mod}::run(req).await.into_response() 
        })),\n`;
  }

  content += `        _ => None
    }
}
`;

  return content;
}

/**
 * Bundles all Rust action files.
 * @param {string} actionsDir - Source directory.
 * @param {string} rustOutDir - Output directory.
 */
async function bundleRust(actionsDir, rustOutDir) {
  ensureDirectory(rustOutDir);
  cleanDirectory(rustOutDir);

  const files = getRustActionFiles(actionsDir);
  if (files.length === 0) {
    return;
  }

  const modules = [];

  for (const file of files) {
    const moduleName = processRustAction(file, actionsDir, rustOutDir);
    modules.push(moduleName);
  }

  // Generate mod.rs
  const modContent = generateModRs(modules);
  fs.writeFileSync(path.join(rustOutDir, "mod.rs"), modContent);
}

// ============================================================
// Main Bundle Function
// ============================================================
/**
 * Bundles all action files (JavaScript, TypeScript, and Rust) from the actions directory.
 *
 * This function performs the following steps:
 * 1. Bundles JS/TS actions into .jsbundle files
 * 2. Copies and processes Rust actions, generating mod.rs
 *
 * @param {string} [root=process.cwd()] - The root directory of the project.
 * @returns {Promise<void>}
 */
export async function bundle(root = process.cwd()) {
  const { actionsDir, jsOutDir, rustOutDir } = buildPaths(root);

  await bundleJs(actionsDir, jsOutDir);
  await bundleRust(actionsDir, rustOutDir);
}

export { bundleRust };