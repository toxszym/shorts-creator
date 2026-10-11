export const API = process.env.NEXT_PUBLIC_API ?? "http://localhost:4000";

export type StyleId = "kronika" | "storytime" | "brainrot";

export interface ArchiveObject {
  id: string;
  title: string;
  description: string;
  date: string;
  author: string;
  source: string;
  license: string;
  url: string;
  thumb: string;
  score: number;
}

export interface Sentence {
  text: string;
  source_quote: string | null;
  asset_id: string;
  kind?: "hook" | "fact" | "punchline";
  trend?: string | null;
  doc_id?: string | null;
  sticker?: { text: string; tone: "plus" | "minus" } | null;
  countdown?: boolean;
  hide_chip?: boolean;
  ok: boolean;
  reason?: string;
  checks: string[];
}

export interface Job {
  id: string;
  status: "running" | "done" | "error";
  stage: string;
  stages: string[];
  progress: number;
  cached: boolean;
  seconds?: number;
  error?: string;
  video_url?: string;
  report?: { materials: string; script: string; hook_type: string | null; trend: string | null; angle: string | null; format: string | null; text_source: string | null; scenes: Sentence[]; rejected: Sentence[] };
  storyboard?: {
    duration: number;
    credits: { title: string; url: string; license: string; author?: string }[];
    text_sources?: { title: string; source: string; url: string; license: string }[];
  };
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message ?? "Błąd API");
  return data;
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error("Błąd API");
  return res.json();
}
