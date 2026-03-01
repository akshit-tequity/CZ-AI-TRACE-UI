import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import ChatWindow from "./components/ChatWindow";
import Login from "./components/Login";
import { getRuns, groupRunsByPhone } from "./api";
import styles from "./App.module.css";

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [selectedPhone, setSelectedPhone] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!authed) return;
    async function load() {
      try {
        setLoading(true);
        const runs = await getRuns(100, 0);
        const grouped = groupRunsByPhone(runs);
        setContacts(grouped);
        if (grouped.length > 0) setSelectedPhone(grouped[0].phone);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [authed]);

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
