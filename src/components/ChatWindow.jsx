import { useEffect, useRef } from "react";
import Avatar from "./Avatar";
import MessageBubble from "./MessageBubble";
import DateDivider from "./DateDivider";
import { buildMessages } from "../api";
import { formatDate } from "../utils";
import styles from "./ChatWindow.module.css";

export default function ChatWindow({ contact, mobileHidden, onBack }) {
  const bottomRef = useRef(null);

  const messages = contact ? buildMessages(contact.runs) : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [contact?.phone, messages.length]);

  if (!contact) {
    return (
      <div className={`${styles.empty} ${mobileHidden ? styles.mobileHidden : ""}`}>
        <div className={styles.emptyInner}>
          <svg viewBox="0 0 303 172" width="320" height="182" fill="none">
            <rect width="303" height="172" fill="#f0f2f5" rx="8" />
            <circle cx="151" cy="86" r="50" fill="#dfe5e7" />
            <path d="M151 65c-11.6 0-21 9.4-21 21s9.4 21 21 21 21-9.4 21-21-9.4-21-21-21z" fill="#bfc9ce" />
            <path d="M130 107c0-11.6 9.4-21 21-21s21 9.4 21 21" fill="#bfc9ce" />
          </svg>
          <h2 className={styles.emptyTitle}>CZ AI Traces</h2>
          <p className={styles.emptySubtitle}>
            Select a conversation from the left to view the chat history.
          </p>
        </div>
      </div>
    );
  }

  const displayName = `+${contact.phone}`;

  // Group messages by date for dividers
  const grouped = [];
  let lastDate = null;
  for (const msg of messages) {
    const d = formatDate(msg.time);
    if (d !== lastDate) {
      grouped.push({ type: "divider", date: d, id: `div-${d}-${msg.id}` });
      lastDate = d;
    }
    grouped.push(msg);
  }

  return (
    <div className={`${styles.chatWindow} ${mobileHidden ? styles.mobileHidden : ""}`}>
      {/* Chat Header */}
      <div className={styles.header}>
        <button className={styles.backButton} onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>
        <Avatar name={displayName} size={40} />
        <div className={styles.headerInfo}>
          <div className={styles.headerName}>{displayName}</div>
          <div className={styles.headerSub}>
            +{contact.phone} &middot; {contact.runs.length} interactions
          </div>
        </div>
        <div className={styles.headerActions}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M15.9 14.3H15l-.3-.3c1-1.1 1.6-2.7 1.6-4.3C16.3 5.8 13.5 3 10 3S3.7 5.8 3.7 9.7s2.8 6.7 6.3 6.7c1.6 0 3-.6 4.1-1.6l.3.3v.8l5.1 5.1 1.5-1.5-5.1-5.2zm-5.9 0C7.2 14.3 4.8 11.9 4.8 9s2.4-5.3 5.2-5.3S15.2 6.1 15.2 9s-2.4 5.3-5.2 5.3z" />
          </svg>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M12 7a2 2 0 1 0-.001-4.001A2 2 0 0 0 12 7zm0 2a2 2 0 1 0-.001 3.999A2 2 0 0 0 12 9zm0 6a2 2 0 1 0-.001 3.999A2 2 0 0 0 12 15z" />
          </svg>
        </div>
      </div>

      {/* Messages Area */}
      <div className={styles.messages}>
        {grouped.map((item) =>
          item.type === "divider" ? (
            <DateDivider key={item.id} date={item.date} />
          ) : (
            <MessageBubble key={item.id} message={item} />
          )
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
