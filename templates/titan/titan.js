import fs from "fs";
import path from "path";
import { bundle } from "./bundle.js";

// ============================================================
// Constants
// ============================================================
const COLORS = {
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  magenta: (text) => `\x1b[35m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
};

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

// ============================================================
// State
// ============================================================
const routes = {};
const dynamicRoutes = {};
const actionMap = {};

// ============================================================
// Route Builder
// ============================================================
/**
 * Creates a route builder for the given HTTP method and route pattern
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} route - Route pattern (e.g., "/api/users/:id")
 * @returns {TitanRouteBuilder}
 */
function createRouteBuilder(method, route) {
  const key = `${method.toUpperCase()}:${route}`;
  const isDynamicRoute = route.includes(":");

  return {
    reply(value) {
      routes[key] = {
        type: typeof value === "object" ? "json" : "text",
        value,
      };
    },

    action(name) {
      if (isDynamicRoute) {
        dynamicRoutes[method] ??= [];
        dynamicRoutes[method].push({
          method: method.toUpperCase(),
          pattern: route,
          action: name,
        });
      } else {
        routes[key] = {
          type: "action",
          value: name,
        };
        actionMap[key] = name;
      }
    },
  };
}

// ============================================================
// Server Initialization
// ============================================================
/**
 * Writes server metadata files (routes.json and action_map.json)
 * @param {number} port - Server port
 */
function writeServerMetadata(port) {
  const serverDir = path.join(process.cwd(), "server");

  if (!fs.existsSync(serverDir)) {
    fs.mkdirSync(serverDir, { recursive: true });
  }

  const routesData = {
    __config: { port },
    routes,
    __dynamic_routes: Object.values(dynamicRoutes).flat(),
  };

  fs.writeFileSync(
    path.join(serverDir, "routes.json"),
    JSON.stringify(routesData, null, 2)
  );

  fs.writeFileSync(
    path.join(serverDir, "action_map.json"),
    JSON.stringify(actionMap, null, 2)
  );
}

// ============================================================
// Build-time Methods
// ============================================================
const buildTimeMethods = {
  get: (route) => createRouteBuilder("GET", route),
  post: (route) => createRouteBuilder("POST", route),
  put: (route) => createRouteBuilder("PUT", route),
  delete: (route) => createRouteBuilder("DELETE", route),
  patch: (route) => createRouteBuilder("PATCH", route),

  log(module, msg) {
    console.log(`[${COLORS.magenta(module)}] ${msg}`);
  },

  async start(port = 3000, msg = "") {
    try {
      console.log(COLORS.cyan("[Titan] Preparing runtime..."));
      await bundle();

      writeServerMetadata(port);

      console.log(COLORS.green("✔ Titan metadata written successfully"));

      if (msg) {
        console.log(COLORS.cyan(msg));
      }
    } catch (error) {
      console.error(`${COLORS.red(`[Titan] Build Error: ${error.message}`)}`);
      process.exit(1);
    }
  },
};

// ============================================================
// Runtime Proxy
// ============================================================
/**
 * Creates an error for runtime-only method access
 * @param {string} methodPath - Full method path (e.g., "request.body")
 * @returns {Error}
 */
function createRuntimeOnlyError(methodPath) {
  return new Error(
    `[Titan] t.${methodPath}() is only available inside actions at runtime.`
  );
}

/**
 * Creates a proxy that throws runtime-only errors for nested property access
 * @param {string | symbol} parentProp - Parent property name
 */
function createNestedProxy(parentProp) {
  return new Proxy(
    () => {
      throw createRuntimeOnlyError(String(parentProp));
    },
    {
      get(_, nestedProp) {
        return () => {
          throw createRuntimeOnlyError(`${String(parentProp)}.${String(nestedProp)}`);
        };
      },
    }
  );
}

const t = /** @type {TitanRuntime} */ (
  new Proxy(buildTimeMethods, {
    get(target, prop) {
      if (prop in target) {
        return target[prop];
      }
      return createNestedProxy(prop);
    },
  })
);

// ============================================================
// Exports
// ============================================================
// @ts-ignore - t is assigned to globalThis for runtime
globalThis.t = t;

export default t;