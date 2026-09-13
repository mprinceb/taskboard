export type Member = {
  name: string;
  user: string;
  role: string;
  full_name: string;
  user_image?: string;
};
export type Column = {
  name: string;
  title: string;
  position: number;
  is_done: number;
  archived: number;
};
export type Card = {
  name: string;
  title: string;
  description: string;
  list_id: string;
  position: number;
  start_date: string | null;
  due_date: string | null;
  completed: number;
  archived: number;
  modified: string;
  assignees: string[];
  comment_count: number;
  attachment_count: number;
};
export type Notice = {
  name: string;
  kind: string;
  subject: string;
  card: string;
  seen: number;
  creation: string;
};
export type Board = {
  settings: {
    board_title: string;
    max_upload_mb: number;
    reminder_days: number;
  };
  cards: Card[];
  lists: Column[];
  members: Member[];
  user: string;
  role: string;
  email_notifications: number;
  notifications: Notice[];
};
export type Attachment = {
  name: string;
  comment: string | null;
  file_name: string;
  file_size: number;
  file_url: string;
  owner: string;
  creation: string;
};
export type Comment = {
  name: string;
  content: string;
  owner: string;
  creation: string;
  modified: string;
};
export type Detail = {
  card: Card;
  assignees: string[];
  comments: Comment[];
  attachments: Attachment[];
};
export const csrf = () =>
  document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ||
  "";
export function errorMessage(data: any) {
  try {
    const msgs = JSON.parse(data._server_messages || "[]");
    if (msgs.length)
      return String(JSON.parse(msgs[0]).message).replace(/<[^>]+>/g, "");
  } catch {}
  return (
    data.message ||
    data.exception?.split(": ").slice(1).join(": ") ||
    "Something went wrong. Please try again."
  );
}
export async function api<T = any>(
  method: string,
  args: Record<string, any> = {},
  write = false,
): Promise<T> {
  const response = await fetch("/api/method/taskboard.api." + method, {
    method: write ? "POST" : "GET",
    credentials: "same-origin",
    headers: write
      ? { "Content-Type": "application/json", "X-Frappe-CSRF-Token": csrf() }
      : {},
    ...(write ? { body: JSON.stringify(args) } : {}),
  });
  // GET methods with arguments use a query URL in get().
  const data = await response.json();
  if (!response.ok || data.exc) throw new Error(errorMessage(data));
  return data.message;
}
export async function get<T = any>(
  method: string,
  args: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(
    "/api/method/taskboard.api." + method + "?" + new URLSearchParams(args),
    { credentials: "same-origin" },
  );
  const data = await response.json();
  if (!response.ok || data.exc) throw new Error(errorMessage(data));
  return data.message;
}
export async function auth(
  method: "login" | "logout",
  args: Record<string, string> = {},
) {
  const response = await fetch("/api/method/" + method, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Frappe-CSRF-Token": csrf(),
    },
    body: JSON.stringify(args),
  });
  const data = await response.json();
  if (!response.ok || data.exc) throw new Error(errorMessage(data));
}
export function upload(
  card: string,
  file: File,
  comment: string | undefined,
  onProgress: (n: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/method/taskboard.api.upload");
    xhr.setRequestHeader("X-Frappe-CSRF-Token", csrf());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () =>
      reject(new Error("Upload failed. Check your connection."));
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(
          new Error(
            xhr.status === 413
              ? "The server upload limit was exceeded."
              : "Upload failed. Please try again.",
          ),
        );
        return;
      }
      if (xhr.status >= 400 || data.exc) reject(new Error(errorMessage(data)));
      else resolve();
    };
    const form = new FormData();
    form.append("card", card);
    form.append("file", file);
    if (comment) form.append("comment", comment);
    xhr.send(form);
  });
}
