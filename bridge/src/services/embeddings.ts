// ================================================================
// Pathfinder Embedding Service (v4.4.0)
// ================================================================
// Local-only text embeddings using @xenova/transformers (ONNX runtime).
// Model: all-MiniLM-L6-v2 — 384-dimensional vectors, ~80MB download.
//
// First call downloads the model to ~/.cache/xenova/. Subsequent calls
// load from cache (~200ms cold start, ~50ms warm per embedding).
//
// Privacy: all inference happens locally. No data leaves the machine.
// ================================================================

import { pipeline, Pipeline } from "@xenova/transformers";

/* ====== SINGLETON MODEL ====== */

let _embedder: Pipeline | null = null;
let _loading: Promise<Pipeline> | null = null;

/**
 * Get or initialize the embedding pipeline.
 * Uses lazy singleton pattern — first call loads the model, subsequent
 * calls return the cached instance instantly.
 *
 * INPUT: none
 * OUTPUT: Promise<Pipeline> — the sentence-transformer pipeline
 */
async function getEmbedder(): Promise<Pipeline> {
  if (_embedder) return _embedder;
  if (_loading) return _loading;

  _loading = (async () => {
    console.error("[Embeddings] Loading all-MiniLM-L6-v2 (first call may download ~80MB)...");
    const start = Date.now();
    const emb = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    console.error(`[Embeddings] Model ready in ${Date.now() - start}ms`);
    _embedder = emb;
    return emb;
  })();

  return _loading;
}

/* ====== PUBLIC API ====== */

/**
 * Generate an embedding vector for a single text string.
 * Uses mean pooling over token embeddings (standard for sentence-transformers).
 *
 * INPUT: text = string to embed (will be truncated to ~512 tokens internally)
 * OUTPUT: Promise<number[]> — 384-dimensional float array
 */
export async function embedText(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const result = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(result.data as Float32Array);
}

/**
 * Generate embeddings for multiple texts in a batch.
 * More efficient than calling embedText() in a loop because the model
 * can process multiple inputs in a single forward pass.
 *
 * INPUT: texts = array of strings to embed
 * OUTPUT: Promise<number[][]> — array of 384-dimensional vectors
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const embedder = await getEmbedder();

  // Process in chunks of 32 to avoid memory issues
  const CHUNK_SIZE = 32;
  const allVectors: number[][] = [];

  for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
    const chunk = texts.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map(async (text) => {
        const result = await embedder(text, { pooling: "mean", normalize: true });
        return Array.from(result.data as Float32Array);
      })
    );
    allVectors.push(...results);
  }

  return allVectors;
}

/**
 * Compute cosine similarity between two vectors.
 * Both vectors must be the same length (384 for MiniLM).
 *
 * INPUT: a, b = number arrays of equal length
 * OUTPUT: number between -1.0 and 1.0 (higher = more similar)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Get the embedding dimension (384 for all-MiniLM-L6-v2).
 */
export const EMBEDDING_DIM = 384;

/**
 * Check if the model is loaded and ready.
 */
export function isModelReady(): boolean {
  return _embedder !== null;
}

/**
 * Preload the model without generating any embeddings.
 * Call this at server startup to warm the cache.
 */
export async function preloadModel(): Promise<void> {
  await getEmbedder();
}
