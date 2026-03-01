import { getInitials, getAvatarColor } from "../utils";

export default function Avatar({ name, size = 40 }) {
  const initials = getInitials(name);
  const bg = getAvatarColor(name || "?");

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontSize: size * 0.38,
        fontWeight: 600,
        color: "#fff",
        userSelect: "none",
      }}
    >
      {initials}
    </div>
  );
}
