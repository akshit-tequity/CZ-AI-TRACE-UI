import { formatTime } from "../utils";
import styles from "./MessageBubble.module.css";

export default function MessageBubble({ message }) {
  // System events (Kafka OCPP events + WhatsApp template sends from the
  // api-server) get a centred chip rather than a left/right WhatsApp
  // bubble — they're system actions, not turns in a conversation.
  if (message.type === "system") {
    const kindLabel =
      message.systemKind === "kafka"
        ? "OCPP"
        : message.systemKind === "template"
          ? "template"
          : "trace";
    return (
      <div className={styles.systemRow}>
        <div className={`${styles.systemPill} ${styles[`systemKind_${message.systemKind || "other"}`] || ""}`}>
          <span className={styles.systemKindBadge}>{kindLabel}</span>
          <span className={styles.systemText}>{message.text}</span>
          {message.detail && (
            <span className={styles.systemDetail}>· {message.detail}</span>
          )}
          <span className={styles.systemTime}>{formatTime(message.time)}</span>
        </div>
      </div>
    );
  }

  const isUser = message.type === "user";

  return (
    <div className={`${styles.row} ${isUser ? styles.rowUser : styles.rowBot}`}>
      <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleBot}`}>
        {/* Message text — render with line breaks */}
        <div className={styles.text}>
          {message.text.split("\n").map((line, i) => (
            <span key={i}>
              {line}
              {i < message.text.split("\n").length - 1 && <br />}
            </span>
          ))}
        </div>

        {/* Buttons (bot only) */}
        {!isUser && message.buttons?.length > 0 && (
          <div className={styles.buttons}>
            {message.buttons.map((btn) => (
              <div key={btn.id} className={styles.button}>
                {btn.title}
              </div>
            ))}
          </div>
        )}

        {/* Footer: agent type badge + time + tick */}
        <div className={styles.footer}>
          {!isUser && message.agentType && (
            <span className={styles.agentBadge}>{message.agentType}</span>
          )}
          {!isUser && message.processingTimeMs != null && (
            <span className={styles.processingTime}>
              {(message.processingTimeMs / 1000).toFixed(2)}s
            </span>
          )}
          <span className={styles.time}>{formatTime(message.time)}</span>
          {isUser && (
            <svg className={styles.tick} viewBox="0 0 18 18" width="15" height="15">
              <path
                fill="#53bdeb"
                d="M17.394 5.035l-.57-.444a.434.434 0 0 0-.609.076L8.297 15.17l-4.12-3.505a.434.434 0 0 0-.609.065l-.494.614a.434.434 0 0 0 .067.609l4.924 4.19a.434.434 0 0 0 .609-.067l9.28-11.605a.434.434 0 0 0-.56-.436z"
              />
              <path
                fill="#53bdeb"
                d="M12.015 5.11l-.57-.444a.434.434 0 0 0-.609.076l-5.52 6.947-1.062-.903a.434.434 0 0 0-.608.065l-.495.614a.434.434 0 0 0 .067.609l1.87 1.592 9.28-11.605a.434.434 0 0 0-.353-.951z"
              />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
