// Every user-facing string lives here, one entry per language. No other source file holds translated text.
// Shared by the server (system texts, agent instruction) and the app (tab, button).
export const LANGS = ["en", "ru"] as const;
export type Lang = (typeof LANGS)[number];
export const langOf = (value: unknown): Lang => (value === "ru" ? "ru" : "en");
// The longest message the field under a conversation accepts, in characters. The field, the send and the storage
// use this one number, so a message that was sent can always be stored. It lives here because this is the one module both sides load.
export const MAX_TEXT = 20_000;
// How many of the user's own messages are kept per thread, and the one rule for which: the newest by time, each id once.
// The app applies it to what it shows and the server to what it stores, so a message dropped on one side is dropped on the other.
export const MAX_SENT = 300;
export const lastSent = <T extends { id: string; time: number }>(list: T[]): T[] =>
  [...new Map(list.map(message => [message.id, message])).values()]
    .map((message, index) => ({ message, index })).sort((a, b) => a.message.time - b.message.time || a.index - b.index)
    .slice(-MAX_SENT).map(({ message }) => message);

type Strings = {
  locale: string;
  title: string;
  button: (count: number | string) => string;
  fresh: (n: number) => string;
  // Labels of the entry kinds the server sends as codes; an unknown kind is shown as is.
  kinds: Record<string, string>;
  filters: { all: string; done: string; attention: string; info: string };
  filtersLabel: string;
  today: string;
  yesterday: string;
  isNew: string;
  hasReply: string;
  replyTag: string;
  more: string;
  less: string;
  threadMessage: string;
  agentReply: string;
  empty: string;
  emptyFilter: string;
  // Sender names for entries that have no sending thread.
  system: string;
  agent: string;
  // The by-thread view: the switch, the thread list and one thread's conversation.
  views: { time: string; threads: string };
  viewsLabel: string;
  entries: (n: number) => string;
  emptyThreads: string;
  back: string;
  thread: string;
  you: string;
  outFailed: string;
  // Replying to a thread from the tab.
  replyLabel: string;
  replyPlaceholder: string;
  send: string;
  sending: string;
  sendFailed: (reason: string) => string;
  tooLong: (length: number, max: number) => string;
  // The request failed without an answer from BB and the message is not in the thread's feed: it may still arrive.
  maybeSent: string;
  noteUnknown: string;
  noteLabel: string;
  noteHint: string;
  noteFailed: (reason: string) => string;
  // Body of the note sent to this thread's agent; the [notify:You] header line is added by the app.
  noteText: (title: string, text: string) => string;
  closed: { archived: string; gone: string; none: string };
  instruction: (marker: string) => string;
  // BB's own English system texts and what to show instead. Empty = leave BB's text untouched.
  // A card shows a notice without BB's header line, so the text starts with the predicate ("failed."):
  // English rewrites only that start into a full phrase and leaves the rest of BB's text as it is.
  systemTexts: [RegExp, string][];
  // Shown for a "completed" notice that carries no text of the thread's own. Empty = leave BB's word untouched.
  bareCompleted: string;
};

