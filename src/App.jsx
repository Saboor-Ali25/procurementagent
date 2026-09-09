import { useState, useRef, useEffect } from "react";

const TOOL = {
  name: "evaluate_and_recommend",
  description: "Score all vendors and select the best one for procurement. Call this after researching vendor reputations.",
  input_schema: {
    type: "object",
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          properties: {
            vendor:           { type: "string" },
            price_score:      { type: "integer", description: "out of 35 — lower price = higher score" },
            speed_score:      { type: "integer", description: "out of 25 — faster delivery = higher score" },
            terms_score:      { type: "integer", description: "out of 20 — longer credit = higher score" },
            reputation_score: { type: "integer", description: "out of 20 — based on online findings" },
            total:            { type: "integer" }
          },
          required: ["vendor","price_score","speed_score","terms_score","reputation_score","total"]
        }
      },
      winner: { type: "string", description: "Name of the recommended vendor" },
      reason: { type: "string", description: "2-3 sentences explaining why this vendor is the best choice" },
      risk:   { type: "string", description: "Any concern the procurement team should be aware of" }
    },
    required: ["scores","winner","reason","risk"]
  }
};

async function callClaude(messages, tools = []) {
  const body = { model: "claude-sonnet-4-6", max_tokens: 1000, messages };
  if (tools.length) body.tools = tools;
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || "API error"); }
  return r.json();
}

const PRODUCTS = [
  { category: "Edible Oils",  items: ["Cooking Oil 1L (Sunridge)", "Cooking Oil 5L (Sunridge)", "Canola Oil 1L", "Desi Ghee 1kg"] },
  { category: "Grains",       items: ["Basmati Rice 5kg", "Super Kernel Rice 5kg", "Wheat Flour (Atta) 10kg", "Maida 1kg"] },
  { category: "Sugar & Salt", items: ["Refined Sugar 1kg", "Brown Sugar 1kg", "Table Salt 800g"] },
  { category: "Beverages",    items: ["Lipton Tea 190g", "Tapal Danedar 450g", "Nescafé Classic 100g"] },
  { category: "Dairy",        items: ["UHT Milk 1L (Olpers)", "Butter 200g (Adams)", "Cream 200ml"] },
  { category: "Household",    items: ["Surf Excel 1kg", "Vim Dishwash 800ml", "Harpic 500ml"] },
];

const DEFAULT_VENDORS = [
  { name: "Allied Trading Co.",      price: "280", lead: "4", terms: "30 days" },
  { name: "Hassan Foods Pvt Ltd",    price: "265", lead: "7", terms: "60 days" },
  { name: "National Distributors",   price: "290", lead: "2", terms: "45 days" },
];

