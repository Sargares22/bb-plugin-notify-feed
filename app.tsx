import { Markdown, ThreadTitle, definePluginApp, useBbContext, useBbNavigate, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { rpcContract } from "./server";
import { MAX_TEXT, STRINGS, lastSent, type Lang } from "./i18n.ts";
import "./app.css";

type Item = { id: string; time: number; sender: string; senderThreadId?: string | null; senderTitle?: string | null; kind: string; text: string; reply: string; replyAt?: number; parts: { kind: "message" | "reply"; text: string; time?: number }[] };
type View = "time" | "threads";
type Sent = { id: string; to: string; text: string; time: number };
// lang is absent until the first server answer: nothing language-dependent is drawn before it.
// stale — the last FAILS_TO_UNHIDE polls failed: the cards stay as they were, but nothing is hidden in the main feed.
type Data = { hideIds: string[]; items: Item[]; closed?: Record<string, "archived" | "gone">; seenAt?: number; lang?: Lang; marker?: string; hide?: boolean; view?: View; sent?: Sent[]; stale?: boolean };
type Strings = (typeof STRINGS)[Lang];

// Language of the last server answer: the panel action opened from the "+" menu has no data of its own yet.
let lastLang: Lang = "en";

// One poll per thread for the whole window: the overlay, the header button and the tab subscribe to the same store.
// The poll starts with the first subscriber and stops with the last one. Every answer is a new object, so subscribers see each poll.
// A failed poll must not keep rows hidden on old data: after FAILS_TO_UNHIDE failures in a row the hiding is lifted
// until the next good answer. One lost request on a busy machine changes nothing, so the feed does not flicker.
const POLL_MS = 8000;
const FAILS_TO_UNHIDE = 2;
const EMPTY: Data = { hideIds: [], items: [] };
type Call = ReturnType<typeof useRpc<typeof rpcContract>>["call"];
type Store = { data: Data; listeners: Set<() => void>; timer: number; fails: number };
const stores = new Map<string, Store>();

function subscribeFeed(threadId: string, call: Call, listener: () => void) {
  let store = stores.get(threadId);
  if (!store) {
    const created: Store = { data: EMPTY, listeners: new Set(), timer: 0, fails: 0 };
    const refresh = () => void call("feed", { threadId }).then(value => {
      if (stores.get(threadId) !== created) return;
      lastLang = value.lang;
      created.fails = 0;
      created.data = value;
      created.listeners.forEach(notify => notify());
    }).catch(() => {
      if (stores.get(threadId) !== created || ++created.fails !== FAILS_TO_UNHIDE) return;
      created.data = { ...created.data, stale: true };
      created.listeners.forEach(notify => notify());
    });
    refresh();
    created.timer = window.setInterval(refresh, POLL_MS);
    stores.set(threadId, created);
    store = created;
  }
  const joined = store;
  joined.listeners.add(listener);
  return () => {
    joined.listeners.delete(listener);
    if (joined.listeners.size || stores.get(threadId) !== joined) return;
    window.clearInterval(joined.timer);
    stores.delete(threadId);
  };
}

function useFeed(threadId: string | null) {
  const { call } = useRpc<typeof rpcContract>();
  const subscribe = useCallback((listener: () => void) => threadId ? subscribeFeed(threadId, call, listener) : () => {}, [call, threadId]);
  return useSyncExternalStore(subscribe, () => (threadId ? stores.get(threadId)?.data : null) ?? EMPTY);
}

// A BB feed row is a wrapper with data-timeline-row-id. In the plain feed the row leaves the flow.
// In the virtual feed (20+ rows) the virtualizer takes the row height from a measurement: display:none there
// keeps the old height and leaves a gap, so the row shrinks to 1px and its content is hidden.
function hideCss(ids: string[]) {
  const row = (id: string) => `[data-timeline-row-id=${JSON.stringify(id)}]`;
  const flow = ids.map(id => `${row(id)}:not([data-timeline-windowed-realized])`).join(",\n");
  const box = ids.map(id => `${row(id)}[data-timeline-windowed-realized]`).join(",\n");
  const inner = ids.map(id => `${row(id)}[data-timeline-windowed-realized]>*`).join(",\n");
  return `${flow}{display:none!important}\n${box}{height:1px!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;overflow:hidden!important}\n${inner}{display:none!important}`;
}

// App overlay: hides rows of the main feed unless the "hide" setting is off. The button sits in the thread header because openThreadPanel works only inside a thread surface.
function Overlay() {
  const { threadId } = useBbContext();
  const { hideIds, hide, stale } = useFeed(threadId);
  return hide && !stale && hideIds.length > 0 ? <style>{hideCss(hideIds)}</style> : null;
}

// The server keeps the time of the last view. The local copy lets the header button drop "new" at once, without waiting for a poll.
const seenLocal = new Map<string, number>();
const seenListeners = new Set<() => void>();
const subscribeSeen = (listener: () => void) => { seenListeners.add(listener); return () => { seenListeners.delete(listener); }; };

function Trigger({ threadId }: { threadId: string }) {
  const { openThreadPanel } = useBbNavigate();
  const { items, seenAt, lang } = useFeed(threadId);
  const local = useSyncExternalStore(subscribeSeen, () => seenLocal.get(threadId) ?? 0);
  if (!items.length || !lang) return null;
  const t = STRINGS[lang];
  const seen = Math.max(seenAt ?? Infinity, local);
  const fresh = items.filter(item => item.time > seen).length;
  return <button type="button" className="nf-trigger" data-new={fresh || undefined} onClick={() => openThreadPanel({ actionId: "feed", title: t.title })}>{t.button(fresh ? t.fresh(fresh) : items.length)}</button>;
}

// The reply marker is a service prefix: cards show the text without it. No marker — the text is shown as is.
const stripOf = (marker: string) => {
  if (!marker) return (text: string) => text;
  const found = new RegExp(`(^|\\n)[ \\t]*${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*`, "g");
  return (text: string) => text.replace(found, "$1");
};
const groupOf = (item: Item) => item.kind === "done" ? "done" : ["interrupted", "failed", "attention"].includes(item.kind) ? "attention" : "info";
const toneOf = (kind: string) => kind === "done" ? "ok" : kind === "failed" ? "bad" : kind === "interrupted" || kind === "attention" ? "warn" : "plain";
const ICONS: Record<string, string> = { ok: "m7 12.5 3.5 3.5L17 9", warn: "M12 6v8m0 3.5v.5", bad: "m7.5 7.5 9 9m0-9-9 9", plain: "M12 11.5v1" };
// Kinds without a color of their own get their own icon: a speech bubble, digest lines, a reply arrow.
const KIND_ICONS: Record<string, string> = { message: "M6 7h12v8h-6l-3 3v-3H6z", notify: "M6 7h12v8h-6l-3 3v-3H6z", digest: "M7 8h10M7 12h10M7 16h6", reply: "m10 8-4 4 4 4M6 12h8a4 4 0 0 1 4 4v1" };
const FILTERS = ["all", "done", "attention", "info"] as const;
const dayText = (date: Date, t: Strings) => {
  const day = new Date();
  const label = date.toLocaleDateString(t.locale, { day: "numeric", month: "long" });
  if (date.toDateString() === day.toDateString()) return `${t.today}, ${label}`;
  day.setDate(day.getDate() - 1);
  return date.toDateString() === day.toDateString() ? `${t.yesterday}, ${label}` : label;
};

// The collapsed text is plain text without markup: it comes from an invisible render of the same Markdown (innerText puts spaces between cells and blocks).
// The render is made only for cards near the visible area and is removed as soon as the text is read;
// the result lives in the card itself, there is no shared cache. Until then the card holds the source text in one line.
function Snippet({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [plain, setPlain] = useState<string | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = box.current;
    if (!node || plain !== null) return;
    // The root is the scrolling ancestor: the 600px margin is counted from it, so the text is ready before the card scrolls in.
    let root = node.parentElement;
    while (root && !/auto|scroll/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setNear(true); }, { root, rootMargin: "600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [plain]);
  useEffect(() => {
    const node = probe.current;
    if (!node) return;
    // Markdown may finish drawing in several passes: the text is taken once drawing has settled.
    let timer = 0;
    const settle = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { const next = node.innerText.replace(/\s+/g, " ").trim(); if (next) setPlain(next); }, 120);
    };
    settle();
    const observer = new MutationObserver(settle);
    observer.observe(node, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, [near]);
  return <>
    <div className="nf-snippet" ref={box} data-plain={plain !== null || undefined}>{plain ?? text.replace(/\s+/g, " ").trim()}</div>
    {near && plain === null && <div className="nf-probe" aria-hidden="true" inert ref={probe}><Markdown content={text} /></div>}
  </>;
}

function Card({ item, fresh, t, textOf }: { item: Item; fresh: boolean; t: Strings; textOf: (text: string) => string }) {
  const { toThread } = useBbNavigate();
  const [open, setOpen] = useState(false);
  const tone = toneOf(item.kind);
  // A tool notice carries the tool's name as its badge.
  const kind = item.kind === "notify" ? item.sender : kindText(item.kind, t);
  const date = new Date(item.time);
  const text = textOf(item.text);
  const reply = textOf(item.reply);
  const threadId = item.senderThreadId;
  return <article className={`nf-card nf-${tone}`} data-open={open || undefined}>
    <span className="nf-marker" aria-hidden="true"><svg viewBox="0 0 24 24"><path d={KIND_ICONS[item.kind] ?? ICONS[tone]} /></svg></span>
    <div className="nf-sum" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(!open)}
      onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setOpen(!open); } }}>
      <div className="nf-head">
        {fresh && <i className="nf-new" role="img" aria-label={t.isNew} title={t.isNew} />}
        <time dateTime={date.toISOString()} title={date.toLocaleString(t.locale, { dateStyle: "long", timeStyle: "short" })}>{date.toLocaleTimeString(t.locale, { hour: "2-digit", minute: "2-digit" })}</time>
        <b className="nf-kind">{kind}</b>
        {threadId
          ? <button type="button" className="nf-source" title={item.senderTitle || item.sender} onClick={event => { event.stopPropagation(); toThread(threadId); }}><ThreadTitle threadId={threadId} /></button>
          : <span className="nf-source" title={item.sender} />}
        <span className="nf-tail">
          {(reply || item.parts.some(part => part.kind === "reply")) && <span className="nf-reply-tag" title={t.hasReply}>{t.replyTag}</span>}
          <span className="nf-expand">{open ? t.less : t.more}</span>
        </span>
      </div>
      {!open && <Snippet key={text} text={text} />}
    </div>
    {open && <div className="nf-body">
      <Markdown content={text} />
      {item.parts.map((part, index) => part.kind === "message"
        ? <div className="nf-reply nf-message" key={index}><b>{t.threadMessage}</b><Markdown content={textOf(part.text)} /></div>
        : <div className="nf-reply" key={index}><b>{t.agentReply}</b><Markdown content={textOf(part.text)} /></div>)}
      {reply && <div className="nf-reply"><b>{t.agentReply}</b><Markdown content={reply} /></div>}
    </div>}
  </article>;
}

