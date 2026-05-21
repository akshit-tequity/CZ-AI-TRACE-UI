import { useState, useEffect, useCallback, useRef } from "react";
import Sidebar from "./components/Sidebar";
import ChatWindow from "./components/ChatWindow";
import Login from "./components/Login";
import { getRuns, groupRunsByPhone, PAGE_SIZE, LangSmithError } from "./api";
import styles from "./App.module.css";

// Throttle between successive page fetches — even if the user is scrolling
// fast, give LangSmith a breather. Their docs don't publish a per-IP burst
// limit, but empirically a sub-second cadence trips 429.
const MIN_INTERVAL_BETWEEN_PAGES_MS = 1200;

// Backoff if LangSmith doesn't tell us how long to wait (no Retry-After
// header). Starts at 5s, doubles on consecutive 429s up to this ceiling.
const DEFAULT_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 60000;

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [runs, setRuns] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [selectedPhone, setSelectedPhone] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState(null);
  const [error, setError] = useState(null);
  // Countdown UX while we wait out a 429. `0` means not throttled.
  const [retryInSeconds, setRetryInSeconds] = useState(0);

  // Guards against double-fires from rapid scroll events landing before
  // setLoadingMore has flipped to true in the next render.
  const loadingMoreRef = useRef(false);
  // Wall-clock time of the last successful page fetch, to throttle bursts.
  const lastFetchAtRef = useRef(0);
  // Exponential-backoff multiplier across consecutive 429s. Resets on success.
  const consecutive429Ref = useRef(0);
  // De-duplicates merged runs by id — LangSmith's cursor can echo the
  // boundary row on the next page in some edge cases; an explicit set is
  // cheap insurance against duplicates in conversation history.
  const seenRunIdsRef = useRef(new Set());

  // Initial load — page 1 only. Subsequent pages fetch on sidebar scroll.
  useEffect(() => {
    if (!authed) return;
    async function load() {
      try {
        setLoading(true);
        const { runs: page, nextCursor: nc } = await getRuns({ limit: PAGE_SIZE });
        seenRunIdsRef.current = new Set(page.map((r) => r.id));
        setRuns(page);
        const grouped = groupRunsByPhone(page);
        setContacts(grouped);
        if (grouped.length > 0) setSelectedPhone(grouped[0].phone);
        setNextCursor(nc);
        setHasMore(nc !== null);
        lastFetchAtRef.current = Date.now();
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [authed]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || retryInSeconds > 0 || !nextCursor) {
      return;
    }

    // Inter-request throttle — if the last fetch was very recent, wait it
    // out instead of firing immediately. Cheap defense against a wave of
    // near-bottom scroll detections.
    const sinceLast = Date.now() - lastFetchAtRef.current;
    if (sinceLast < MIN_INTERVAL_BETWEEN_PAGES_MS) {
      await new Promise((r) =>
        setTimeout(r, MIN_INTERVAL_BETWEEN_PAGES_MS - sinceLast)
      );
    }

    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const { runs: page, nextCursor: nc } = await getRuns({
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });
      lastFetchAtRef.current = Date.now();
      consecutive429Ref.current = 0;
      // Filter out any rows we already have (cursor-boundary echoes).
      const fresh = page.filter((r) => !seenRunIdsRef.current.has(r.id));
      for (const r of fresh) seenRunIdsRef.current.add(r.id);
      if (fresh.length === 0 && nc === null) {
        setHasMore(false);
      } else {
        const merged = [...runs, ...fresh];
        setRuns(merged);
        setContacts(groupRunsByPhone(merged));
        setNextCursor(nc);
        if (nc === null) setHasMore(false);
      }
    } catch (e) {
      if (e instanceof LangSmithError && e.status === 429) {
        // Honour Retry-After when present; otherwise exponential backoff
        // capped at MAX_BACKOFF_MS. Don't disable hasMore — we WILL try
        // again, the user just has to wait out the window.
        consecutive429Ref.current += 1;
        const fallback = Math.min(
          DEFAULT_BACKOFF_MS * 2 ** (consecutive429Ref.current - 1),
          MAX_BACKOFF_MS
        );
        const waitMs = e.retryAfterMs ?? fallback;
        setRetryInSeconds(Math.ceil(waitMs / 1000));
        // eslint-disable-next-line no-console
        console.warn(
          `LangSmith rate-limited — waiting ${Math.ceil(waitMs / 1000)}s before next fetch`
        );
      } else {
        // Any non-429 failure: stop further auto-loads so we don't hammer.
        // User can reload to retry.
        setHasMore(false);
        // eslint-disable-next-line no-console
        console.warn("loadMore failed:", e.message);
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [runs, hasMore, retryInSeconds, nextCursor]);

  // Countdown ticker — decrements retryInSeconds once per second. When it
  // hits zero, loadMore becomes callable again. The sidebar's scroll
  // listener will retrigger naturally on the next user scroll event.
  useEffect(() => {
    if (retryInSeconds <= 0) return;
    const id = setTimeout(() => setRetryInSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [retryInSeconds]);

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  const selectedContact = contacts.find((c) => c.phone === selectedPhone) || null;

  const handleSelect = (phone) => {
    setSelectedPhone(phone);
    setShowChat(true);
  };

  const handleBack = () => setShowChat(false);

  if (error) {
    return (
      <div className={styles.errorScreen}>
        <div className={styles.errorBox}>
          <h2>Failed to load data</h2>
          <p>{error}</p>
          <p className={styles.errorHint}>
            Make sure <code>VITE_LANGSMITH_API_KEY</code> and{" "}
            <code>VITE_LANGSMITH_SESSION_ID</code> are set in your{" "}
            <code>.env</code> file.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <div className={styles.container}>
        <Sidebar
          contacts={contacts}
          selectedPhone={selectedPhone}
          onSelect={handleSelect}
          loading={loading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          retryInSeconds={retryInSeconds}
          onLoadMore={loadMore}
          mobileHidden={showChat}
        />
        <ChatWindow
          contact={selectedContact}
          mobileHidden={!showChat}
          onBack={handleBack}
        />
      </div>
    </div>
  );
}
