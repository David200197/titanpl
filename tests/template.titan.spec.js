// tests/titan.spec.js
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

// Import estático - funciona sin problemas con Proxy
import t from "../templates/titan/titan.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// Helper Functions
// ============================================================
function createTempDir(prefix = "titan-test-") {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTempDir(tempDir) {
    if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

// ============================================================
// TESTS: Route Builder - GET
// ============================================================
describe("Titan Module", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("t.get()", () => {
        it("should return route builder with reply method", () => {
            const builder = t.get("/hello");
            
            expect(builder).toHaveProperty("reply");
            expect(typeof builder.reply).toBe("function");
        });

        it("should return route builder with action method", () => {
            const builder = t.get("/api/users");
            
            expect(builder).toHaveProperty("action");
            expect(typeof builder.action).toBe("function");
        });

        it("should not throw when creating GET route with text reply", () => {
            expect(() => {
                t.get("/hello-text").reply("Hello World");
            }).not.toThrow();
        });

        it("should not throw when creating GET route with JSON reply", () => {
            expect(() => {
                t.get("/api/data-json").reply({ message: "Hello", count: 42 });
            }).not.toThrow();
        });

        it("should not throw when creating GET route with action", () => {
            expect(() => {
                t.get("/api/users-action").action("getUsers");
            }).not.toThrow();
        });

        it("should handle dynamic routes with parameters", () => {
            expect(() => {
                t.get("/api/users/:id").action("getUserById");
            }).not.toThrow();
        });

        it("should handle multiple dynamic parameters", () => {
            expect(() => {
                t.get("/api/:category/:id/details").action("getDetails");
            }).not.toThrow();
        });
    });

    // ============================================================
    // TESTS: Route Builder - POST
    // ============================================================
    describe("t.post()", () => {
        it("should return route builder with reply and action methods", () => {
            const builder = t.post("/submit");
            
            expect(builder).toHaveProperty("reply");
            expect(builder).toHaveProperty("action");
        });

        it("should not throw when creating POST route with text reply", () => {
            expect(() => {
                t.post("/submit-text").reply("Submitted");
            }).not.toThrow();
        });

        it("should not throw when creating POST route with JSON reply", () => {
            expect(() => {
                t.post("/api/create-json").reply({ success: true, id: 1 });
            }).not.toThrow();
        });

        it("should not throw when creating POST route with action", () => {
            expect(() => {
                t.post("/api/users-create").action("createUser");
            }).not.toThrow();
        });

        it("should handle dynamic POST routes", () => {
            expect(() => {
                t.post("/api/users/:id/update").action("updateUser");
            }).not.toThrow();
        });
    });

    // ============================================================
    // TESTS: Route Builder - PUT
    // ============================================================
    describe("t.put()", () => {
        it("should return route builder", () => {
            const builder = t.put("/update");
            
            expect(builder).toHaveProperty("reply");
            expect(builder).toHaveProperty("action");
        });

        it("should not throw when creating PUT route with reply", () => {
            expect(() => {
                t.put("/api/resource-put").reply({ updated: true });
            }).not.toThrow();
        });

        it("should not throw when creating PUT route with action", () => {
            expect(() => {
                t.put("/api/users/:id/replace").action("replaceUser");
            }).not.toThrow();
        });
    });

    // ============================================================
    // TESTS: Route Builder - DELETE
    // ============================================================
    describe("t.delete()", () => {
        it("should return route builder", () => {
            const builder = t.delete("/remove");
            
            expect(builder).toHaveProperty("reply");
            expect(builder).toHaveProperty("action");
        });

        it("should not throw when creating DELETE route with reply", () => {
            expect(() => {
                t.delete("/api/item-del").reply({ deleted: true });
            }).not.toThrow();
        });

        it("should not throw when creating DELETE route with action", () => {
            expect(() => {
                t.delete("/api/users/:id/del").action("deleteUser");
            }).not.toThrow();
        });
    });

    // ============================================================
    // TESTS: Route Builder - PATCH
    // ============================================================
    describe("t.patch()", () => {
        it("should return route builder", () => {
            const builder = t.patch("/partial");
            
            expect(builder).toHaveProperty("reply");
            expect(builder).toHaveProperty("action");
        });

        it("should not throw when creating PATCH route with reply", () => {
            expect(() => {
                t.patch("/api/resource-patch").reply({ patched: true });
            }).not.toThrow();
        });

        it("should not throw when creating PATCH route with action", () => {
            expect(() => {
                t.patch("/api/users/:id/patch").action("patchUser");
            }).not.toThrow();
        });
    });

    // ============================================================
    // TESTS: t.log()
    // ============================================================
    describe("t.log()", () => {
        it("should be a function", () => {
            expect(typeof t.log).toBe("function");
        });

        it("should log message with module name", () => {
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            
            t.log("TestModule", "Test message");
            
            expect(consoleSpy).toHaveBeenCalledTimes(1);
            const output = consoleSpy.mock.calls[0][0];
            expect(output).toContain("TestModule");
            expect(output).toContain("Test message");
        });

        it("should format module name with magenta color code", () => {
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            
            t.log("App", "Starting...");
            
            const output = consoleSpy.mock.calls[0][0];
            // Magenta color code
            expect(output).toContain("\x1b[35m");
            expect(output).toContain("\x1b[0m");
        });

        it("should handle empty message", () => {
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            
            expect(() => {
                t.log("Module", "");
            }).not.toThrow();
            
            expect(consoleSpy).toHaveBeenCalled();
        });

        it("should handle special characters in message", () => {
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            
            expect(() => {
                t.log("Test", "Message with émojis 🚀 and spëcial chars");
            }).not.toThrow();
            
            expect(consoleSpy).toHaveBeenCalled();
        });
    });

    // ============================================================
    // TESTS: t.start()
    // ============================================================
    describe("t.start()", () => {
        let tempDir;
        let originalCwd;

        beforeEach(() => {
            originalCwd = process.cwd();
            tempDir = createTempDir();
            process.chdir(tempDir);
            
            // Crear estructura mínima
            fs.mkdirSync(path.join(tempDir, "app", "actions"), { recursive: true });
        });

        afterEach(() => {
            process.chdir(originalCwd);
            cleanupTempDir(tempDir);
        });

        it("should be a function", () => {
            expect(typeof t.start).toBe("function");
        });

        it("should be an async function that returns a promise", () => {
            const result = t.start(3000);
            expect(result).toBeInstanceOf(Promise);
            
            // Catch the error since bundle will fail
            result.catch(() => {});
        });

        it("should log preparing runtime message", async () => {
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            vi.spyOn(console, "error").mockImplementation(() => {});
            vi.spyOn(process, "exit").mockImplementation(() => {
                throw new Error("process.exit");
            });
            
            try {
                await t.start();
            } catch (e) {
                // Expected to fail
            }
            
            const calls = consoleSpy.mock.calls.map(c => c[0]);
            const hasPreparing = calls.some(c => c && c.includes && c.includes("Preparing runtime"));
            expect(hasPreparing).toBe(true);
        });
    });

    // ============================================================
    // TESTS: Proxy - Runtime-only methods
    // ============================================================
    describe("Proxy - Runtime-only methods", () => {
        it("should throw error for undefined methods", () => {
            expect(() => {
                t.undefinedMethod();
            }).toThrow(/only available inside actions at runtime/);
        });

        it("should throw error for nested undefined methods", () => {
            expect(() => {
                t.request.body();
            }).toThrow(/only available inside actions at runtime/);
        });

        it("should include method name in error message", () => {
            expect(() => {
                t.someMethod();
            }).toThrow(/t\.someMethod\(\)/);
        });

        it("should include nested method name in error message", () => {
            expect(() => {
                t.request.params();
            }).toThrow(/t\.request\.params\(\)/);
        });

        it("should throw for request.body()", () => {
            expect(() => {
                t.request.body();
            }).toThrow();
        });

        it("should throw for request.query()", () => {
            expect(() => {
                t.request.query();
            }).toThrow();
        });

        it("should throw for response.json()", () => {
            expect(() => {
                t.response.json();
            }).toThrow();
        });

        it("should throw for db.query()", () => {
            expect(() => {
                t.db.query();
            }).toThrow();
        });

        it("should not throw for defined methods", () => {
            expect(() => t.get("/test1")).not.toThrow();
            expect(() => t.post("/test2")).not.toThrow();
            expect(() => t.put("/test3")).not.toThrow();
            expect(() => t.delete("/test4")).not.toThrow();
            expect(() => t.patch("/test5")).not.toThrow();
        });
    });

    // ============================================================
    // TESTS: Reply type detection
    // ============================================================
    describe("Reply type detection", () => {
        it("should accept string reply", () => {
            expect(() => {
                t.get("/text-reply").reply("plain text");
            }).not.toThrow();
        });

        it("should accept object reply", () => {
            expect(() => {
                t.get("/json-reply").reply({ key: "value" });
            }).not.toThrow();
        });

        it("should accept array reply", () => {
            expect(() => {
                t.get("/array-reply").reply([1, 2, 3]);
            }).not.toThrow();
        });

        it("should accept number reply", () => {
            expect(() => {
                t.get("/number-reply").reply(42);
            }).not.toThrow();
        });

        it("should accept boolean reply", () => {
            expect(() => {
                t.get("/bool-reply").reply(true);
            }).not.toThrow();
        });

        it("should accept null reply", () => {
            expect(() => {
                t.get("/null-reply").reply(null);
            }).not.toThrow();
        });

        it("should accept nested object reply", () => {
            expect(() => {
                t.get("/nested-reply").reply({
                    user: {
                        name: "John",
                        address: {
                            city: "NYC"
                        }
                    }
                });
            }).not.toThrow();
        });

        it("should accept empty string reply", () => {
            expect(() => {
                t.get("/empty-str-reply").reply("");
            }).not.toThrow();
        });

        it("should accept empty object reply", () => {
            expect(() => {
                t.get("/empty-obj-reply").reply({});
            }).not.toThrow();
        });

        it("should accept empty array reply", () => {
            expect(() => {
                t.get("/empty-arr-reply").reply([]);
            }).not.toThrow();
        });
    });

    // ============================================================
    // TESTS: Multiple routes
    // ============================================================
    describe("Multiple routes", () => {
        it("should handle multiple GET routes", () => {
            expect(() => {
                t.get("/route1-multi").reply("Route 1");
                t.get("/route2-multi").reply("Route 2");
                t.get("/route3-multi").reply("Route 3");
            }).not.toThrow();
        });

        it("should handle mixed HTTP methods", () => {
            expect(() => {
                t.get("/resource-mixed").reply("GET");
                t.post("/resource-mixed").reply("POST");
                t.put("/resource-mixed").reply("PUT");
                t.delete("/resource-mixed").reply("DELETE");
                t.patch("/resource-mixed").reply("PATCH");
            }).not.toThrow();
        });

        it("should handle same route with different methods", () => {
            expect(() => {
                t.get("/api/items-diff").action("listItems");
                t.post("/api/items-diff").action("createItem");
            }).not.toThrow();
        });

        it("should handle mix of reply and action", () => {
            expect(() => {
                t.get("/health-mix").reply("OK");
                t.get("/api/data-mix").action("getData");
                t.post("/api/data-mix").action("createData");
            }).not.toThrow();
        });
    });

    // ============================================================
    // TESTS: Edge cases
    // ============================================================
    describe("Edge cases", () => {
        it("should handle root route", () => {
            expect(() => {
                t.get("/").reply("Home");
            }).not.toThrow();
        });

        it("should handle deeply nested routes", () => {
            expect(() => {
                t.get("/api/v1/users/profile/settings-deep").action("getSettings");
            }).not.toThrow();
        });

        it("should handle routes with dots", () => {
            expect(() => {
                t.get("/api/v1.0/data-dots").reply("v1.0 data");
            }).not.toThrow();
        });

        it("should handle routes with hyphens", () => {
            expect(() => {
                t.get("/api/my-resource-hyphen").reply("resource");
            }).not.toThrow();
        });

        it("should handle routes with underscores", () => {
            expect(() => {
                t.get("/api/my_resource_underscore").reply("resource");
            }).not.toThrow();
        });
    });

    // ============================================================
    // TESTS: Global assignment
    // ============================================================
    describe("Global assignment", () => {
        it("should assign t to globalThis", () => {
            expect(globalThis.t).toBeDefined();
        });

        it("should have get method on globalThis.t", () => {
            expect(typeof globalThis.t.get).toBe("function");
        });

        it("should have post method on globalThis.t", () => {
            expect(typeof globalThis.t.post).toBe("function");
        });

        it("should have put method on globalThis.t", () => {
            expect(typeof globalThis.t.put).toBe("function");
        });

        it("should have delete method on globalThis.t", () => {
            expect(typeof globalThis.t.delete).toBe("function");
        });

        it("should have patch method on globalThis.t", () => {
            expect(typeof globalThis.t.patch).toBe("function");
        });

        it("should have start method on globalThis.t", () => {
            expect(typeof globalThis.t.start).toBe("function");
        });

        it("should have log method on globalThis.t", () => {
            expect(typeof globalThis.t.log).toBe("function");
        });
    });

    // ============================================================
    // TESTS: Default export
    // ============================================================
    describe("Default export", () => {
        it("should export t as default", () => {
            expect(t).toBeDefined();
            expect(typeof t).toBe("object");
        });

        it("should have all HTTP methods on default export", () => {
            expect(typeof t.get).toBe("function");
            expect(typeof t.post).toBe("function");
            expect(typeof t.put).toBe("function");
            expect(typeof t.delete).toBe("function");
            expect(typeof t.patch).toBe("function");
        });

        it("should have utility methods on default export", () => {
            expect(typeof t.log).toBe("function");
            expect(typeof t.start).toBe("function");
        });
    });
});