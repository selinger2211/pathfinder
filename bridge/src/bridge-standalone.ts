// Standalone HTTP Bridge Server
// ================================================================
// Run this directly to start ONLY the HTTP bridge (no stdio MCP).
// Useful for development: the browser can call the generation endpoints
// without needing Claude Desktop to launch the MCP server.
//
// Usage: npx tsx src/bridge-standalone.ts
// ================================================================

import { storageService } from "./services/storage.js";
import { startHttpBridge } from "./http-bridge.js";

// Initialize artifact directories
storageService.ensureDirectories();
console.error("Artifact directories initialized");

// Start the HTTP bridge
startHttpBridge();
console.error("Standalone HTTP bridge is running. Press Ctrl+C to stop.");
