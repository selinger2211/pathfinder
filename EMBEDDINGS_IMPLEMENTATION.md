# Embeddings & Vector Store Implementation

## Overview
Successfully integrated local transformer embeddings and an in-memory vector store into `server.cjs`.

## Components Implemented

### 1. Dependencies
- **@xenova/transformers** - Transformer.js library for running ML models in Node.js
- **onnxruntime-node** - ONNX runtime for executing the embedding model
- Sharp stub - Prevents native binary errors while allowing text-only pipelines

### 2. Model
- **Model**: Xenova/all-MiniLM-L6-v2
- **Dimensions**: 384-dimensional vectors
- **Load Time**: ~2.5 seconds (lazy-loaded on first use)
- **Embedding Time**: ~6-8ms per text

### 3. Core Functions
- `getEmbedder()` - Lazy loads the embedding pipeline
- `embedText(text)` - Converts text to 384-dim vector
- `cosineSimilarity(a, b)` - Computes similarity between normalized vectors
- `vectorUpsert(id, vector, metadata)` - Stores vectors in memory
- `vectorSearch(queryVector, k, filters)` - Semantic search with optional filters

### 4. In-Memory Vector Store
- Array of vector records: `{ id, vector, text, roleId, company, title, source, indexedAt }`
- Supports filtering by source and company
- Returns results without vector field (to keep response size manageable)

## API Endpoints

### Embedding Endpoints
**POST /api/embeddings**
- Body: `{ text: string }` or `{ texts: string[] }`
- Response: `{ vector: number[], dim: 384 }` or `{ vectors: number[][], dim: 384 }`

### Vector Storage
**POST /api/vectors/upsert**
- Body: `{ id, text, roleId?, company?, title?, source? }`
- Response: Stored record metadata (without vector)

**POST /api/vectors/upsert-batch**
- Body: `{ items: [...] }` (array of upsert objects)
- Response: `{ indexed: number, skipped: number, total: number }`

### Vector Search
**POST /api/vectors/search**
- Body: `{ query: string, k?: number, filters?: { source?, company? } }`
- Response: `{ results: [...], count: number, query: string }`

### Bulk Indexing
**POST /api/vectors/index-roles**
- Reads all roles from `pf_roles` data key
- Embeds each role's JD (or title+company)
- Upserts all as vectors
- Response: `{ indexed: number, skipped: number, total: number }`

### Statistics & Management
**GET /api/vectors/stats**
- Response: `{ count: number, ready: boolean, model: string, dim: number }`

**DELETE /api/vectors/:id**
- Response: `{ deleted: boolean, id: string }`

## Health Check
Updated `/api/health` endpoint now includes:
- `services.embeddings` - Boolean indicating if model is loaded
- `services.vectorStore` - Always true (in-memory store)

## Testing
Model successfully tested:
- Loads in ~2600ms
- Generates 384-dim embeddings in ~8ms
- Sharp stub prevents native binary errors
- All endpoints ready for use

## Files Modified
- `/sessions/gallant-stoic-goodall/mnt/job-search-agents-v3/server.cjs`
  - Added embedding configuration section
  - Implemented core functions
  - Added 7 new API endpoints
  - Updated health check
  - Updated startup log

## Files Created
- `package.json` - NPM project config
- Sharp stubs in `node_modules/sharp/lib/`
- `node_modules/@xenova/transformers/` and `node_modules/onnxruntime-node/`

## Notes
- Model loads lazily on first embedding request (doesn't block server startup)
- All endpoints return 503 with clear error if model fails to load
- Vector storage is in-memory only (resets on server restart)
- Filtering is case-insensitive for company names