// The by-thread view. A group is everything one sender wrote, newest entry first. Entries without a sending thread
// (a tool notice, a lone agent reply) are grouped by the sender's name and get a row of their own.
type Group = { key: string; threadId: string | null; name: string; items: Item[] };
const groupsOf = (items: Item[]) => {
  const groups = new Map<string, Group>();
  for (const item of items) {
    const key = item.senderThreadId ?? `name:${item.sender}`;
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { key, threadId: item.senderThreadId ?? null, name: item.senderTitle || item.sender, items: [item] });
  }
  return [...groups.values()];
};
// A conversation is the group's entries in time order, old to new: what the thread sent, what the agent replied or
// sent on its own (out), how each of the thread's turns ended (state), and what the user wrote from the tab (sent).
type Entry = { id: string; time: number; who: "thread" | "agent" | "you" | "state"; kind?: string; text: string };
const entriesOf = (group: Group, out: { id: string; time: number; text: string }[], sent: Sent[]) => {
  const list: Entry[] = [];
  for (const item of [...group.items].reverse()) {
    item.parts.forEach((part, index) => list.push({ id: `${item.id}:${index}`, time: part.time ?? item.time, who: part.kind === "message" ? "thread" : "agent", text: part.text }));
    list.push({ id: item.id, time: item.time, who: item.kind === "message" || item.kind === "notify" ? "thread" : item.kind === "reply" ? "agent" : "state", kind: item.kind, text: item.text });
    if (item.reply) list.push({ id: `${item.id}:reply`, time: item.replyAt ?? item.time, who: "agent", text: item.reply });
  }
  // A thread that writes to itself has the same row on both sides: it is shown once.
  const known = new Set(list.map(entry => entry.id));
  for (const message of out) if (!known.has(message.id)) list.push({ ...message, who: "agent" });
  for (const message of sent) if (message.to === group.threadId) list.push({ id: message.id, time: message.time, who: "you", text: message.text });
  return list.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.time - b.entry.time || a.index - b.index).map(({ entry }) => entry);
};
const kindText = (kind: string, t: Strings) => t.kinds[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
// Today's entries show the time only; older ones show the day too.
const whenText = (date: Date, t: Strings) => {
  const time = date.toLocaleTimeString(t.locale, { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString(t.locale, { day: "numeric", month: "short" })} ${time}`;
};
// The server answered and said no: the message was certainly not sent. BB's client marks such an error with the
// HTTP status and BB's own answer body. Anything else — a dropped connection, a timeout, a gateway's page instead
// of BB's answer — leaves the outcome unknown.
const refused = (error: unknown) => {
  const info = error as { name?: unknown; status?: unknown; body?: unknown } | null;
  return info?.name === "BbHttpError" && typeof info.status === "number" && typeof info.body === "object" && info.body !== null;
};
// How long to wait before asking the peer's feed about a message whose outcome is unknown.
const CONFIRM_MS = 1500;
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/[.\s]+$/, "").slice(0, 200);

function ThreadRow({ group, count, t, textOf, onOpen }: { group: Group; count: number; t: Strings; textOf: (text: string) => string; onOpen: () => void }) {
  const last = group.items[0];
  const date = new Date(last.time);
  const text = textOf(last.text);
  return <div className={`nf-trow nf-${toneOf(last.kind)}`} role="button" tabIndex={0} onClick={onOpen}
    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}>
    <i className="nf-dot" aria-hidden="true" />
    <div className="nf-trow-main">
      <b title={group.name}>{group.name}</b>
      <div className="nf-trow-last">
        <time dateTime={date.toISOString()}>{whenText(date, t)}</time>
        {last.kind !== "notify" && <span>{kindText(last.kind, t)}</span>}
        <Snippet key={text} text={text} />
      </div>
    </div>
    <span className="nf-count" title={t.entries(count)}>{count}</span>
  </div>;
}

// The field under a conversation. The message goes to the peer thread with the user's own session, the same way
// BB's composer sends it. With the note on, a short notice then goes to this thread's agent under the [notify:You]
// header, so it lands in the tab and not in the feed. BB has no delivery without a turn: the note starts the agent's turn.
function Reply({ threadId, peerId, title, t, onSent }: { threadId: string; peerId: string; title: string; t: Strings; onSent: (message: Sent) => void }) {
  const sdk = useSdk();
  const { call } = useRpc<typeof rpcContract>();
  const [text, setText] = useState("");
  const [note, setNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A message over the limit is not sent at all: the reason is under the field while the text is too long.
  const length = text.trim().length;
  const problem = length > MAX_TEXT ? t.tooLong(length, MAX_TEXT) : error;
  const submit = async () => {
    const body = text.trim();
    if (!body || busy || body.length > MAX_TEXT) return;
    setBusy(true);
    setError("");
    const send = (to: string, content: string) => sdk.threads.send({ threadId: to, mode: "auto", input: [{ type: "text", text: content, mentions: [] }] });
    const since = Date.now();
    // A failed request is not always an undelivered message: the answer may have been lost after BB accepted it.
    // BB has no idempotency key, so a repeat would be a second message and a second turn. When the outcome is
    // unknown, the peer's feed is asked whether the message is there; if it is not found either, the user is told
    // to look before repeating, and nothing is repeated here.
    let failure: unknown = null;
    await send(peerId, body).catch(reason => { failure = reason ?? new Error("unknown"); });
    if (failure && !refused(failure)) {
      await new Promise(done => setTimeout(done, CONFIRM_MS));
      const found = await call("delivered", { threadId, peerId, text: body, since }).then(value => value.found).catch(() => false);
      if (!found) { setError(t.maybeSent); setBusy(false); return; }
      failure = null;
    }
    if (failure) { setError(t.sendFailed(reasonOf(failure))); setBusy(false); return; }
    onSent({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, to: peerId, text: body, time: Date.now() });
    setText("");
    if (note) await send(threadId, `[notify:You]\n${t.noteText(title, body)}`).catch(reason => setError(refused(reason) ? t.noteFailed(reasonOf(reason)) : t.noteUnknown));
    setBusy(false);
  };
  return <form className="nf-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <div className="nf-send">
      <textarea rows={1} value={text} readOnly={busy} aria-label={t.replyLabel} placeholder={t.replyPlaceholder} aria-invalid={!!problem || undefined}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
      <button type="submit" disabled={busy || !length || length > MAX_TEXT} aria-busy={busy || undefined}>{busy ? t.sending : t.send}</button>
    </div>
    {problem && <p className="nf-error" role="alert">{problem}</p>}
    <label className="nf-note"><input type="checkbox" checked={note} onChange={event => setNote(event.target.checked)} /><span>{t.noteLabel}</span></label>
    <p className="nf-hint">{t.noteHint}</p>
  </form>;
}

function Talk({ threadId, group, closed, sent, shown, tick, t, textOf, onSent, onBack }: { threadId: string; group: Group; closed?: "archived" | "gone"; sent: Sent[]; shown: boolean; tick: unknown; t: Strings; textOf: (text: string) => string; onSent: (message: Sent) => void; onBack: () => void }) {
  const { call } = useRpc<typeof rpcContract>();
  const peerId = group.threadId;
  // Re-read with every poll answer (tick); the server reads the peer's feed at most once per its own interval.
  // Only while the conversation is on screen: a hidden panel reads nothing and catches up when it is shown again.
  const [talk, setTalk] = useState<{ ok: boolean; out: { id: string; time: number; text: string }[] }>({ ok: true, out: [] });
  useEffect(() => {
    if (!peerId || !shown) return;
    let live = true;
    void call("talk", { threadId, peerId }).then(value => { if (live) setTalk(value); }).catch(() => { if (live) setTalk(value => ({ ...value, ok: false })); });
    return () => { live = false; };
  }, [call, threadId, peerId, shown, tick]);
  const entries = entriesOf(group, talk.out, sent);
  // The list scrolls on its own between the title and the field, and opens at the newest entry: the outer box is
  // a reversed column, so its scroll starts at the end and stays there while entries are drawn or added.
  return <>
    <header className="nf-bar">
      <button type="button" onClick={onBack}>{`← ${t.back}`}</button>
      <b title={group.name}>{group.name}</b>
    </header>
    <div className="nf-scroll"><div className="nf-talk">{entries.map(entry => {
      const date = new Date(entry.time);
      const who = entry.who === "state" ? kindText(entry.kind ?? "", t) : entry.who === "you" ? t.you : entry.who === "agent" ? t.agent : peerId ? t.thread : group.name;
      return <div className={`nf-msg nf-${entry.who === "state" ? toneOf(entry.kind ?? "") : "plain"}`} data-who={entry.who} key={entry.id}>
        <div className="nf-msg-head"><b>{who}</b><time dateTime={date.toISOString()}>{whenText(date, t)}</time></div>
        <Markdown content={textOf(entry.text)} />
      </div>;
    })}</div></div>
    {!talk.ok && <p className="nf-hint">{t.outFailed}</p>}
    <div className="nf-foot">
      {peerId && !closed
        ? <Reply threadId={threadId} peerId={peerId} title={group.name} t={t} onSent={onSent} />
        : <p className="nf-hint">{peerId ? t.closed[closed ?? "gone"] : t.closed.none}</p>}
    </div>
  </>;
}

function Panel({ threadId }: { threadId: string }) {
  return <Feed key={threadId} threadId={threadId} />;
}

function Feed({ threadId }: { threadId: string }) {
  const { call } = useRpc<typeof rpcContract>();
  const data = useFeed(threadId);
  const { items, seenAt, lang, marker = "" } = data;
  const textOf = useMemo(() => stripOf(marker), [marker]);
  const [filter, setFilter] = useState<string>("all");
  // BB hides the right panel without unmounting the tab: "open" means "visible on screen".
  const root = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => setShown(entries[entries.length - 1].isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // Dots are counted from the view that preceded this showing of the tab; the showing itself moves the mark to the latest entry.
  const [before, setBefore] = useState<number | null>(null);
  const newest = items[0]?.time ?? 0;
  // Runs when the tab is shown and on every poll answer (data is a new object). The header button resets at once,
  // and the write to the server repeats with every poll until it returns the saved mark: a failed write is not lost.
  useEffect(() => {
    if (!shown) { setBefore(null); return; }
    if (seenAt === undefined) return;
    const was = Math.max(seenAt, seenLocal.get(threadId) ?? 0);
    setBefore(value => value ?? was);
    if (newest <= seenAt) return;
    seenLocal.set(threadId, Math.max(newest, seenLocal.get(threadId) ?? 0));
    seenListeners.forEach(listener => listener());
    void call("seen", { threadId, at: newest }).catch(() => {});
  }, [call, threadId, shown, data]);
  // The chosen view is kept on the server per thread; the local choice applies at once, without waiting for a poll.
  const [picked, setPicked] = useState<View | null>(null);
  const view = picked ?? data.view ?? "time";
  const [peer, setPeer] = useState<string | null>(null);
  // What the user sent from this tab: shown at once, and written to the server with every poll until it is saved there.
  const [mine, setMine] = useState<Sent[]>([]);
  // The order of the user's messages is the order of sending: the list is kept by time, and a new message always
  // gets a time later than the last one, even when two are sent within one clock tick.
  // The same rule trims the list here and in the storage. A message the server has once accepted is never written
  // again: when the storage later drops it as the oldest, a repeated write would bring it back in place of a newer one.
  const sent = useMemo(() => lastSent([...(data.sent ?? []), ...mine]), [data.sent, mine]);
  const accepted = useRef(new Set<string>());
  useEffect(() => {
    for (const message of mine) {
      if (accepted.current.has(message.id) || data.sent?.some(saved => saved.id === message.id)) continue;
      void call("sent", { threadId, ...message }).then(() => { accepted.current.add(message.id); }).catch(() => {});
    }
  }, [call, threadId, data, mine]);
  if (!lang) return <div className="nf-panel" ref={root} />;
  const t = STRINGS[lang];
  if (!items.length) return <div className="nf-panel" ref={root}><p className="nf-empty">{t.empty}</p></div>;
  const groups = groupsOf(items);
  const talking = view === "threads" ? groups.find(group => group.key === peer) : undefined;
  if (talking) return <div className="nf-panel nf-chat" ref={root}>
    <Talk key={talking.key} threadId={threadId} group={talking} closed={talking.threadId ? data.closed?.[talking.threadId] : undefined} sent={sent} shown={shown} tick={data} t={t} textOf={textOf}
      onSent={message => setMine(list => lastSent([...list, { ...message, time: Math.max(message.time, (sent.at(-1)?.time ?? 0) + 1) }]))} onBack={() => setPeer(null)} />
  </div>;
  // By thread, the filter picks threads by the state of their latest entry.
  const visible = items.filter(item => filter === "all" || groupOf(item) === filter);
  const threads = groups.filter(group => filter === "all" || groupOf(group.items[0]) === filter);
  const countOf = (id: string) => view === "threads"
    ? (id === "all" ? groups.length : groups.filter(group => groupOf(group.items[0]) === id).length)
    : (id === "all" ? items.length : items.filter(item => groupOf(item) === id).length);
  const days = new Map<string, Item[]>();
  for (const item of visible) {
    const key = new Date(item.time).toDateString();
    days.set(key, [...(days.get(key) ?? []), item]);
  }
  const pick = (next: View) => { setPicked(next); setPeer(null); void call("view", { threadId, view: next }).catch(() => {}); };
  return <div className="nf-panel" ref={root}>
    <header className="nf-top">
      <nav aria-label={t.filtersLabel}>{FILTERS.map(id => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
        {t.filters[id]} <b>{countOf(id)}</b>
      </button>)}</nav>
      <div className="nf-views" role="group" aria-label={t.viewsLabel}>{(["time", "threads"] as const).map(id => <button key={id} type="button" aria-pressed={view === id} onClick={() => pick(id)}>{t.views[id]}</button>)}</div>
    </header>
    {view === "threads" ? <>
      {!threads.length && <p className="nf-empty">{t.emptyThreads}</p>}
      <div className="nf-threads">{threads.map(group => <ThreadRow key={group.key} group={group} count={entriesOf(group, [], sent).length} t={t} textOf={textOf} onOpen={() => setPeer(group.key)} />)}</div>
    </> : <>
      {!visible.length && <p className="nf-empty">{t.emptyFilter}</p>}
      {[...days].map(([key, dayItems]) => <section className="nf-day" key={key}>
        <h2><span>{dayText(new Date(dayItems[0].time), t)}</span><small>{dayItems.length}</small></h2>
        <div className="nf-stream">{dayItems.map(item => <Card key={item.id} item={item} fresh={before !== null && item.time > before} t={t} textOf={textOf} />)}</div>
      </section>)}
    </>}
  </div>;
}

// Slot titles are fixed at registration, so they are English; the tab itself is titled in the chosen language when it opens.
// The tab uses a public slot and is registered first and always. Hiding rows and the header button use experimental
// slots: each is registered only if this BB has it, so a BB without one still gets the tab (from the panel's "+" menu).
export default definePluginApp(app => {
  const slots: Partial<typeof app.slots> = app.slots;
  app.slots.threadPanelAction({ id: "feed", title: STRINGS.en.title, icon: "Bell", component: Panel, run: ({ openPanel }) => { openPanel({ title: STRINGS[lastLang].title }); } });
  slots.experimental_appOverlay?.({ id: "feed-overlay", component: Overlay });
  slots.experimental_threadHeaderAction?.({ id: "feed-trigger", title: STRINGS.en.title, component: Trigger });
});
