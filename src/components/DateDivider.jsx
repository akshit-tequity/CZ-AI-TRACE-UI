import styles from "./DateDivider.module.css";

export default function DateDivider({ date }) {
  return (
    <div className={styles.wrap}>
      <span className={styles.label}>{date}</span>
    </div>
  );
}
