import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { LANGS, MAX_TEXT, STRINGS, langOf, lastSent } from "./i18n.ts";

// parts — what is glued into a "done" card: the thread's messages and the agent's replies to them, in time order.
// time — when the part was written; the by-thread view orders a conversation by it.
// replyAt of an item — when its reply was written; without a reply it equals the item's own time.
const partSchema = z.object({ kind: z.enum(["message", "reply"]), text: z.string(), time: z.number().optional() });
type Part = z.infer<typeof partSchema>;
const itemSchema = z.object({
  id: z.string(), time: z.number(), sender: z.string(), senderThreadId: z.string().nullable().optional(), senderTitle: z.string().nullable().optional(), kind: z.string(), text: z.string(), reply: z.string(), replyAt: z.number(), parts: z.array(partSchema),
});
// closed — sending threads that cannot be written to: archived, or gone (deleted or unreadable).
const rowsSchema = z.object({ hideIds: z.array(z.string()), items: z.array(itemSchema), closed: z.record(z.string(), z.enum(["archived", "gone"])) });
type Feed = z.infer<typeof rowsSchema>;
const threadInput = z.string().min(1).max(128);
const VIEWS = ["time", "threads"] as const;
// A message the user sent to another thread from the tab. The id comes from the app, so a repeated write is not stored twice.
const sentSchema = z.object({ id: z.string().min(1).max(64), to: threadInput, text: z.string().min(1).max(MAX_TEXT), time: z.number() });
type Sent = z.infer<typeof sentSchema>;

// seenAt — time of the entry up to which this thread's tab has been viewed; anything later counts as new.
// lang — interface language from the settings; the app picks its strings by it.
// marker — the reply marker from the settings ("" = off); the app strips it from the shown text.
// hide — whether the app hides the hideIds rows in the main feed; hideIds are sent either way.
// view — the view last chosen in this thread's tab; sent — what the user wrote to other threads from it.
export const rpcContract = defineRpcContract({
  feed: { input: z.object({ threadId: threadInput }), output: rowsSchema.extend({ seenAt: z.number(), lang: z.enum(LANGS), marker: z.string(), hide: z.boolean(), view: z.enum(VIEWS), sent: z.array(sentSchema) }) },
  seen: { input: z.object({ threadId: threadInput, at: z.number() }), output: z.object({ seenAt: z.number() }) },
  view: { input: z.object({ threadId: threadInput, view: z.enum(VIEWS) }), output: z.object({ view: z.enum(VIEWS) }) },
  // What this thread's agent sent to the peer thread, read from the peer's own feed. ok=false — that feed could not be read.
  talk: { input: z.object({ threadId: threadInput, peerId: threadInput }), output: z.object({ ok: z.boolean(), out: z.array(z.object({ id: z.string(), time: z.number(), text: z.string() })) }) },
  sent: { input: sentSchema.extend({ threadId: threadInput }), output: z.object({ sent: z.array(sentSchema) }) },
  // Whether the user's message with this text has reached the peer thread since the given time. Asked only after a send whose outcome is unknown.
  delivered: { input: z.object({ threadId: threadInput, peerId: threadInput, text: z.string().min(1), since: z.number() }), output: z.object({ found: z.boolean() }) },
});

const threadsSchema = z.array(z.string().min(1));
const threadsSetting = z.string().refine(value => {
  try { return threadsSchema.safeParse(JSON.parse(value)).success; } catch { return false; }
}, "Must be a JSON array of thread ids");

// null = the setting cannot be read: the plugin stays silent instead of acting everywhere.
const scopeOf = (value: string): string[] | null => {
  try { return threadsSchema.parse(JSON.parse(value)); } catch { return null; }
};

const MAX_PAGES = 20;
const MEMO_MS = 5000;
// A peer's feed is read only while its conversation is open, and at most once per TALK_MEMO_MS.
const TALK_MEMO_MS = 20_000;
const MERGE_MS = 60_000;
// The window's clock and the server's may differ a little: a message counts as delivered if its row is this much older than the send.
const CLOCK_SLACK_MS = 5000;
const BUSY = ["active", "pending", "starting", "stopping"];

type Row = {
  id: string; kind: string; role?: string; text?: string; title?: string; detail?: string | null;
  threadId?: string; turnId?: string | null; senderThreadId?: string | null; status?: string;
  systemMessageKind?: string; systemMessageSubject?: { kind: string; threadName?: string; threadId?: string } | null;
  children?: Row[] | null; createdAt?: number; startedAt?: number;
};

