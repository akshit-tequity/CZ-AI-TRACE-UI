import { useState } from "react";
import styles from "./Login.module.css";

const VALID_USERNAME = "blame.the.intern";
const VALID_PASSWORD = "UndefinedIsNotAFunction!";

function BustedScreen() {
  return (
    <div className={styles.screen}>
      <div className={styles.bustedCard}>
        <div className={styles.bustedEmoji}>🚨</div>
        <h1 className={styles.bustedTitle}>Wrong.</h1>
        <p className={styles.bustedSub}>That was not it. At all.</p>
        <div className={styles.bustedDivider} />
        <p className={styles.bustedMsg}>
          We've already dispatched a strongly worded email to your future self.
        </p>
        <p className={styles.bustedMsg}>
          Please close this tab, go touch grass, and{" "}
          <strong>do not try again.</strong>
        </p>
        <p className={styles.bustedFooter}>
          🫵 We are watching.
        </p>
      </div>
    </div>
  );
}

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busted, setBusted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (username === VALID_USERNAME && password === VALID_PASSWORD) {
      onLogin();
    } else {
      setBusted(true);
    }
  };

  if (busted) return <BustedScreen />;

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <h1>CZ AI Traces</h1>
          <p>Sign in to continue</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label>Username</label>
            <input
              type="text"
              placeholder="Enter username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </div>
          <div className={styles.field}>
            <label>Password</label>
            <input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button type="submit" className={styles.btn}>
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}
