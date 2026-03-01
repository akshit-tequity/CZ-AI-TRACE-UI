import { useState } from "react";
import Avatar from "./Avatar";
import { formatSidebarTime } from "../utils";
import styles from "./Sidebar.module.css";

export default function Sidebar({ contacts, selectedPhone, onSelect, loading, mobileHidden }) {
  const [search, setSearch] = useState("");

  const filtered = contacts.filter((c) => {
    const q = search.toLowerCase();
    const name = (c.userName || c.phone).toLowerCase();
    return name.includes(q) || c.phone.includes(q);
  });

  return (
    <div className={`${styles.sidebar} ${mobileHidden ? styles.mobileHidden : ""}`}>
      {/* Header */}
      <div className={styles.header}>
        <Avatar name="You" size={40} />
        <span className={styles.headerTitle}>CZ AI Traces</span>
        <div className={styles.headerIcons}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M12 7a2 2 0 1 0-.001-4.001A2 2 0 0 0 12 7zm0 2a2 2 0 1 0-.001 3.999A2 2 0 0 0 12 9zm0 6a2 2 0 1 0-.001 3.999A2 2 0 0 0 12 15z" />
          </svg>
        </div>
      </div>

      {/* Search */}
      <div className={styles.searchWrap}>
        <div className={styles.searchBox}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            className={styles.searchInput}
            placeholder="Search or start new chat"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Contact List */}
      <div className={styles.list}>
        {loading && (
          <div className={styles.loadingMsg}>Loading conversations…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className={styles.loadingMsg}>No conversations found</div>
        )}
        {filtered.map((contact) => (
          <ContactItem
            key={contact.phone}
            contact={contact}
            isSelected={selectedPhone === contact.phone}
            onClick={() => onSelect(contact.phone)}
          />
        ))}
      </div>
    </div>
  );
}

function ContactItem({ contact, isSelected, onClick }) {
  const displayName = `+${contact.phone}`;
  const preview = contact.lastMessage || "";
  const truncated = preview.length > 42 ? preview.slice(0, 42) + "…" : preview;

  return (
    <div
      className={`${styles.contactItem} ${isSelected ? styles.selected : ""}`}
      onClick={onClick}
    >
      <Avatar name={displayName} size={49} />
      <div className={styles.contactInfo}>
        <div className={styles.contactTop}>
          <span className={styles.contactName}>{displayName}</span>
          <span className={styles.contactTime}>
            {formatSidebarTime(contact.lastTime)}
          </span>
        </div>
        <div className={styles.contactBottom}>
          <span className={styles.contactPreview}>{truncated}</span>
          <span className={styles.contactCount}>
            {contact.runs.length}
          </span>
        </div>
      </div>
    </div>
  );
}
