import { useState } from "react";
import type { Member } from "./api";

export function AssigneeAvatar({ user, members }: { user: string; members: Member[] }) {
  const member = members.find((m) => m.user === user);
  const name = member?.full_name || user;
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const image = member?.user_image;
  const initials = name.trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
  const hash = [...user].reduce((n, c) => n + c.charCodeAt(0), 0);
  const colors = ["#c4b5fd", "#93c5fd", "#fcd34d", "#6ee7b7", "#f9a8d4"];
  return (
    <span className="timeline-assignee-avatar" role="img" aria-label={name} data-tooltip={name} style={{ background: colors[hash % colors.length] }}>
      {initials}
      {image && failedImage !== image && <img src={image} alt="" loading="lazy" onError={() => setFailedImage(image)} />}
    </span>
  );
}
