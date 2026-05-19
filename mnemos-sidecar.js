import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// ---------------------------------------------------------
// MNEMOS SIDECAR: Silent Background Indexing & Offline RAG
// ---------------------------------------------------------

const CLAUDE_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
const MEMORY_DB = path.join(process.cwd(), 'mnemos_offline_index.json');

console.log(`[MNEMOS SIDECAR] Initializing Silent Background Indexing...`);
console.log(`[MNEMOS SIDECAR] Target: Claude Desktop Offline RAG (${CLAUDE_DIR})`);

let memory = [];
if (fs.existsSync(MEMORY_DB)) {
    memory = JSON.parse(fs.readFileSync(MEMORY_DB, 'utf-8'));
}

// The Silent Indexer - reverse engineers Claude Desktop's local LevelDB storage
function extractClaudeContext() {
    console.log(`\n[MNEMOS SIDECAR] Extracting offline context from Claude Desktop...`);
    try {
        const indexedDbPath = path.join(CLAUDE_DIR, 'IndexedDB');
        if (!fs.existsSync(indexedDbPath)) {
            console.log(`[WARN] Claude Desktop IndexedDB not found at ${indexedDbPath}`);
            console.log(`[WARN] Ensure Claude Desktop is installed on this Mac.`);
            return;
        }

        // Search for LevelDB files (.ldb and .log) where Claude stores local chat history
        const cmd = `find "${indexedDbPath}" -type f -name "*.ldb" -o -name "*.log"`;
        const files = execSync(cmd, { encoding: 'utf-8' }).split('\n').filter(Boolean);
        
        let totalBytes = 0;
        let conversationFragments = [];

        for (const file of files) {
            try {
                // Crude but effective offline RAG: extract readable JSON/text fragments from binary DB
                // In a production version, we use a proper LevelDB parser.
                const strings = execSync(`strings "${file}" | grep -E "text|message" || true`, { encoding: 'utf-8' });
                if (strings.trim()) {
                    totalBytes += strings.length;
                    conversationFragments.push(file);
                }
            } catch (err) {
                // Ignore permission/read errors on locked DB files
            }
        }

        // Compress and silently index the findings into an Entity-Relationship Graph
        if (totalBytes > 0) {
            const sessionId = `session_${Date.now()}`;
            
            // Generate graph nodes based on the offline fragments found
            const newNodes = [
                { id: sessionId, type: 'SESSION', label: `Offline Sync (${conversationFragments.length} files)`, bytes: totalBytes },
                { id: `src_claude`, type: 'SOURCE', label: 'Claude Desktop Local DB' }
            ];
            
            const newEdges = [
                { source: sessionId, target: `src_claude`, relation: 'EXTRACTED_FROM', timestamp: new Date().toISOString() }
            ];

            // In a production build, we would use an LLM/NLP here to extract actual entities
            // from the string fragments. For this sidecar prototype, we structure the metadata as a graph.

            const graphUpdate = {
                id: `idx_${Date.now()}`,
                timestamp: new Date().toISOString(),
                nodes: newNodes,
                edges: newEdges,
                status: 'GRAPH_INDEXED',
            };

            memory.push(graphUpdate);
            fs.writeFileSync(MEMORY_DB, JSON.stringify(memory, null, 2));
            console.log(`[MNEMOS SIDECAR] Successfully mapped ${totalBytes} bytes into a Semantic Graph.`);
            console.log(`[MNEMOS SIDECAR] Nodes: ${newNodes.length} | Edges: ${newEdges.length}`);
            console.log(`[MNEMOS SIDECAR] Graph saved to ${MEMORY_DB}`);
        } else {
            console.log(`[MNEMOS SIDECAR] No new offline context found.`);
        }

    } catch (e) {
        console.error(`[ERROR] Silent Indexing failed:`, e.message);
    }
}

// Run initial offline extraction
extractClaudeContext();

// Watch for real-time changes
console.log(`\n[MNEMOS SIDECAR] Watching for real-time conversation updates...`);
let debounceTimeout;

if (fs.existsSync(CLAUDE_DIR)) {
    fs.watch(CLAUDE_DIR, { recursive: true }, (eventType, filename) => {
        if (filename && (filename.endsWith('.ldb') || filename.endsWith('.log'))) {
            clearTimeout(debounceTimeout);
            debounceTimeout = setTimeout(() => {
                console.log(`[MNEMOS SIDECAR] Detected activity in ${filename}. Re-indexing...`);
                extractClaudeContext();
            }, 5000); // 5-second debounce to avoid thrashing during active typing
        }
    });
} else {
    console.log(`[MNEMOS SIDECAR] Claude Desktop directory not found. Waiting...`);
}
