
// Titan Core Runtime JS
// This is embedded in the binary for ultra-fast startup.

globalThis.global = globalThis;

// defineAction identity helper
globalThis.defineAction = (fn) => fn;

// TextDecoder Polyfill using native t.decodeUtf8
globalThis.TextDecoder = class TextDecoder {
    decode(buffer) {
        return t.decodeUtf8(buffer);
    }
};

// Process environment variables
globalThis.process = {
    env: t.loadEnv()
};

// Everything is strictly synchronous and request-driven.
