import { useState, useRef, useEffect, useMemo } from "react";

const CATEGORIES = ["FACT", "PREFERENCE", "DECISION", "TASK", "QUESTION", "CONTEXT"];
const CAT_COLORS = {
  FACT: "#00ff9d", PREFERENCE: "#00b8ff", DECISION: "#ffb800",
  TASK: "#ff6b6b", QUESTION: "#c084fc", CONTEXT: "#94a3b8",
};

const FEATURES = [
  { id: "contradiction", label: "Contradiction Pre-flight", desc: "Warns before sending if your message conflicts with existing memory" },
  { id: "pinRows", label: "Pin Rows", desc: "★ Pinned rows always inject first in system prompt as hard constraints" },
  { id: "confidence", label: "STATED vs INFERRED", desc: "AI-inferred rows render differently from things you explicitly stated" },
  { id: "commands", label: "Inline /commands", desc: "/remember  /forget  /pin  /check — direct memory control in chat" },
  { id: "staleness", label: "Staleness Decay", desc: "Rows untouched for 15+ messages visually fade out" },
  { id: "history", label: "History Trail", desc: "Hover a row to see all previous values before it was updated" },
  { id: "tokenMeter", label: "Token Pressure Meter", desc: "Live bar showing how much context window your memory consumes" },
  { id: "activeGlow", label: "Active Context Glow", desc: "As you type, matching memory rows light up to show what Claude sees" },
];

function genId() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function estimateTokens(str) { return Math.ceil(str.length / 4); }

function buildSystemPrompt(rows, features) {
  const active = rows.filter(r => !r.outdated);
  if (active.length === 0) return "You are a helpful assistant. Memory table is empty.";
  const pinned = features.pinRows ? active.filter(r => r.pinned) : [];
  const rest = features.pinRows ? active.filter(r => !r.pinned) : active;
  const fmt = r => {
    let prefix = "";
    if (features.pinRows && r.pinned) prefix += "PINNED:";
    if (features.confidence && r.confidence === "INFERRED") prefix += "~";
    return `[${prefix}${r.category}] ${r.key}: ${r.value}`;
  };
  const table = [...pinned, ...rest].map(fmt).join("\n");
  const notes = [
    features.pinRows ? "- PINNED rows are hard constraints, always relevant." : "",
    features.confidence ? "- Rows marked ~ are inferred by AI; flag if user contradicts them." : "",
  ].filter(Boolean).join("\n");
  return `You are a helpful assistant with a persistent memory table.

MEMORY:
${table}
${notes ? "\nNOTES:\n" + notes : ""}

RULES:
1. Check memory before answering. If input conflicts with memory, prefix reply with "⚠ CONFLICT:".
2. Extract new info and end response with:

<MEMORY_UPDATE>
[ACTION: ADD|UPDATE|OUTDATED] [CATEGORY] [CONFIDENCE: STATED|INFERRED] [key] | [value]
</MEMORY_UPDATE>

Keep values under 80 chars. Don't expose mechanics unless asked.`;
}

function parseMemoryUpdate(text) {
  const match = text.match(/<MEMORY_UPDATE>([\s\S]*?)<\/MEMORY_UPDATE>/);
  if (!match) return [];
  return match[1].trim().split("\n").map(line => {
    const m = line.match(/\[ACTION:\s*(ADD|UPDATE|OUTDATED)\]\s*\[(\w+)\]\s*\[CONFIDENCE:\s*(STATED|INFERRED)\]\s*(.+?)\s*\|\s*(.+)/);
    if (!m) return null;
    return { action: m[1], category: m[2], confidence: m[3], key: m[4].trim(), value: m[5].trim() };
  }).filter(Boolean);
}

function stripMemoryBlock(text) {
  return text.replace(/<MEMORY_UPDATE>[\s\S]*?<\/MEMORY_UPDATE>/, "").trim();
}

function scanConflicts(input, memory) {
  const lower = input.toLowerCase();
  const negations = ["not ", "no ", "never ", "don't ", "doesn't ", "isn't ", "aren't ", "won't ", "cannot ", "cant "];
  return memory.filter(r => !r.outdated).filter(r => {
    const key = r.key.toLowerCase();
    return negations.some(neg => lower.includes(neg + key) || lower.includes(neg + "a " + key));
  });
}

function matchingRows(input, memory) {
  if (!input.trim()) return [];
  const words = input.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  return memory.filter(r => !r.outdated).filter(r =>
    words.some(w => `${r.key} ${r.value}`.toLowerCase().includes(w))
  );
}