const flatten = (rows: Row[], into: Row[] = []): Row[] => {
  for (const row of rows) { into.push(row); if (row.children) flatten(row.children, into); }
  return into;
};
// An empty marker matches nothing: agent replies are then never hidden.
const isBgWith = (marker: string) => (r: Row) => !!marker && r.kind === "conversation" && r.role === "assistant" && !!r.text?.trimStart().startsWith(marker);
const notification = (r: Row) =>
  (r.kind === "conversation" && r.role === "user" && (!!r.senderThreadId || r.systemMessageKind?.startsWith("child-") === true)) ||
  (r.kind === "system" && /@thread:[\w-]+\s+(?:finished|completed)\s*:/i.test(`${r.title ?? ""} ${r.detail ?? ""}`));

// An outside tool marks its message by making the first line exactly [notify:Name] — the same way BB marks
// messages between threads. Name: 1–32 letters, digits, spaces, hyphens or dots, starting with a letter or digit.
// The format is fixed; a line that deviates in any way leaves the message an ordinary one.
const NOTIFY_RE = /^\[notify:([\p{L}\p{N}][\p{L}\p{N} .-]{0,31})\](?:\r?\n|$)/u;
// The tool's name, or null. Only for a plain message from a person: thread and system messages keep their own kind.
// Exported so that it can be checked on sample entries without a running BB.
export const toolOf = (r: Pick<Row, "kind" | "role" | "text" | "senderThreadId" | "systemMessageKind">): string | null =>
  r.kind === "conversation" && r.role === "user" && !notification(r as Row) ? r.text?.match(NOTIFY_RE)?.[1] ?? null : null;

