#!/usr/bin/env node

/**
 * Pathfinder Tracing Module
 * ================================================================
 * Shared OpenTelemetry tracing initialization using Arize Phoenix.
 *
 * Phoenix runs as a Docker container on the Mac (port 6006).
 * This module initializes OTEL and exports helpers for instrumenting
 * server routes, scoring engine, and resume generator.
 *
 * DESIGN: Graceful no-op. If Phoenix is unreachable, the OTEL
 * exporter silently drops spans — zero impact on app functionality.
 *
 * Usage:
 *   const { getTracer, withSpan, initTracing } = require('./tracing.cjs');
 *   initTracing();  // call once at startup
 *   const tracer = getTracer('my-module');
 *   const result = await withSpan(tracer, 'operation-name', async (span) => {
 *     span.setAttribute('key', 'value');
 *     return doWork();
 *   });
 * ================================================================
 */

const { trace, SpanStatusCode, context } = require('@opentelemetry/api');

/* ====== CONFIGURATION ====== */

const PHOENIX_ENDPOINT = process.env.PHOENIX_ENDPOINT || 'http://localhost:6006/v1/traces';
const PROJECT_NAME = process.env.PHOENIX_PROJECT || 'pathfinder';
const TRACING_ENABLED = process.env.TRACING_DISABLED !== '1';

/** Whether tracing has been initialized */
let initialized = false;

/** Whether Phoenix was detected as available */
let phoenixAvailable = false;

/* ====== INITIALIZATION ====== */

/**
 * Initialize OpenTelemetry tracing with Phoenix as the backend.
 * Safe to call multiple times — only initializes once.
 * If Phoenix is unreachable, spans are silently dropped.
 *
 * @returns {boolean} true if tracing was initialized (or already was)
 */
function initTracing() {
  if (initialized) return true;
  if (!TRACING_ENABLED) {
    console.log('[Tracing] Disabled via TRACING_DISABLED=1');
    initialized = true;
    return true;
  }

  try {
    const phoenix = require('@arizeai/phoenix-otel');

    phoenix.register({
      projectName: PROJECT_NAME,
      endpoint: PHOENIX_ENDPOINT,
      global: true,
    });

    initialized = true;
    phoenixAvailable = true;
    console.log(`[Tracing] Initialized — project="${PROJECT_NAME}", endpoint="${PHOENIX_ENDPOINT}"`);
    console.log('[Tracing] Phoenix UI: http://localhost:6006');
    return true;
  } catch (err) {
    console.warn(`[Tracing] Failed to initialize (Phoenix may not be running): ${err.message}`);
    initialized = true; // Don't retry
    phoenixAvailable = false;
    return false;
  }
}

/* ====== TRACER FACTORY ====== */

/**
 * Get a named tracer for a specific module.
 * Returns a real tracer if initialized, or a no-op tracer if not.
 *
 * @param {string} moduleName - e.g. 'server', 'score-engine', 'resume-generator'
 * @returns {import('@opentelemetry/api').Tracer}
 */
function getTracer(moduleName) {
  return trace.getTracer(`pathfinder.${moduleName}`, '1.0.0');
}

/* ====== SPAN HELPERS ====== */

/**
 * Execute a function within a new span. Automatically handles:
 * - Creating and ending the span
 * - Setting error status on exceptions
 * - Recording exception details
 *
 * @param {import('@opentelemetry/api').Tracer} tracer - The tracer to use
 * @param {string} spanName - Name for the span
 * @param {function} fn - Async function receiving (span) as argument
 * @param {object} [attributes] - Optional initial attributes to set on the span
 * @returns {Promise<*>} The return value of fn
 */
async function withSpan(tracer, spanName, fn, attributes = {}) {
  if (!initialized || !phoenixAvailable) {
    // No-op: just run the function without tracing
    return fn({ setAttribute: () => {}, setStatus: () => {}, addEvent: () => {}, recordException: () => {} });
  }

  return tracer.startActiveSpan(spanName, async (span) => {
    // Track if callback manually set an error status
    let manualError = false;
    const origSetStatus = span.setStatus.bind(span);
    span.setStatus = (status) => {
      if (status.code === SpanStatusCode.ERROR) manualError = true;
      return origSetStatus(status);
    };

    try {
      // Set initial attributes
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined && value !== null) {
          span.setAttribute(key, value);
        }
      }

      const result = await fn(span);
      // Only set OK if the callback didn't already set ERROR
      if (!manualError) {
        origSetStatus({ code: SpanStatusCode.OK });
      }
      return result;
    } catch (err) {
      origSetStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Synchronous version of withSpan for non-async functions.
 *
 * @param {import('@opentelemetry/api').Tracer} tracer - The tracer to use
 * @param {string} spanName - Name for the span
 * @param {function} fn - Sync function receiving (span) as argument
 * @param {object} [attributes] - Optional initial attributes
 * @returns {*} The return value of fn
 */
function withSpanSync(tracer, spanName, fn, attributes = {}) {
  if (!initialized || !phoenixAvailable) {
    return fn({ setAttribute: () => {}, setStatus: () => {}, addEvent: () => {}, recordException: () => {} });
  }

  const span = tracer.startSpan(spanName);
  let manualError = false;
  const origSetStatus = span.setStatus.bind(span);
  span.setStatus = (status) => {
    if (status.code === SpanStatusCode.ERROR) manualError = true;
    return origSetStatus(status);
  };

  try {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined && value !== null) {
        span.setAttribute(key, value);
      }
    }

    const result = fn(span);
    if (!manualError) {
      origSetStatus({ code: SpanStatusCode.OK });
    }
    return result;
  } catch (err) {
    origSetStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}

/**
 * Check if Phoenix is reachable (health check).
 * Useful for status display in start.sh or /api/health.
 *
 * @returns {Promise<boolean>}
 */
async function isPhoenixHealthy() {
  try {
    const http = require('http');
    return new Promise((resolve) => {
      const req = http.get('http://localhost:6006/', { timeout: 2000 }, (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 400);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  } catch {
    return false;
  }
}

/* ====== EXPORTS ====== */

module.exports = {
  initTracing,
  getTracer,
  withSpan,
  withSpanSync,
  isPhoenixHealthy,
  SpanStatusCode,
  PHOENIX_ENDPOINT,
  PROJECT_NAME,
};
