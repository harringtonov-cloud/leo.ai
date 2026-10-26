import {
  addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc, limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Chat, MemoryItem, Message, Project } from "@/lib/types";

/** All data lives under users/{uid}/…; firestore.rules lets each user touch only their own subtree. */

const MAX_CHAT_BYTES = 800_000; // Firestore documents are limited to ~1 MiB.

function persistableMessages(messages: Message[]): Message[] {
  // Drop heavy/session-only fields before saving.
  const slim = messages.map(({ images: _images, ...rest }) => rest);
  let json = JSON.stringify(slim);
  while (json.length > MAX_CHAT_BYTES && slim.length > 2) {
    slim.shift();
    json = JSON.stringify(slim);
  }
  return slim;
}

export function subscribeChats(uid: string, onData: (chats: Chat[]) => void, onError: (e: Error) => void) {
  if (!db) return () => {};
  const q = query(collection(db, "users", uid, "chats"), orderBy("updatedAt", "desc"), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const chats: Chat[] = [];
      snap.forEach((d) => {
        const data = d.data();
        try {
          chats.push({
            id: d.id,
            title: String(data.title || "New chat"),
            mode: data.mode === "code" ? "code" : "chat",
            projectId: typeof data.projectId === "string" ? data.projectId : undefined,
            updatedAt: Number(data.updatedAt) || 0,
            messages: JSON.parse(String(data.messages || "[]")) as Message[],
          });
        } catch {
          /* skip corrupted document */
        }
      });
      onData(chats);
    },
    onError
  );
}

export async function saveChat(uid: string, chat: Chat) {
  if (!db) return;
  await setDoc(doc(db, "users", uid, "chats", chat.id), {
    title: chat.title.slice(0, 120),
    mode: chat.mode,
    projectId: chat.projectId ?? null,
    updatedAt: chat.updatedAt,
    messages: JSON.stringify(persistableMessages(chat.messages)),
  });
}

export async function removeChat(uid: string, id: string) {
  if (!db) return;
  await deleteDoc(doc(db, "users", uid, "chats", id));
}

export function subscribeProjects(uid: string, onData: (projects: Project[]) => void, onError: (e: Error) => void) {
  if (!db) return () => {};
  const q = query(collection(db, "users", uid, "projects"), orderBy("updatedAt", "desc"), limit(50));
  return onSnapshot(
    q,
    (snap) => {
      const projects: Project[] = [];
      snap.forEach((d) => {
        const data = d.data();
        projects.push({
          id: d.id,
          name: String(data.name || "Untitled"),
          instructions: String(data.instructions || ""),
          files: Array.isArray(data.files) ? data.files : [],
          updatedAt: Number(data.updatedAt) || 0,
        });
      });
      onData(projects);
    },
    onError
  );
}

export async function saveProject(uid: string, project: Project) {
  if (!db) return;
  // Keep total knowledge well below the 1 MiB document limit.
  let budget = 700_000;
  const files = project.files.slice(0, 30).map((f) => {
    const content = f.content.slice(0, Math.max(0, Math.min(40_000, budget)));
    budget -= content.length;
    return { name: f.name.slice(0, 160), content };
  });
  await setDoc(doc(db, "users", uid, "projects", project.id), {
    name: project.name.slice(0, 100),
    instructions: project.instructions.slice(0, 4000),
    files,
    updatedAt: project.updatedAt,
  });
}

export async function removeProject(uid: string, id: string) {
  if (!db) return;
  await deleteDoc(doc(db, "users", uid, "projects", id));
}

export function subscribeMemory(uid: string, onData: (items: MemoryItem[]) => void, onError: (e: Error) => void) {
  if (!db) return () => {};
  const q = query(collection(db, "users", uid, "memory"), orderBy("createdAt", "desc"), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const items: MemoryItem[] = [];
      snap.forEach((d) => items.push({ id: d.id, text: String(d.data().text || ""), createdAt: Number(d.data().createdAt) || 0 }));
      onData(items);
    },
    onError
  );
}

export async function addMemory(uid: string, text: string) {
  if (!db) return;
  await addDoc(collection(db, "users", uid, "memory"), { text: text.slice(0, 300), createdAt: Date.now() });
}

export async function removeMemory(uid: string, id: string) {
  if (!db) return;
  await deleteDoc(doc(db, "users", uid, "memory", id));
}