export default function App() {
  const [product,  setProduct]  = useState("Cooking Oil 1L (Sunridge)");
  const [vendors,  setVendors]  = useState(DEFAULT_VENDORS);
  const [log,      setLog]      = useState([]);
  const [result,   setResult]   = useState(null);
  const [running,  setRunning]  = useState(false);
  const [err,      setErr]      = useState("");
  const logRef = useRef();

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const upd = (i, f, v) =>
    setVendors(vs => vs.map((x, j) => j === i ? { ...x, [f]: v } : x));

  const push = (text, hi = false) =>
    setLog(p => [...p, { text, hi, id: Math.random() }]);

  const run = async () => {
    if (!product.trim() || vendors.some(v => !v.name || !v.price)) {
      setErr("Fill in the product name and all vendor fields."); return;
    }
    setRunning(true); setErr(""); setLog([]); setResult(null);

    try {
      const vendorList = vendors.map((v, i) =>
        `${i + 1}. ${v.name} — PKR ${v.price}/unit, ${v.lead} days delivery, ${v.terms} payment`
      ).join("\n");

      // Step 1 — web search for reputation
      push("Searching online reputation for each vendor...");

      const s1 = await callClaude([{
        role: "user",
        content: `You are a procurement intelligence agent. Search online for the reputation of these Pakistani suppliers. Find legitimacy, reviews, complaints, or any red flags for each.

Vendors:
${vendors.map(v => `- ${v.name}`).join("\n")}

After searching, call evaluate_and_recommend with scores and your recommendation.

Product being procured: ${product}
Vendor quotes:
${vendorList}

Scoring weights: Price 35pts · Delivery speed 25pts · Payment terms 20pts · Reputation 20pts`
      }], [
        { type: "web_search_20250305", name: "web_search" },
        TOOL
      ]);

      // Step 2 — handle tool use loop
      let msgs = [
        { role: "user",      content: s1.content[0]?.text || "evaluate vendors" },
        { role: "assistant", content: s1.content }
      ];
      let res = null;

      if (s1.stop_reason === "tool_use") {
        const calls = s1.content.filter(b => b.type === "tool_use");
        const results = calls.map(tc => {
          if (tc.name === "evaluate_and_recommend") res = tc.input;
          return { type: "tool_result", tool_use_id: tc.id, content: "OK" };
        });
        msgs.push({ role: "user", content: results });
      }

      // If not done yet, continue the loop
      if (!res) {
        push("Scoring vendors against criteria...");
        for (let i = 0; i < 5 && !res; i++) {
          const r = await callClaude(msgs, [TOOL]);
          msgs.push({ role: "assistant", content: r.content });
          if (r.stop_reason === "end_turn") break;
          if (r.stop_reason === "tool_use") {
            const calls = r.content.filter(b => b.type === "tool_use");
            const results = calls.map(tc => {
              if (tc.name === "evaluate_and_recommend") res = tc.input;
              return { type: "tool_result", tool_use_id: tc.id, content: "OK" };
            });
            msgs.push({ role: "user", content: results });
          }
        }
      }

      if (!res) throw new Error("Agent could not produce a recommendation. Try again.");

      push("Reputation data collected for all vendors.");
      push(`Recommended: ${res.winner}`, true);
      setResult(res);

    } catch (e) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  };

  // ── tokens ──────────────────────────────────────────────────────────
  const C = {
    bg:      "#F2F4F7",
    surface: "#FFFFFF",
    border:  "#DDE1E7",
    nav:     "#1B2533",
    navText: "#CBD5E1",
    btn:     "#3B6FF5",
    btnHov:  "#2558D9",
    green:   "#16A34A",
    greenBg: "#F0FDF4",
    greenBd: "#BBF7D0",
    amber:   "#B45309",
    amberBg: "#FFFBEB",
    red:     "#DC2626",
    text:    "#111827",
    muted:   "#64748B",
  };

  const inp = {
    width: "100%", padding: "8px 10px",
    background: "#F8FAFC", border: `1px solid ${C.border}`,
    borderRadius: "7px", color: C.text,
    fontSize: "13px", outline: "none", boxSizing: "border-box",
  };

  const sorted = (result?.scores || []).slice().sort((a, b) => b.total - a.total);
  const maxScore = sorted.length ? sorted[0].total : 100;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "system-ui,-apple-system,sans-serif", color: C.text }}>

      {/* Nav */}
      <div style={{ background: C.nav, padding: "0 28px", height: "52px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: "15px", color: "#F1F5F9", letterSpacing: "-0.2px" }}>
            Procurement Agent
          </span>
          <span style={{ fontSize: "12px", color: C.navText, marginLeft: "12px", opacity: 0.6 }}>
            Vendor Evaluation
          </span>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          {["Web Search", "Reputation Score", "Recommendation"].map((s, i) => (
            <span key={s} style={{ fontSize: "11px", color: C.navText, opacity: 0.5, padding: "3px 8px", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.1)" }}>
              {i + 1}. {s}
            </span>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: "820px", margin: "0 auto", padding: "24px 20px 48px" }}>

        {/* Input card */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "20px", marginBottom: "14px" }}>

          <div style={{ marginBottom: "18px" }}>
            <label style={{ display: "block", fontSize: "12px", color: C.muted, marginBottom: "5px" }}>
              Product being procured
            </label>
            <select
              value={product}
              onChange={e => setProduct(e.target.value)}
              style={{ ...inp, fontSize: "14px", cursor: "pointer", paddingRight: "32px",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6' fill='%2364748B'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", appearance: "none"
              }}
            >
              {PRODUCTS.map(group => (
                <optgroup key={group.category} label={group.category}>
                  {group.items.map(item => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Vendor columns */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "12px", marginBottom: "16px" }}>
            {vendors.map((v, i) => (
              <div key={i} style={{ padding: "12px", background: "#F8FAFC", border: `1px solid ${C.border}`, borderRadius: "9px" }}>
                <div style={{ fontSize: "11px", color: C.muted, marginBottom: "10px", fontWeight: 500 }}>
                  Vendor {i + 1}
                </div>
                {[
                  ["Company name", "name", "text"],
                  ["Price (PKR/unit)", "price", "number"],
                  ["Lead time (days)", "lead", "number"],
                ].map(([lbl, field, type]) => (
                  <div key={field} style={{ marginBottom: "8px" }}>
                    <label style={{ display: "block", fontSize: "10px", color: C.muted, marginBottom: "3px" }}>{lbl}</label>
                    <input type={type} value={v[field]} onChange={e => upd(i, field, e.target.value)} style={inp} />
                  </div>
                ))}
                <div>
                  <label style={{ display: "block", fontSize: "10px", color: C.muted, marginBottom: "3px" }}>Payment terms</label>
                  <select value={v.terms} onChange={e => upd(i, "terms", e.target.value)}
                    style={{ ...inp, cursor: "pointer" }}>
                    {["Advance","15 days","30 days","45 days","60 days","90 days"].map(o => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>

          {err && (
            <div style={{ padding: "9px 12px", borderRadius: "7px", marginBottom: "12px", background: "#FEF2F2", border: `1px solid #FECACA`, color: C.red, fontSize: "13px" }}>
              {err}
            </div>
          )}

          <button onClick={run} disabled={running} style={{
            width: "100%", padding: "12px", borderRadius: "8px", border: "none",
            background: running ? C.border : C.btn, color: running ? C.muted : "#fff",
            fontSize: "14px", fontWeight: 600, cursor: running ? "not-allowed" : "pointer",
          }}>
            {running ? "Agent is evaluating..." : "Evaluate vendors"}
          </button>
        </div>

        {/* Log */}
        {log.length > 0 && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "14px 18px", marginBottom: "14px" }}>
            <div style={{ fontSize: "11px", color: C.muted, marginBottom: "8px" }}>Agent log</div>
            <div ref={logRef} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {log.map(l => (
                <div key={l.id} style={{ fontSize: "13px", color: l.hi ? C.green : C.muted, lineHeight: 1.5, fontWeight: l.hi ? 600 : 400 }}>
                  {l.hi ? "→ " : "· "}{l.text}
                </div>
              ))}
              {running && <div style={{ fontSize: "12px", color: C.muted }}>...</div>}
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden" }}>

            {/* Winner banner */}
            <div style={{ background: C.greenBg, borderBottom: `1px solid ${C.greenBd}`, padding: "16px 20px" }}>
              <div style={{ fontSize: "11px", color: C.green, fontWeight: 600, marginBottom: "3px" }}>
                Recommended vendor
              </div>
              <div style={{ fontSize: "18px", fontWeight: 700, color: "#14532D" }}>
                {result.winner}
              </div>
              <div style={{ fontSize: "13px", color: "#166534", marginTop: "6px", lineHeight: 1.6 }}>
                {result.reason}
              </div>
            </div>

            {/* Score table */}
            <div style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: "11px", color: C.muted, marginBottom: "12px" }}>
                Score breakdown
              </div>
              {sorted.map(s => {
                const isWinner = s.vendor === result.winner;
                const pct = Math.round((s.total / 100) * 100);
                return (
                  <div key={s.vendor} style={{
                    display: "flex", alignItems: "center", gap: "12px",
                    padding: "10px 12px", marginBottom: "6px", borderRadius: "8px",
                    background: isWinner ? C.greenBg : "#F8FAFC",
                    border: `1px solid ${isWinner ? C.greenBd : C.border}`,
                  }}>
                    <div style={{ width: "180px", flexShrink: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: isWinner ? 600 : 400, color: C.text }}>
                        {s.vendor}
                      </div>
                      <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>
                        Price {s.price_score} · Speed {s.speed_score} · Terms {s.terms_score} · Rep {s.reputation_score}
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ height: "6px", background: C.border, borderRadius: "3px", overflow: "hidden" }}>
                        <div style={{
                          height: "100%", borderRadius: "3px",
                          width: `${pct}%`,
                          background: isWinner ? C.green : "#94A3B8",
                          transition: "width 0.6s ease"
                        }} />
                      </div>
                    </div>
                    <div style={{ width: "40px", textAlign: "right", fontWeight: 700, fontSize: "14px", color: isWinner ? C.green : C.text, flexShrink: 0 }}>
                      {s.total}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Risk */}
            {result.risk && (
              <div style={{ margin: "0 20px 16px", padding: "10px 12px", borderRadius: "7px", background: C.amberBg, border: `1px solid #FDE68A`, fontSize: "13px", color: C.amber, lineHeight: 1.6 }}>
                <span style={{ fontWeight: 600 }}>Note: </span>{result.risk}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