export const STRINGS: Record<Lang, Strings> = {
  en: {
    locale: "en-US",
    title: "Notifications",
    button: count => `Notifications: ${count}`,
    fresh: n => `${n} new`,
    kinds: { done: "Done", failed: "Failed", interrupted: "Interrupted", attention: "Needs reply", digest: "Digest", message: "Message", reply: "Agent reply", system: "System" },
    filters: { all: "All", done: "Done", attention: "Attention", info: "Info / replies" },
    filtersLabel: "Notification filters",
    today: "Today",
    yesterday: "Yesterday",
    isNew: "New",
    hasReply: "Has an agent reply",
    replyTag: "↩ +reply",
    more: "More",
    less: "Less",
    threadMessage: "Thread message",
    agentReply: "Agent reply",
    empty: "No notifications.",
    emptyFilter: "No entries of this kind.",
    system: "System",
    agent: "Agent",
    views: { time: "By time", threads: "By thread" },
    viewsLabel: "View",
    entries: n => `Entries: ${n}`,
    emptyThreads: "No threads in this state.",
    back: "Threads",
    thread: "Thread",
    you: "You",
    outFailed: "The agent's own messages to this thread could not be read, so some may be missing here.",
    replyLabel: "Message to the thread",
    replyPlaceholder: "Write to this thread…",
    send: "Send",
    sending: "Sending…",
    sendFailed: reason => `Not sent: ${reason}. Your text is kept, try again.`,
    tooLong: (length, max) => `The message is ${length.toLocaleString("en-US")} characters long; the limit is ${max.toLocaleString("en-US")}. Shorten it to send.`,
    maybeSent: "It may have been sent: the connection dropped before BB answered. Check the conversation before you send it again.",
    noteUnknown: "The message was sent. The note to the agent may not have been: the connection dropped before BB answered.",
    noteLabel: "Tell the agent",
    noteHint: "The agent gets a note in its Notifications tab. The note starts its turn.",
    noteFailed: reason => `The message was sent, but the note to the agent was not: ${reason}.`,
    noteText: (title, text) => `wrote to thread ${title}: ${text}`,
    closed: {
      archived: "This thread is archived, so you cannot write to it from here.",
      gone: "This thread is unavailable: it was deleted or cannot be read. You cannot write to it.",
      none: "These entries have no sending thread, so there is nobody to reply to.",
    },
    instruction: marker => `Start a short housekeeping reply to a message from another thread or from the system with ${marker}; a result meant for the user goes without the marker.`,
    systemTexts: [
      [/^\s*failed\.?(?=\s|$)/i, "Failed."],
      [/^\s*was interrupted because\s+/i, "Interrupted: "],
      [/^\s*was interrupted\.?(?=\s|$)/i, "Interrupted."],
    ],
    bareCompleted: "Completed.",
  },
  ru: {
    locale: "ru-RU",
    title: "Уведомления",
    button: count => `Уведомления: ${count}`,
    fresh: n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "новое" : "новых"}`,
    kinds: { done: "Завершил", failed: "Упал", interrupted: "Прерван", attention: "Нужен ответ", digest: "Сводка", message: "Сообщение", reply: "Ответ ведущего", system: "Система" },
    filters: { all: "Все", done: "Завершил", attention: "Внимание", info: "Инфо / ответы" },
    filtersLabel: "Фильтры уведомлений",
    today: "Сегодня",
    yesterday: "Вчера",
    isNew: "Новое",
    hasReply: "С ответом ведущего",
    replyTag: "↩ +ответ",
    more: "Подробнее",
    less: "Свернуть",
    threadMessage: "Сообщение треда",
    agentReply: "Ответ ведущего",
    empty: "Уведомлений нет.",
    emptyFilter: "Нет записей этого вида.",
    system: "Система",
    agent: "Ведущий",
    views: { time: "По времени", threads: "По тредам" },
    viewsLabel: "Вид",
    entries: n => `Записей: ${n}`,
    emptyThreads: "Нет тредов с таким состоянием.",
    back: "Треды",
    thread: "Тред",
    you: "Вы",
    outFailed: "Сообщения ведущего этому треду прочитать не удалось, поэтому здесь могут быть не все.",
    replyLabel: "Сообщение треду",
    replyPlaceholder: "Написать этому треду…",
    send: "Отправить",
    sending: "Отправка…",
    sendFailed: reason => `Не отправлено: ${reason}. Текст сохранён, попробуйте ещё раз.`,
    tooLong: (length, max) => `В сообщении ${length.toLocaleString("ru-RU")} знаков, предел — ${max.toLocaleString("ru-RU")}. Сократите его, чтобы отправить.`,
    maybeSent: "Возможно, отправлено: связь оборвалась раньше ответа BB. Проверьте переписку, прежде чем повторять.",
    noteUnknown: "Сообщение отправлено. Заметка ведущему, возможно, не ушла: связь оборвалась раньше ответа BB.",
    noteLabel: "Сообщить ведущему",
    noteHint: "Ведущий получит заметку во вкладку «Уведомления». Заметка запускает его ход.",
    noteFailed: reason => `Сообщение отправлено, но заметка ведущему не ушла: ${reason}.`,
    noteText: (title, text) => `написал треду ${title}: ${text}`,
    closed: {
      archived: "Тред в архиве, написать ему отсюда нельзя.",
      gone: "Тред недоступен: он удалён или не читается. Написать ему нельзя.",
      none: "У этих записей нет треда-отправителя, отвечать некому.",
    },
    instruction: marker => `Короткий служебный ответ на сообщение другого треда или системы начинай с ${marker}; итог для пользователя — без метки.`,
    systemTexts: [
      [/^\s*failed\.?(?=\s|$)/i, "Завершился с ошибкой."],
      [/was interrupted because its host daemon restarted\./gi, "Прерван: перезапустилась служба BB на машине исполнителя."],
      [/Child thread updates:/g, "Завершили ход:"],
      [/\bcompleted\./gi, "завершил."],
      [/\bfailed\./gi, "упал."],
      [/\bwas interrupted\b/gi, "прерван"],
      [/Review the thread before deciding next steps\./g, "Проверьте тред перед следующим шагом."],
    ],
    bareCompleted: "",
  },
};