const MENTION_RE = /((?:```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\r\n]+`+|^[ ]{4,}.*$|!?\[(?:[^\[\]]|\[[^\[\]]*\])*\](?:\([^\)]*\)|\[[^\]]*\])|^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$|\b[a-z]+:\/\/[^\s<>()]+|\bthr_\w+(?::[\w-]+)+|(?<!\w)[\/.][\w.\/-]+))|(?<![\w/:.\-=?&#])(?:@thread:)?(thr_\w+)(?![\w/\-=?&#]|[.:](?!\s|$))|(::task\{key="([^"]+)"[^}]*\})/gm;
const esc = (s: string) => s.replace(/[\\\[\]*_`]/g, "\\$&");
type CacheEntry = { title?: string; href?: string; at: number; failed?: boolean; archived?: boolean };
// The service line BB puts before a message from another thread or from the system; cards show the text without it.
const HEADER_RE = /^(?:(?:\[bb message from thread:[^\]]+\]|\[bb system\](?=\s*Child thread updates:))[ \t]*(?:\r?\n(?:\r?\n)?)?|\[bb system\]\s*@thread:[^\s:]+[ \t]*(?:(?:completed|finished):[ \t]*(?:\r?\n(?:\r?\n)?|$))?)/i;
const clean = (text: string) => text.replace(HEADER_RE, "");
const threadCache = new Map<string, CacheEntry>();
const isStale = (id: string) => {
  const e = threadCache.get(id);
  if (!e) return true;
  return e.failed ? (Date.now() - e.at >= 60_000) : (Date.now() - e.at >= 600_000);
};

// A thread sends a short message and then ends its turn — that is one event. The two texts differ,
// so they are glued by time: the message goes inside the first "done" of the same thread within MERGE_MS.
// Gluing does not affect hideIds: the main feed hides the same rows.
// The walk goes from old to new, so parts inside a card are in time order: message, its reply, next message.
// The reply to the "done" itself stays in reply and is shown last. Returns entries from new to old.
// Exported so that it can be checked on sample entries without a running BB.
export function glue<T extends { id: string; time: number; kind: string; senderThreadId: string | null; text: string; reply: string; replyAt?: number; parts: Part[] }>(items: T[]): T[] {
  const byTime = [...items].sort((a, b) => a.time - b.time);
  const absorbed = new Set<string>();
  byTime.forEach((msg, index) => {
    if (msg.kind !== "message" || !msg.senderThreadId) return;
    for (const done of byTime.slice(index + 1)) {
      if (done.time - msg.time > MERGE_MS) break;
      if (done.kind !== "done" || done.senderThreadId !== msg.senderThreadId) continue;
      done.parts.push({ kind: "message", text: msg.text, time: msg.time });
      if (msg.reply) done.parts.push({ kind: "reply", text: msg.reply, time: msg.replyAt ?? msg.time });
      absorbed.add(msg.id);
      break;
    }
  });
  return byTime.filter(it => !absorbed.has(it.id)).reverse();
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    language: { type: "select", label: "Language", options: [...LANGS], default: "en" },
    marker: { type: "string", label: "Reply marker, for example [bg] (empty = agent replies are not hidden and agents get no instruction)", experimental_schema: z.string().max(32, "At most 32 characters"), default: "" },
    hide: { type: "boolean", label: "Hide rows in the main feed (off = stock feed, the button and the tab keep working)", default: true },
    threads: { type: "string", label: "Threads (JSON array of thread ids; empty = every thread)", experimental_multiline: true, experimental_schema: threadsSetting, default: "[]" },
  });
  // Synchronous copy of the settings: the instruction provider cannot wait.
  const first = await settings.get();
  let scope = scopeOf(first.threads);
  let hide = first.hide;
  let lang = langOf(first.language);
  let marker = first.marker.trim();
  const inScope = (threadId: string) => scope !== null && (scope.length === 0 || scope.includes(threadId));

  // BB returns the feed in pages; walk back by cursor while older rows exist.
  const allRows = async (threadId: string) => {
    let rows: Row[] = [];
    let query: { threadId: string; includeNestedRows: "true"; beforeAnchorId?: string; beforeAnchorSeq?: string } = { threadId, includeNestedRows: "true" };
    for (let page = 0; page < MAX_PAGES; page++) {
      const timeline = await bb.sdk.threads.timeline(query);
      rows = [...(timeline.rows as Row[]), ...rows];
      const cursor = timeline.timelinePage.olderCursor;
      if (!timeline.timelinePage.hasOlderRows || !cursor) break;
      query = { threadId, includeNestedRows: "true", beforeAnchorId: cursor.anchorId, beforeAnchorSeq: String(cursor.anchorSeq) };
    }
    return flatten(rows);
  };

  // Thread ids in the texts become links with the thread's title. Titles are read once per thread and kept in threadCache.
  const linker = async (texts: string[], extra: string[] = []) => {
    const needed = new Set(extra);
    for (const t of texts) for (const m of t.matchAll(MENTION_RE)) if (m[2]) needed.add(m[2]);
    await Promise.all([...needed].filter(isStale).map(async id => {
      try {
        const t = await bb.sdk.threads.get({ threadId: id });
        threadCache.set(id, { title: t.title || t.titleFallback || id, href: `/projects/${t.projectId}/threads/${id}`, at: Date.now(), archived: t.archivedAt != null });
      } catch { threadCache.set(id, { at: Date.now(), failed: true }); }
    }));
    return (text: string) => text.replace(MENTION_RE, (m, skip, thr, _task, key) => {
      if (skip) return skip;
      if (thr) {
        const info = threadCache.get(thr);
        return info?.title && info.href ? `[${esc(info.title)}](${info.href})` : m;
      }
      if (key) return `[${key}](/plugins/tasks/tasks/task/${key})`;
      return m;
    });
  };

  const compute = async (threadId: string): Promise<Feed> => {
    if (!inScope(threadId)) return { hideIds: [], items: [], closed: {} };
    const strings = STRINGS[lang];
    const isBg = isBgWith(marker);
    const rows = await allRows(threadId);
    const notices = rows.filter(r => notification(r) || toolOf(r) !== null);
    // A turn is running while the thread is busy; its last turn is left alone so the reply in progress stays visible.
    const busy = BUSY.includes((await bb.sdk.threads.get({ threadId })).status);
    const running = busy ? [...rows].reverse().find(r => r.turnId)?.turnId : null;
    const replies = rows.filter(r => isBg(r) && !!r.turnId && r.turnId !== running);
    const hideIds = [...new Set([...notices, ...replies].map(r => r.id))];
    // The reply to a notification is the first marked reply after it, before the next message from a person.
    const noticeIds = new Set(notices.map(r => r.id));
    const bgIds = new Set(rows.filter(isBg).map(r => r.id));
    const replyOf = new Map<string, string>();
    const replyAt = new Map<string, number>();
    const attached = new Set<string>();
    let owner: string | null = null;
    for (const r of rows) {
      if (r.kind === "conversation" && r.role === "user") owner = noticeIds.has(r.id) ? r.id : null;
      else if (owner && bgIds.has(r.id)) { replyOf.set(owner, r.text ?? ""); replyAt.set(owner, r.createdAt ?? r.startedAt ?? 0); attached.add(r.id); owner = null; }
    }
    // Entry kinds go to the app as codes; the app shows them in the chosen language. An unknown system title is passed as is.
    const KINDS: Record<string, string> = {
      "child-completed": "done", "child-failed": "failed", "child-interrupted": "interrupted",
      "child-stopped": "interrupted", "child-needs-attention": "attention", "child-question": "attention",
      "child-outcome-batch": "digest",
    };
    const translateSystem = (text: string) => strings.systemTexts.reduce((out, [from, to]) => out.replace(from, to), text);
    const noticeItems = notices.map(r => {
      // A tool notice: the name is both the badge and the sender, the header line is not shown.
      // It has no sending thread, so it is never glued into a "done" card.
      const tool = toolOf(r);
      if (tool !== null) return {
        id: r.id, time: r.createdAt ?? r.startedAt ?? 0,
        sender: tool, senderThreadId: null, kind: "notify",
        text: (r.text ?? "").replace(NOTIFY_RE, ""),
        reply: replyOf.get(r.id) ?? "",
        replyAt: replyAt.get(r.id) ?? r.createdAt ?? r.startedAt ?? 0,
        parts: [] as Part[],
      };
      const senderThreadId = r.senderThreadId ?? r.systemMessageSubject?.threadId ?? r.text?.match(/@thread:(thr_[\w-]+)/)?.[1] ?? null;
      const rawKind = r.systemMessageKind && r.systemMessageKind !== "unlabeled" ? r.systemMessageKind : r.kind === "system" ? (r.title ?? "system") : "message";
      const rawText = r.text ?? [r.title, r.detail].filter(Boolean).join("\n");
      return {
        id: r.id, time: r.createdAt ?? r.startedAt ?? 0,
        sender: r.senderThreadId ?? r.systemMessageSubject?.threadName ?? r.systemMessageSubject?.threadId ?? strings.system,
        senderThreadId,
        kind: KINDS[rawKind] ?? rawKind,
        text: r.kind === "system" || /^child-(?!completed)/.test(r.systemMessageKind ?? "") ? translateSystem(clean(rawText)) : clean(rawText),
        reply: replyOf.get(r.id) ?? "",
        replyAt: replyAt.get(r.id) ?? r.createdAt ?? r.startedAt ?? 0,
        parts: [] as Part[],
      };
    });
    const orphanItems = replies.filter(r => !attached.has(r.id)).map(r => ({
      id: r.id, time: r.createdAt ?? r.startedAt ?? 0,
      sender: strings.agent,
      senderThreadId: null,
      kind: "reply",
      text: r.text ?? "",
      reply: "",
      replyAt: r.createdAt ?? r.startedAt ?? 0,
      parts: [] as Part[],
    }));
    const rawItems = glue([...noticeItems, ...orphanItems]);
    const senders = [...new Set(rawItems.flatMap(it => it.senderThreadId ? [it.senderThreadId] : []))];
    const sub = await linker(rawItems.flatMap(it => [it.text, it.reply, ...it.parts.map(part => part.text)]), senders);
    const items = rawItems.map(it => {
      const info = it.senderThreadId ? threadCache.get(it.senderThreadId) : null;
      const senderTitle = info?.title ?? null;
      return { ...it, senderTitle, text: sub(it.text), reply: sub(it.reply), parts: it.parts.map(part => ({ ...part, text: sub(part.text) })) };
    });
    const closed: Feed["closed"] = {};
    for (const id of senders) {
      const info = threadCache.get(id);
      if (info?.failed) closed[id] = "gone";
      else if (info?.archived) closed[id] = "archived";
    }
    return { hideIds, items, closed };
  };

  // The agent's own messages to a peer thread are not rows of this thread's feed: here they are only shell commands.
  // In the peer's feed each of them is a message row with this thread as the sender, so they are read from there.
  const talkMemo = new Map<string, { at: number; value: Promise<{ ok: boolean; out: { id: string; time: number; text: string }[] }> }>();
  const talkOf = (threadId: string, peerId: string) => {
    const key = `${threadId}|${peerId}`;
    const hit = talkMemo.get(key);
    if (hit && Date.now() - hit.at < TALK_MEMO_MS) return hit.value;
    const value = (async () => {
      if (!inScope(threadId)) return { ok: true, out: [] };
      try {
        const rows = (await allRows(peerId)).filter(r => r.kind === "conversation" && r.role === "user" && r.senderThreadId === threadId);
        const texts = rows.map(r => clean(r.text ?? ""));
        const sub = await linker(texts);
        return { ok: true, out: rows.map((r, index) => ({ id: r.id, time: r.createdAt ?? r.startedAt ?? 0, text: sub(texts[index]) })) };
      } catch { return { ok: false, out: [] }; }
    })();
    talkMemo.set(key, { at: Date.now(), value });
    return value;
  };

  // Several windows may poll the same thread at once: one read per thread within MEMO_MS.
  const memo = new Map<string, { at: number; value: Promise<Feed> }>();
  const rowsOf = (threadId: string) => {
    const hit = memo.get(threadId);
    if (hit && Date.now() - hit.at < MEMO_MS) return hit.value;
    const value = compute(threadId);
    memo.set(threadId, { at: Date.now(), value });
    return value;
  };
  settings.onChange(next => { scope = scopeOf(next.threads); hide = next.hide; lang = langOf(next.language); marker = next.marker.trim(); memo.clear(); });
  // The viewed mark lives in the plugin's own storage, per thread, and survives a window reload.
  // Until a thread's tab is opened, the count starts at the first run of the plugin: older entries are not new.
  const kv = bb.storage.kv;
  let since = await kv.get<number>("since");
  if (typeof since !== "number") { since = Date.now(); await kv.set("since", since); }
  const fallback = since;
  let writes: Promise<unknown> = Promise.resolve();
  const sentOf = async (threadId: string) => z.array(sentSchema).catch([]).parse(await kv.get(`sent:${threadId}`));
  bb.rpc.register(rpcContract, {
    feed: async ({ threadId }) => ({
      ...(await rowsOf(threadId)), seenAt: (await kv.get<number>(`seen:${threadId}`)) ?? fallback, lang, marker, hide,
      view: z.enum(VIEWS).catch("time").parse(await kv.get(`view:${threadId}`)), sent: await sentOf(threadId),
    }),
    view: async ({ threadId, view }) => { await kv.set(`view:${threadId}`, view); return { view }; },
    talk: ({ threadId, peerId }) => talkOf(threadId, peerId),
    // The newest page of the peer's feed is enough: the message was sent seconds ago. A queued message is not
    // in the feed yet, so "not found" does not mean "not sent".
    delivered: async ({ threadId, peerId, text, since }) => {
      if (!inScope(threadId)) return { found: false };
      try {
        const rows = flatten((await bb.sdk.threads.timeline({ threadId: peerId, includeNestedRows: "true" })).rows as Row[]);
        return { found: rows.some(r => r.kind === "conversation" && r.role === "user" && !r.senderThreadId && (r.createdAt ?? r.startedAt ?? 0) >= since - CLOCK_SLACK_MS && r.text?.trim() === text.trim()) };
      } catch { return { found: false }; }
    },
    // The message itself is sent by the app with the user's own session; here it is only remembered for the conversation.
    sent: ({ threadId, ...message }) => {
      const next = writes.then(async () => {
        const saved = await sentOf(threadId);
        if (saved.some(it => it.id === message.id)) return { sent: saved };
        // A message older than everything kept does not fit: it is not stored and does not push a newer one out.
        const sent: Sent[] = lastSent([...saved, message]);
        if (!sent.some(it => it.id === message.id)) return { sent: saved };
        await kv.set(`sent:${threadId}`, sent);
        return { sent };
      });
      writes = next.catch(() => {});
      return next;
    },
    // The mark only moves forward: a late request with an older time does not roll it back.
    // Writes are queued, otherwise two concurrent requests would read the same old value.
    seen: ({ threadId, at }) => {
      const next = writes.then(async () => {
        const key = `seen:${threadId}`;
        const saved = (await kv.get<number>(key)) ?? fallback;
        const seenAt = Math.max(saved, Math.min(at, Date.now()));
        if (seenAt > saved) await kv.set(key, seenAt);
        return { seenAt };
      });
      writes = next.catch(() => {});
      return next;
    },
  });
  // No marker — no instruction: the plugin then adds nothing to the agents' prompt.
  bb.agents.contributeInstructions(ctx => marker && inScope(ctx.threadId) ? STRINGS[lang].instruction(marker) : null);
}
