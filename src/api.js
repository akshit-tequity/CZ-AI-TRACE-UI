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
// Returns: { runs, nextCursor } so the caller can chain.
export async function getRuns({ limit = PAGE_SIZE, cursor = null } = {}) {
  const body = {
    session: [LANGSMITH_SESSION_ID],
    is_root: true,
    run_type: "chain",
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
      entry.lastMessage =
        run.outputs?.response?.content || run.inputs?.message || "";
    }
  }

  // Sort each contact's runs oldest→newest, then contacts by latest first
  const contacts = Array.from(phoneMap.values()).map((c) => ({
    ...c,
    runs: c.runs.sort((a, b) => new Date(a.start_time) - new Date(b.start_time)),
  }));

  return contacts.sort((a, b) => b.lastTime - a.lastTime);
}

// Build flat message list from a contact's runs
export function buildMessages(runs) {
  const messages = [];
  for (const run of runs) {
    const userText = run.inputs?.message;
    const botText = run.outputs?.response?.content;
    const buttons = run.outputs?.response?.buttons;
    const time = run.start_time;
    const endTime = run.end_time;
    const status = run.status;

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
  }
  return messages;
}
