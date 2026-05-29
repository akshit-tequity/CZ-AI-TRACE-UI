const LANGSMITH_API_KEY = import.meta.env.VITE_LANGSMITH_API_KEY;
const LANGSMITH_SESSION_ID = import.meta.env.VITE_LANGSMITH_SESSION_ID;

export const PAGE_SIZE = 100;

// Typed error so callers can branch on 429 vs other failures without
// reparsing the error message.
export class LangSmithError extends Error {
  constructor(status, retryAfterMs) {
    super(`LangSmith API error: ${status}`);
    this.name = "LangSmithError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// Parses the LangSmith Retry-After response header. Spec allows either a
// delta-seconds integer or an HTTP-date; we handle both. Falls back to null
// when missing/unparseable — caller picks a default backoff.
function parseRetryAfterMs(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

// Single-page fetch — caller drives pagination (infinite-scroll on the
// sidebar). Bursting all pages up-front got us 429-rate-limited by LangSmith.
//
// IMPORTANT: LangSmith's /runs/query endpoint IGNORES `offset` (verified by
// observation 2026-05-21 — pages with offset=0, 3, 100 all returned the
// identical set). Pagination is CURSOR-based: response carries
// `cursors.next` which the caller must echo back as `cursor` in the next
// request body. Use `nextCursor === null` to detect end-of-data.
//
// `run_type` filter is INTENTIONALLY OMITTED (was `chain` before 2026-05-29).
// LangSmith run-types in this project:
//   - `chain`: agent_turn (ai-agent) AND kafka:start_transaction /
//     kafka:stop_transaction / kafka:meter_values (api-server Kafka roots).
//   - `tool`:  whatsapp_template:* runs (start_session_v2, milestone_*,
//     session_complete, invoice_receipt) and freeform_text / freeform_document.
// Filtering to `chain` only hid every WhatsApp template from the UI even
// though the trace was being captured correctly on the server. Pulling both
// types and filtering UI-side via `buildMessages` is the right shape.
//
// Returns: { runs, nextCursor } so the caller can chain.
export async function getRuns({ limit = PAGE_SIZE, cursor = null } = {}) {
  const body = {
    session: [LANGSMITH_SESSION_ID],
    is_root: true,
    limit,
  };
  if (cursor) body.cursor = cursor;

  const response = await fetch(
    "https://api.smith.langchain.com/api/v1/runs/query",
    {
      method: "POST",
      headers: {
        "X-API-Key": LANGSMITH_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) {
    const retryAfterMs =
      response.status === 429
        ? parseRetryAfterMs(response.headers.get("Retry-After"))
        : null;
    throw new LangSmithError(response.status, retryAfterMs);
  }
  const data = await response.json();
  return {
    runs: data.runs || [],
    nextCursor: data.cursors?.next ?? null,
  };
}

// Extract phone number from session_id like "whatsapp:918000363019"
export function extractPhone(sessionId) {
  if (!sessionId) return null;
  const match = sessionId.match(/whatsapp:(\d+)/);
  return match ? match[1] : sessionId;
}

// Group runs by phone number (deduplicated), sorted by latest message
export function groupRunsByPhone(runs) {
  const phoneMap = new Map();

  for (const run of runs) {
    const rawSession =
      run.extra?.metadata?.session_id ||
      run.thread_id ||
      run.extra?.metadata?.conversation_id;
    const phone = extractPhone(rawSession) || rawSession;
    if (!phone) continue;

    const userName =
      run.outputs?.response?.data?.verifiedUser?.name ||
      run.outputs?.response?.data?.verifiedUser?.phone ||
      null;

    if (!phoneMap.has(phone)) {
      phoneMap.set(phone, {
        phone,
        userName,
        runs: [],
        lastMessage: null,
        lastTime: null,
      });
    }

    const entry = phoneMap.get(phone);
    if (!entry.userName && userName) entry.userName = userName;
    entry.runs.push(run);

    const runTime = new Date(run.start_time);
    if (!entry.lastTime || runTime > entry.lastTime) {
      entry.lastTime = runTime;
      // Resolve a sidebar-preview string in order of usefulness:
      //   1. agent_turn → bot reply text
      //   2. agent_turn → user typed text
      //   3. whatsapp_template:* → rendered messageBody (the literal text
      //      the user received, captured on the trace since PR #161)
      //   4. kafka:* → "Charger event: <event_type>" so the sidebar still
      //      shows something readable when the contact's most recent
      //      activity is a charger event with no user turn after.
      const md = run.extra?.metadata || {};
      const name = run.name || "";
      let preview =
        run.outputs?.response?.content ||
        run.inputs?.message ||
        md.message_body ||
        "";
      if (!preview && name.startsWith("kafka:")) {
        const eventType = (md.event_type || name.replace(/^kafka:/, "")).replace(/_/g, " ");
        preview = `Charger event: ${eventType}`;
      }
      entry.lastMessage = preview;
    }
  }

  // Sort each contact's runs oldest→newest, then contacts by latest first
  const contacts = Array.from(phoneMap.values()).map((c) => ({
    ...c,
    runs: c.runs.sort((a, b) => new Date(a.start_time) - new Date(b.start_time)),
  }));

  return contacts.sort((a, b) => b.lastTime - a.lastTime);
}

// Build flat message list from a contact's runs.
//
// Three run shapes are recognised (2026-05-29):
//   1. `agent_turn` runs (ai-agent) — produce a user bubble + bot bubble pair.
//   2. `kafka:*` runs (api-server) — Kafka OCPP events
//      (start_transaction / stop_transaction / meter_values). Rendered as
//      a SYSTEM event pill inline with the conversation so the chronological
//      trace shows "user sent X" → "charger fired StartTransaction" →
//      "bot replied Y". Only appear under the right contact when the
//      api-server has back-written `session_id` via
//      `LangsmithService.enrichActiveRunWithUser` (PR coordinated with
//      api-server feat/CAI-API-langsmith-kafka-user-enrichment).
//   3. `whatsapp_template:*` runs (api-server) — outbound Meta template
//      sends (start_session_v2, milestone_*, session_complete,
//      invoice_receipt). Rendered as a SYSTEM event pill carrying the
//      pre-rendered messageBody (the actual text the user received) +
//      the template name.
//
// Anything else (freeform_text, freeform_document) gets rendered as a
// generic system event so it's visible even if we add a new run-type
// upstream without updating this file.
export function buildMessages(runs) {
  const messages = [];
  for (const run of runs) {
    const name = run.name || "";
    const time = run.start_time;
    const endTime = run.end_time;
    const status = run.status;

    if (name === "agent_turn") {
      // Original ai-agent shape: inputs.message → user bubble,
      // outputs.response.content → bot bubble.
      const userText = run.inputs?.message;
      const botText = run.outputs?.response?.content;
      const buttons = run.outputs?.response?.buttons;
      if (userText) {
        messages.push({
          id: `${run.id}-user`,
          type: "user",
          text: userText,
          time,
          status,
          runId: run.id,
          pairBotResponse: botText || "",
        });
      }
      if (botText) {
        messages.push({
          id: `${run.id}-bot`,
          type: "bot",
          text: botText,
          buttons: buttons || [],
          time: endTime || time,
          processingTimeMs: run.outputs?.processingTimeMs,
          agentType: run.outputs?.agentType,
          status,
          runId: run.id,
          pairUserMessage: userText || "",
        });
      }
      continue;
    }

    if (name.startsWith("kafka:")) {
      // Kafka OCPP event from the api-server. The chronological run-time
      // anchor is `start_time`; the event itself is metadata-driven.
      // Slug the event_type for the pill label ("start transaction").
      const md = run.extra?.metadata || {};
      const eventType = (md.event_type || name.replace(/^kafka:/, "")).replace(/_/g, " ");
      const detailParts = [];
      if (md.charger_id) detailParts.push(`charger ${md.charger_id}`);
      if (md.transaction_id) detailParts.push(`tx ${md.transaction_id}`);
      if (md.connector_id != null) detailParts.push(`connector ${md.connector_id}`);
      messages.push({
        id: `${run.id}-system`,
        type: "system",
        systemKind: "kafka",
        text: `Charger event: ${eventType}`,
        detail: detailParts.join(" · "),
        time,
        status,
        runId: run.id,
      });
      continue;
    }

    if (name.startsWith("whatsapp_template:")) {
      // Outbound Meta template send from the api-server. The captured
      // `messageBody` (since PR #161) is the literal text the user
      // received — show it inline so the conversation reads naturally.
      // Falls back to the template variables if messageBody is absent.
      const md = run.extra?.metadata || {};
      const templateName = md.template_name || name.replace(/^whatsapp_template:/, "");
      const body =
        md.message_body ||
        run.inputs?.messageBody ||
        (Array.isArray(run.inputs?.bodyInputs?.bodyVariables)
          ? run.inputs.bodyInputs.bodyVariables.join(" · ")
          : "");
      messages.push({
        id: `${run.id}-template`,
        type: "system",
        systemKind: "template",
        templateName,
        text: body || `Template sent: ${templateName}`,
        detail: body ? `Template: ${templateName}` : "",
        time,
        status,
        runId: run.id,
      });
      continue;
    }

    // Unknown / fallback (freeform_text, freeform_document, future types):
    // surface a minimal system pill so we never silently drop a run.
    messages.push({
      id: `${run.id}-system`,
      type: "system",
      systemKind: "other",
      text: `Trace: ${name}`,
      detail: run.extra?.metadata?.template_name || "",
      time,
      status,
      runId: run.id,
    });
  }
  return messages;
}