function parseCommand(input) {
  const t = input.trim();
  if (t === "/check") return { cmd: "check" };
  const rem = t.match(/^\/remember\s+(.+?):\s*(.+)$/i);
  if (rem) return { cmd: "remember", key: rem[1].trim(), value: rem[2].trim() };
  const forget = t.match(/^\/forget\s+(.+)$/i);
  if (forget) return { cmd: "forget", key: forget[1].trim() };
  const pin = t.match(/^\/pin\s+(.+)$/i);
  if (pin) return { cmd: "pin", key: pin[1].trim() };
  return null;
}

function getStaleOpacity(row, totalMessages, enabled) {
  if (!enabled) return 1;
  const age = totalMessages - (row.msg || 0);
  return Math.max(0.28, 1 - age / 25);
}

export default function App() {
  const [memory, setMemory] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const [editRow, setEditRow] = useState(null);
  const [newRow, setNewRow] = useState({ key: "", value: "", category: "FACT", confidence: "STATED" });
  const [showAdd, setShowAdd] = useState(false);
  const [importText, setImportText] = useState("");
  const [flash, setFlash] = useState(null);
  const [flashKey, setFlashKey] = useState(0);
  const [conflicts, setConflicts] = useState([]);
  const [hoveredHistoryId, setHoveredHistoryId] = useState(null);
  const [features, setFeatures] = useState(
    Object.fromEntries(FEATURES.map(f => [f.id, true]))
  );
  const chatBottom = useRef(null);

  useEffect(() => { chatBottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const activeMemory = useMemo(() => memory.filter(r => !r.outdated), [memory]);
  const outdatedMemory = useMemo(() => memory.filter(r => r.outdated), [memory]);
  const activeMatches = useMemo(() =>
    features.activeGlow ? matchingRows(input, memory) : [], [input, memory, features.activeGlow]);
  const systemPrompt = useMemo(() => buildSystemPrompt(memory, features), [memory, features]);
  const tokenCount = useMemo(() => estimateTokens(systemPrompt), [systemPrompt]);
  const tokenPct = Math.min(100, (tokenCount / 2000) * 100);
  const enabledCount = Object.values(features).filter(Boolean).length;

  function triggerFlash(msg) {
    setFlash(msg);
    setFlashKey(k => k + 1);
    setTimeout(() => setFlash(null), 2500);
  }

  function handleInputChange(val) {
    setInput(val);
    setConflicts(features.contradiction && val.length > 8 ? scanConflicts(val, memory) : []);
  }

  function toggleFeature(id) {
    setFeatures(f => ({ ...f, [id]: !f[id] }));
  }

  function applyMemoryUpdates(updates, msgNum) {
    setMemory(prev => {
      let next = [...prev];
      updates.forEach(({ action, category, confidence, key, value }) => {
        if (action === "ADD") {
          next.push({ id: genId(), category, key, value, confidence: confidence || "INFERRED", pinned: false, outdated: false, msg: msgNum, history: [] });
        } else if (action === "UPDATE") {
          const idx = next.findIndex(r => r.key.toLowerCase() === key.toLowerCase());
          if (idx >= 0) {
            const old = next[idx];
            next[idx] = { ...old, value, category, confidence: confidence || old.confidence, outdated: false, msg: msgNum, history: [...(old.history || []), { value: old.value, msg: old.msg }] };
          } else {
            next.push({ id: genId(), category, key, value, confidence: confidence || "INFERRED", pinned: false, outdated: false, msg: msgNum, history: [] });
          }
        } else if (action === "OUTDATED") {
          const idx = next.findIndex(r => r.key.toLowerCase() === key.toLowerCase());
          if (idx >= 0) next[idx] = { ...next[idx], outdated: true };
        }
      });
      return next;
    });
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;

    if (features.commands) {
      const cmd = parseCommand(input);
      if (cmd) {
        const userContent = input.trim();
        setInput("");
        if (cmd.cmd === "check") {
          const summary = activeMemory.length === 0 ? "Memory is empty."
            : activeMemory.map(r => `[${r.category}] ${r.key}: ${r.value}`).join("\n");
          setMessages(m => [...m,
            { role: "user", content: userContent },
            { role: "assistant", content: `MEMORY SNAPSHOT (${activeMemory.length} rows):\n\n${summary}`, updates: [] }
          ]);
          return;
        }
        if (cmd.cmd === "remember") {
          setMemory(p => [...p, { id: genId(), category: "FACT", key: cmd.key, value: cmd.value, confidence: "STATED", pinned: false, outdated: false, msg: messages.length, history: [] }]);
          setMessages(m => [...m,
            { role: "user", content: userContent },
            { role: "assistant", content: `✓ Remembered: [FACT] ${cmd.key} → ${cmd.value}`, updates: [] }
          ]);
          triggerFlash("Row added");
          return;
        }
        if (cmd.cmd === "forget") {
          const idx = memory.findIndex(r => r.key.toLowerCase() === cmd.key.toLowerCase());
          setMessages(m => [...m,
            { role: "user", content: userContent },
            { role: "assistant", content: idx >= 0 ? `✓ Outdated: ${cmd.key}` : `⚠ Not found: "${cmd.key}"`, updates: [] }
          ]);
          if (idx >= 0) { setMemory(p => p.map((r, i) => i === idx ? { ...r, outdated: true } : r)); triggerFlash("Row outdated"); }
          return;
        }
        if (cmd.cmd === "pin") {
          const idx = memory.findIndex(r => r.key.toLowerCase() === cmd.key.toLowerCase());
          if (idx >= 0) {
            const wasPin = memory[idx].pinned;
            setMemory(p => p.map((r, i) => i === idx ? { ...r, pinned: !r.pinned } : r));
            setMessages(m => [...m,
              { role: "user", content: userContent },
              { role: "assistant", content: `${wasPin ? "Unpinned" : "★ Pinned"}: ${cmd.key}`, updates: [] }
            ]);
            triggerFlash(wasPin ? "Unpinned" : "★ Pinned");
          }
          return;
        }
      }
    }

    const userMsg = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setConflicts([]);
    setLoading(true);

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: systemPrompt,
          messages: newMessages,
        }),
      });
      const data = await res.json();
      const rawText = data.content?.find(b => b.type === "text")?.text || "[No response]";
      const updates = parseMemoryUpdate(rawText);
      const cleanText = stripMemoryBlock(rawText);
      if (updates.length > 0) {
        applyMemoryUpdates(updates, newMessages.length + 1);
        triggerFlash(`⟳ ${updates.length} update${updates.length > 1 ? "s" : ""}`);
      }
      setMessages([...newMessages, { role: "assistant", content: cleanText, updates }]);
    } catch (e) {
      setMessages([...newMessages, { role: "assistant", content: "⚠ API error: " + e.message }]);
    }
    setLoading(false);
  }

  function exportMemory() { navigator.clipboard.writeText(JSON.stringify(memory, null, 2)); triggerFlash("JSON copied"); }
  function exportPrompt() { navigator.clipboard.writeText(systemPrompt); triggerFlash("Prompt copied"); }
  function importMemory() {
    try {
      const parsed = JSON.parse(importText);
      if (Array.isArray(parsed)) { setMemory(parsed); setImportText(""); triggerFlash(`Imported ${parsed.length} rows`); }
    } catch { triggerFlash("Invalid JSON"); }
  }
  function deleteRow(id) { setMemory(p => p.filter(r => r.id !== id)); }
  function togglePin(id) { setMemory(p => p.map(r => r.id === id ? { ...r, pinned: !r.pinned } : r)); }
  function saveEdit() { setMemory(p => p.map(r => r.id === editRow.id ? editRow : r)); setEditRow(null); }
  function addRow() {
    if (!newRow.key.trim()) return;
    setMemory(p => [...p, { ...newRow, id: genId(), pinned: false, outdated: false, msg: messages.length, history: [] }]);
    setNewRow({ key: "", value: "", category: "FACT", confidence: "STATED" });
    setShowAdd(false);
    triggerFlash("Row added");
  }

  return (
    <div style={S.root}>
      <style>{CSS}</style>

      {/* HEADER */}
      <div style={S.header}>
        <div style={S.logo}>
          <span style={S.logoIcon}>◈</span>
          <span style={S.logoText}>MNEMO</span>
          <span style={S.logoBadge}>{activeMemory.length} ACTIVE</span>
        </div>
        {flash && <div key={flashKey} style={S.flash}>{flash}</div>}
        <div style={S.tabs}>
          {[
            { id: "chat", label: "CHAT" },
            { id: "table", label: "TABLE" },
            { id: "settings", label: `⚙ ${enabledCount}/8` },
            { id: "export", label: "EXPORT" },
          ].map(t => (
            <button key={t.id} style={{ ...S.tab, ...(activeTab === t.id ? S.tabActive : {}) }} onClick={() => setActiveTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* TOKEN PRESSURE BAR */}
      {features.tokenMeter && (
        <div style={S.tokenBarWrap}>
          <div style={S.tokenBg}>
            <div style={{ ...S.tokenFill, width: `${tokenPct}%`, background: tokenPct > 75 ? "#ff6b6b" : tokenPct > 45 ? "#ffb800" : "#00ff9d" }} />
          </div>
          <span style={S.tokenLabel}>~{tokenCount} tokens · {tokenPct.toFixed(0)}% of budget</span>
        </div>
      )}

      {/* ── CHAT ── */}
      {activeTab === "chat" && (
        <div style={S.chatPane}>
          {features.activeGlow && activeMatches.length > 0 && (
            <div style={S.contextStrip}>
              <span style={S.ctxLabel}>ACTIVE CONTEXT:</span>
              {activeMatches.slice(0, 5).map(r => (
                <span key={r.id} style={{ ...S.ctxTag, borderColor: CAT_COLORS[r.category] + "77", color: CAT_COLORS[r.category] }}>{r.key}</span>
              ))}
            </div>
          )}
          {features.contradiction && conflicts.length > 0 && (
            <div style={S.conflictBar}>⚠ POSSIBLE CONFLICT with: {conflicts.map(c => `"${c.key}"`).join(", ")}</div>
          )}
          <div style={S.chatMessages}>
            {messages.length === 0 && (
              <div style={S.empty}>
                <div style={S.emptyIcon}>◈</div>
                <p style={S.emptyText}>Chat normally. Memory extracts automatically.</p>
                {features.commands && (
                  <div style={S.cmdHint}>
                    {["/remember key: value", "/forget key", "/pin key", "/check"].map(c => (
                      <span key={c} style={S.cmdTag}>{c}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ ...S.msgWrap, justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ ...S.msg, ...(m.role === "user" ? S.msgUser : S.msgBot) }}>
                  {m.role === "assistant" && <div style={S.msgLabel}>MNEMO</div>}
                  <div style={S.msgText}>{m.content}</div>
                  {m.updates?.length > 0 && (
                    <div style={S.memBadge}>⟳ {m.updates.length} memory update{m.updates.length > 1 ? "s" : ""}</div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ ...S.msgWrap, justifyContent: "flex-start" }}>
                <div style={{ ...S.msg, ...S.msgBot }}>
                  <div style={S.msgLabel}>MNEMO</div>
                  <div style={S.typing}>
                    <span style={S.dot} /><span style={{ ...S.dot, animationDelay: "0.2s" }} /><span style={{ ...S.dot, animationDelay: "0.4s" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatBottom} />
          </div>
          <div style={S.inputRow}>
            <textarea
              style={S.input}
              value={input}
              onChange={e => handleInputChange(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder={features.commands ? "Message… or /remember /forget /pin /check" : "Message…"}
              rows={2}
            />
            <button style={{ ...S.sendBtn, opacity: loading ? 0.5 : 1 }} onClick={sendMessage} disabled={loading}>▶</button>
          </div>
        </div>
      )}

      {/* ── TABLE ── */}
      {activeTab === "table" && (
        <div style={S.tablePane}>
          <div style={S.tableTool}>
            <span style={S.tableTitle}>ACTIVE MEMORY ({activeMemory.length})</span>
            <button style={S.addBtn} onClick={() => setShowAdd(!showAdd)}>+ ADD ROW</button>
          </div>
          {showAdd && (
            <div style={S.addRowWrap}>
              <select style={S.sel} value={newRow.category} onChange={e => setNewRow({ ...newRow, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
              {features.confidence && (
                <select style={S.sel} value={newRow.confidence} onChange={e => setNewRow({ ...newRow, confidence: e.target.value })}>
                  <option>STATED</option><option>INFERRED</option>
                </select>
              )}
              <input style={S.tinput} placeholder="Key" value={newRow.key} onChange={e => setNewRow({ ...newRow, key: e.target.value })} />
              <input style={{ ...S.tinput, flex: 2 }} placeholder="Value" value={newRow.value} onChange={e => setNewRow({ ...newRow, value: e.target.value })} />
              <button style={S.saveBtn} onClick={addRow}>SAVE</button>
              <button style={S.cancelBtn} onClick={() => setShowAdd(false)}>✕</button>
            </div>
          )}
          <div style={S.tableScroll}>
            <table style={S.table}>
              <thead>
                <tr>
                  {features.pinRows && <th style={S.th}>★</th>}
                  <th style={S.th}>CAT</th>
                  {features.confidence && <th style={S.th}>SRC</th>}
                  <th style={S.th}>KEY</th>
                  <th style={S.th}>VALUE</th>
                  <th style={S.th}>MSG</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {activeMemory.map(row => {
                  const opacity = getStaleOpacity(row, messages.length, features.staleness);
                  const isGlowing = features.activeGlow && activeMatches.some(m => m.id === row.id);
                  const rowStyle = {
                    ...S.tr, opacity,
                    boxShadow: isGlowing ? `inset 0 0 0 1px ${CAT_COLORS[row.category]}33` : "none",
                    background: isGlowing ? CAT_COLORS[row.category] + "08" : "transparent",
                  };
                  if (editRow?.id === row.id) return (
                    <tr key={row.id} style={{ ...S.tr, background: "#0d1117" }}>
                      {features.pinRows && <td style={S.td}></td>}
                      <td style={S.td}>
                        <select style={S.sel} value={editRow.category} onChange={e => setEditRow({ ...editRow, category: e.target.value })}>
                          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </td>
                      {features.confidence && (
                        <td style={S.td}>
                          <select style={S.sel} value={editRow.confidence || "STATED"} onChange={e => setEditRow({ ...editRow, confidence: e.target.value })}>
                            <option>STATED</option><option>INFERRED</option>
                          </select>
                        </td>
                      )}
                      <td style={S.td}><input style={S.tinput} value={editRow.key} onChange={e => setEditRow({ ...editRow, key: e.target.value })} /></td>
                      <td style={S.td}><input style={{ ...S.tinput, width: "100%" }} value={editRow.value} onChange={e => setEditRow({ ...editRow, value: e.target.value })} /></td>
                      <td style={S.td}>{row.msg}</td>
                      <td style={S.td}>
                        <button style={S.saveBtn} onClick={saveEdit}>✓</button>
                        <button style={S.cancelBtn} onClick={() => setEditRow(null)}>✕</button>
                      </td>
                    </tr>
                  );
                  return (
                    <tr key={row.id} style={rowStyle}>
                      {features.pinRows && (
                        <td style={S.td}>
                          <button style={{ ...S.iconBtn, color: row.pinned ? "#ffb800" : "#1e293b", fontSize: "14px" }} onClick={() => togglePin(row.id)}>★</button>
                        </td>
                      )}
                      <td style={S.td}>
                        <span style={{ ...S.catTag, background: CAT_COLORS[row.category] + "15", color: CAT_COLORS[row.category], borderColor: CAT_COLORS[row.category] + "44" }}>
                          {row.category}
                        </span>
                      </td>
                      {features.confidence && (
                        <td style={S.td}>
                          <span style={{ fontSize: "10px", color: row.confidence === "INFERRED" ? "#c084fc" : "#00ff9d88", letterSpacing: "0.04em" }}>
                            {row.confidence === "INFERRED" ? "~AI" : "✓"}
                          </span>
                        </td>
                      )}
                      <td style={{ ...S.td, color: "#94a3b8" }}>{row.key}</td>
                      <td style={S.td}>
                        <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: "6px" }}
                          onMouseEnter={() => features.history && row.history?.length > 0 && setHoveredHistoryId(row.id)}
                          onMouseLeave={() => setHoveredHistoryId(null)}>
                          <span>{row.value}</span>
                          {features.history && row.history?.length > 0 && (
                            <span style={S.histDot}>↺{row.history.length}</span>
                          )}
                          {features.history && hoveredHistoryId === row.id && row.history?.length > 0 && (
                            <div style={S.histPopup}>
                              <div style={S.histTitle}>PREVIOUS VALUES</div>
                              {[...row.history].reverse().map((h, i) => (
                                <div key={i} style={S.histItem}>
                                  <span style={S.histMsg}>msg {h.msg}</span>
                                  <span style={S.histVal}>{h.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ ...S.td, color: "#1e293b", fontSize: "11px" }}>{row.msg}</td>
                      <td style={S.td}>
                        <button style={S.iconBtn} onClick={() => setEditRow(row)}>✎</button>
                        <button style={{ ...S.iconBtn, color: "#ff6b6b44" }} onClick={() => deleteRow(row.id)}>✕</button>
                      </td>
                    </tr>
                  );
                })}
                {activeMemory.length === 0 && (
                  <tr><td colSpan={10} style={{ ...S.td, textAlign: "center", color: "#1e293b", padding: "40px" }}>No rows yet. Start chatting or add manually.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {outdatedMemory.length > 0 && (
            <>
              <div style={{ ...S.tableTool, marginTop: "22px" }}>
                <span style={{ ...S.tableTitle, color: "#1e293b" }}>OUTDATED ({outdatedMemory.length})</span>
              </div>
              <table style={S.table}>
                <tbody>
                  {outdatedMemory.map(row => (
                    <tr key={row.id} style={{ ...S.tr, opacity: 0.3 }}>
                      {features.pinRows && <td style={S.td}></td>}
                      <td style={S.td}><span style={{ ...S.catTag, background: "#0d1117", color: "#1e293b", borderColor: "#0f172a" }}>{row.category}</span></td>
                      {features.confidence && <td style={S.td}></td>}
                      <td style={{ ...S.td, textDecoration: "line-through", color: "#1e293b" }}>{row.key}</td>
                      <td style={{ ...S.td, color: "#1e293b" }}>{row.value}</td>
                      <td style={S.td}></td>
                      <td style={S.td}><button style={{ ...S.iconBtn, color: "#ff6b6b33" }} onClick={() => deleteRow(row.id)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* ── SETTINGS ── */}
      {activeTab === "settings" && (
        <div style={S.settingsPane}>
          <div style={S.settingsHeader}>
            <span style={S.settingsTitle}>FEATURE TOGGLES</span>
            <span style={{ color: "#334155", fontSize: "10px" }}>{enabledCount}/8 enabled</span>
          </div>
          <div style={S.featureGrid}>
            {FEATURES.map(f => {
              const on = features[f.id];
              return (
                <div key={f.id}
                  style={{ ...S.featureCard, borderColor: on ? "#00ff9d33" : "#0c0c18", background: on ? "#00ff9d05" : "#08080e" }}
                  onClick={() => toggleFeature(f.id)}>
                  <div style={S.featureTop}>
                    <span style={{ ...S.featureLabel, color: on ? "#e2e8f0" : "#334155" }}>{f.label}</span>
                    <div style={{ ...S.toggle, background: on ? "#00ff9d" : "#1e293b" }}>
                      <div style={{ ...S.toggleKnob, transform: on ? "translateX(14px)" : "translateX(2px)" }} />
                    </div>
                  </div>
                  <div style={{ ...S.featureDesc, color: on ? "#475569" : "#1e293b" }}>{f.desc}</div>
                </div>
              );
            })}
          </div>
          <div style={S.settingsActions}>
            <button style={S.actionBtn} onClick={() => setFeatures(Object.fromEntries(FEATURES.map(f => [f.id, true])))}>ENABLE ALL</button>
            <button style={{ ...S.actionBtn, color: "#334155", borderColor: "#1e293b" }} onClick={() => setFeatures(Object.fromEntries(FEATURES.map(f => [f.id, false])))}>DISABLE ALL</button>
          </div>
        </div>
      )}

      {/* ── EXPORT ── */}
      {activeTab === "export" && (
        <div style={S.exportPane}>
          <div style={S.exportSection}>
            <div style={S.exportLabel}>EXPORT MEMORY (JSON)</div>
            <pre style={S.pre}>{JSON.stringify(memory, null, 2)}</pre>
            <div style={S.exportBtns}>
              <button style={S.actionBtn} onClick={exportMemory}>⬆ COPY JSON</button>
              <button style={S.actionBtn} onClick={exportPrompt}>⬆ COPY SYSTEM PROMPT</button>
            </div>
          </div>
          <div style={S.exportSection}>
            <div style={S.exportLabel}>IMPORT MEMORY</div>
            <textarea style={{ ...S.pre, resize: "vertical", minHeight: "90px", outline: "none", cursor: "text", color: "#475569" }}
              value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste exported JSON here…" />
            <div style={S.exportBtns}>
              <button style={S.actionBtn} onClick={importMemory}>⬇ IMPORT</button>
              <button style={{ ...S.actionBtn, color: "#ff6b6b", borderColor: "#ff6b6b22" }} onClick={() => { setMemory([]); triggerFlash("Cleared"); }}>✕ CLEAR ALL</button>
            </div>
          </div>
          <div style={S.exportSection}>
            <div style={S.exportLabel}>BREAKDOWN</div>
            <div style={S.statGrid}>
              {CATEGORIES.map(c => (
                <div key={c} style={S.statCell}>
                  <span style={{ ...S.catTag, background: CAT_COLORS[c] + "15", color: CAT_COLORS[c], borderColor: CAT_COLORS[c] + "44" }}>{c}</span>
                  <span style={{ fontSize: "17px", fontWeight: 700, color: "#f1f5f9" }}>{memory.filter(r => r.category === c && !r.outdated).length}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Syne:wght@800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  ::-webkit-scrollbar{width:4px;height:4px}
  ::-webkit-scrollbar-track{background:#070711}
  ::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:0.15}}
  @keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
  @keyframes flashIn{0%{opacity:0}15%,80%{opacity:1}100%{opacity:0}}
  textarea:focus,input:focus,select:focus{border-color:#00ff9d44!important;outline:none}
`;

const S = {
  root: { fontFamily: "'JetBrains Mono',monospace", background: "#070711", color: "#cbd5e1", minHeight: "100vh", display: "flex", flexDirection: "column", fontSize: "13px" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 18px", borderBottom: "1px solid #0c0c18", background: "#08080e", gap: "10px", flexWrap: "wrap" },
  logo: { display: "flex", alignItems: "center", gap: "8px" },
  logoIcon: { color: "#00ff9d", fontSize: "16px" },
  logoText: { fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: "15px", letterSpacing: "0.15em", color: "#f1f5f9" },
  logoBadge: { background: "#00ff9d0d", color: "#00ff9d", border: "1px solid #00ff9d2a", borderRadius: "3px", padding: "2px 6px", fontSize: "10px", letterSpacing: "0.1em" },
  flash: { background: "#00ff9d", color: "#070711", borderRadius: "3px", padding: "3px 9px", fontSize: "11px", fontWeight: 600, animation: "flashIn 2.5s ease forwards", letterSpacing: "0.05em" },
  tabs: { display: "flex", gap: "2px" },
  tab: { background: "transparent", border: "1px solid #0f172a", color: "#334155", padding: "4px 11px", borderRadius: "3px", cursor: "pointer", fontSize: "10px", letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace", transition: "all 0.15s" },
  tabActive: { background: "#00ff9d0a", borderColor: "#00ff9d3a", color: "#00ff9d" },
  tokenBarWrap: { display: "flex", alignItems: "center", gap: "10px", padding: "5px 18px", borderBottom: "1px solid #0c0c18", background: "#08080e" },
  tokenBg: { flex: 1, height: "2px", background: "#0f172a", borderRadius: "2px", overflow: "hidden" },
  tokenFill: { height: "100%", borderRadius: "2px", transition: "width 0.4s,background 0.4s" },
  tokenLabel: { fontSize: "10px", color: "#1e293b", letterSpacing: "0.06em", whiteSpace: "nowrap" },
  chatPane: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  contextStrip: { display: "flex", alignItems: "center", gap: "6px", padding: "5px 18px", borderBottom: "1px solid #0c0c18", background: "#08080e", flexWrap: "wrap" },
  ctxLabel: { fontSize: "9px", color: "#1e293b", letterSpacing: "0.1em" },
  ctxTag: { fontSize: "10px", border: "1px solid", borderRadius: "3px", padding: "1px 6px" },
  conflictBar: { padding: "5px 18px", background: "#ffb80008", borderBottom: "1px solid #ffb80022", fontSize: "11px", color: "#ffb800" },
  chatMessages: { flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "10px" },
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", padding: "60px 20px" },
  emptyIcon: { fontSize: "32px", color: "#1e293b" },
  emptyText: { textAlign: "center", color: "#334155", lineHeight: 1.6 },
  cmdHint: { display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "center" },
  cmdTag: { background: "#0d1117", border: "1px solid #0f172a", color: "#334155", borderRadius: "3px", padding: "2px 7px", fontSize: "10px" },
  msgWrap: { display: "flex", animation: "fadeIn 0.2s ease" },
  msg: { maxWidth: "78%", borderRadius: "6px", padding: "10px 13px", lineHeight: 1.65 },
  msgUser: { background: "#0d1117", border: "1px solid #0f172a", borderBottomRightRadius: "2px" },
  msgBot: { background: "#0a0a13", border: "1px solid #00ff9d18", borderBottomLeftRadius: "2px" },
  msgLabel: { fontSize: "9px", letterSpacing: "0.14em", color: "#00ff9d88", marginBottom: "5px" },
  msgText: { whiteSpace: "pre-wrap", wordBreak: "break-word" },
  memBadge: { marginTop: "6px", fontSize: "10px", color: "#00ff9d", background: "#00ff9d0a", border: "1px solid #00ff9d18", borderRadius: "3px", padding: "2px 6px", display: "inline-block" },
  typing: { display: "flex", gap: "5px", alignItems: "center", height: "16px" },
  dot: { width: "5px", height: "5px", borderRadius: "50%", background: "#00ff9d", animation: "blink 1s infinite", display: "inline-block" },
  inputRow: { display: "flex", gap: "8px", padding: "10px 18px", borderTop: "1px solid #0c0c18", background: "#08080e" },
  input: { flex: 1, background: "#0d1117", border: "1px solid #0f172a", borderRadius: "5px", color: "#cbd5e1", padding: "8px 11px", fontFamily: "'JetBrains Mono',monospace", fontSize: "13px", resize: "none", lineHeight: 1.5 },
  sendBtn: { background: "#00ff9d", color: "#070711", border: "none", borderRadius: "5px", width: "40px", cursor: "pointer", fontSize: "14px", fontWeight: 700, transition: "opacity 0.15s" },
  tablePane: { flex: 1, padding: "18px", overflowY: "auto" },
  tableTool: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" },
  tableTitle: { fontSize: "10px", letterSpacing: "0.14em", color: "#00ff9d" },
  addBtn: { background: "transparent", border: "1px solid #00ff9d2a", color: "#00ff9d", padding: "3px 10px", borderRadius: "3px", cursor: "pointer", fontSize: "10px", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" },
  addRowWrap: { display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap" },
  tableScroll: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "6px 10px", fontSize: "9px", letterSpacing: "0.14em", color: "#1e293b", borderBottom: "1px solid #0c0c18" },
  tr: { borderBottom: "1px solid #0a0a12", transition: "background 0.1s" },
  td: { padding: "8px 10px", verticalAlign: "middle", position: "relative" },
  catTag: { display: "inline-block", fontSize: "10px", padding: "1px 6px", borderRadius: "3px", border: "1px solid", letterSpacing: "0.05em" },
  iconBtn: { background: "transparent", border: "none", color: "#1e293b", cursor: "pointer", padding: "2px 5px", fontSize: "13px", fontFamily: "monospace", transition: "color 0.1s" },
  sel: { background: "#0d1117", border: "1px solid #0f172a", color: "#94a3b8", borderRadius: "3px", padding: "3px 6px", fontFamily: "'JetBrains Mono',monospace", fontSize: "11px" },
  tinput: { background: "#0d1117", border: "1px solid #0f172a", color: "#cbd5e1", borderRadius: "3px", padding: "4px 8px", fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", flex: 1, minWidth: "70px" },
  saveBtn: { background: "#00ff9d12", border: "1px solid #00ff9d2a", color: "#00ff9d", padding: "3px 10px", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontFamily: "'JetBrains Mono',monospace" },
  cancelBtn: { background: "#ff6b6b0a", border: "1px solid #ff6b6b1a", color: "#ff6b6b", padding: "3px 10px", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontFamily: "'JetBrains Mono',monospace" },
  histDot: { fontSize: "10px", color: "#c084fc88", cursor: "default" },
  histPopup: { position: "absolute", bottom: "calc(100% + 6px)", left: 0, background: "#0d1117", border: "1px solid #1e293b", borderRadius: "5px", padding: "8px 10px", zIndex: 99, minWidth: "200px", boxShadow: "0 8px 24px rgba(0,0,0,0.7)" },
  histTitle: { fontSize: "9px", color: "#1e293b", letterSpacing: "0.12em", marginBottom: "6px" },
  histItem: { display: "flex", gap: "8px", marginBottom: "3px", fontSize: "11px" },
  histMsg: { color: "#1e293b", minWidth: "38px" },
  histVal: { color: "#334155" },
  settingsPane: { flex: 1, padding: "18px", overflowY: "auto" },
  settingsHeader: { display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "14px" },
  settingsTitle: { fontSize: "10px", letterSpacing: "0.14em", color: "#00ff9d" },
  featureGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: "8px" },
  featureCard: { border: "1px solid", borderRadius: "6px", padding: "11px 13px", cursor: "pointer", transition: "all 0.2s", userSelect: "none" },
  featureTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" },
  featureLabel: { fontSize: "12px", fontWeight: 600, transition: "color 0.2s" },
  featureDesc: { fontSize: "11px", lineHeight: 1.5, transition: "color 0.2s" },
  toggle: { width: "28px", height: "15px", borderRadius: "8px", position: "relative", transition: "background 0.2s", flexShrink: 0 },
  toggleKnob: { position: "absolute", top: "1.5px", width: "12px", height: "12px", borderRadius: "50%", background: "#070711", transition: "transform 0.2s" },
  settingsActions: { display: "flex", gap: "8px", marginTop: "18px" },
  exportPane: { flex: 1, padding: "18px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px" },
  exportSection: { display: "flex", flexDirection: "column", gap: "8px" },
  exportLabel: { fontSize: "10px", letterSpacing: "0.14em", color: "#00ff9d" },
  pre: { background: "#08080e", border: "1px solid #0c0c18", borderRadius: "5px", padding: "12px", overflowX: "auto", color: "#334155", fontSize: "11px", lineHeight: 1.7, maxHeight: "180px", overflowY: "auto", fontFamily: "'JetBrains Mono',monospace" },
  exportBtns: { display: "flex", gap: "8px", flexWrap: "wrap" },
  actionBtn: { background: "#08080e", border: "1px solid #00ff9d2a", color: "#00ff9d", padding: "5px 12px", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" },
  statGrid: { display: "flex", gap: "8px", flexWrap: "wrap" },
  statCell: { display: "flex", alignItems: "center", gap: "8px", background: "#08080e", border: "1px solid #0c0c18", borderRadius: "5px", padding: "6px 11px" },
};
