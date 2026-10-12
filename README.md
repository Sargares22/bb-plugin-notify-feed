# Notify Feed

A [BB](https://getbb.app) plugin that moves agent-to-agent traffic out of a thread's main feed and into a Notifications tab beside it.

When one thread hands work to child threads, its feed fills up with their messages and completion notices. Notify Feed hides those rows in the main feed and lists them in a tab of the right panel, so the feed shows what you said and what the agent said to you. Message delivery does not change: agents receive everything as before.

## What it does

Hidden from the main feed:

- messages sent by other threads;
- BB's system notices about child threads (completed, failed, interrupted, needs attention, digest);
- messages from outside tools whose first line is exactly `[notify:Name]` (see below);
- optionally, the agent's short replies to those messages (see the `marker` setting).

Your own messages, ordinary agent replies, tool rows and the turn in progress stay where they are.

A **Notifications: N** button appears in the thread header of every thread that has such entries. It opens the tab:

- entries grouped by day, newest first, with a filter: All, Done, Attention, Info / replies;
- each card shows the time, the kind, the sending thread and three lines of plain text; click a card to read it in full;
- a thread's message and its completion notice within 60 seconds become one card;
- thread ids and task keys in the text become links;
- the button shows **N new** when entries arrived since you last looked at the tab, and new cards carry a dot. The count is kept per thread and survives a window reload.

## By thread, and replying from the tab

A switch at the end of the filter row changes the tab between **By time** (the default) and **By thread**. The choice is kept per thread and survives a window reload.

By thread lists the sending threads, newest first: a dot colored by the thread's latest state, its name, its latest entry in one line and the number of entries. The filter then picks threads by that latest state. Entries without a sending thread (a `[notify:Name]` tool, a lone agent reply) get a row under their own name.

Click a thread to read the conversation in time order, oldest first: what the thread sent, what the agent replied, what the agent sent to it on its own, and how each of the thread's turns ended. The agent's own messages are read from the receiving thread's feed, where each one is a row with a known sender. That feed is read only while the conversation is open.

Under the conversation there is a field. Your message goes to that thread as an ordinary user message, through the same BB call the composer uses, and shows in the conversation as **You** at once. Enter sends, Shift+Enter starts a new line. While the message is on its way the button is busy. If BB refuses the message, the reason appears under the field and your text stays. If the connection drops before BB answers, the plugin looks for the message in the thread's feed: when it is there, it counts as sent; when it is not, you are told it may have been sent and nothing is repeated for you, because a repeat would be a second message and a second turn. A message is limited to 20,000 characters; a longer one is not sent and the field says so. For an archived or unavailable thread the field is replaced by a line that says why.

**Tell the agent** under the field is off by default. When it is on, after your message the plugin sends the agent of the open thread a short note, `[notify:You]` followed by "wrote to thread <name>: <text>", so the note lands in the tab and not in the feed. BB has no way to deliver a message without starting a turn, so the note starts the agent's turn.

The tab has no width thresholds: rows wrap on their own, so it reads the same in a wide panel and on a phone, where BB opens the panel over the whole screen. Checked at panel widths from 280 to 900 px and in a 390×844 phone window.

## Messages from outside tools

A tool that posts into a thread from outside (a mail watcher, a job runner) arrives as an ordinary user message. To have it treated as a notification, make the first line exactly `[notify:Name]` and put the text on the following lines. `Name` is 1–32 letters, digits, spaces, hyphens or dots, starting with a letter or digit; nothing else may be on that line. The card shows `Name` as its badge and hides the header line; the agent still receives the message unchanged. Any deviation leaves the message in the main feed. For tool authors: prepend `[notify:YourTool]` and a newline to the text you already send — nothing else is needed.

## Install

From the BB plugin store, or from this repository:

```sh
bb plugin install https://github.com/Sargares22/bb-plugin-notify-feed
```

Requires BB 0.45 or later. Checked with BB 0.45 and 0.46. No account and no external service: the plugin reads threads through BB's own API and nothing leaves your machine.

## Settings

Settings → Plugins → Notify Feed, or `bb plugin config notify-feed set <key> <value>`.

| Key | Default | Meaning |
| --- | --- | --- |
| `language` | `en` | Interface language: `en` or `ru`. With `ru` BB's system notices are shown in Russian as well; with `en` BB's text is left untouched. |
| `marker` | empty | Reply marker, for example `[bg]`. Empty: agent replies are never hidden and no instruction is added to your agents. Set: agents in scope are asked to start short housekeeping replies with the marker, and finished replies that start with it move to the tab. |
| `hide` | `true` | Hide rows in the main feed. Turn it off to get the stock feed back while the button and the tab keep working. No window reload is needed. |
| `threads` | `[]` | JSON array of thread ids the plugin works in. Empty means every thread. |

A changed setting takes effect at the next poll, within 10 seconds.

## Turning it off

- Keep the tab, restore the feed: `bb plugin config notify-feed set hide false`.
- Switch the plugin off: `bb plugin disable notify-feed`. Rows and the header return at once, without a window reload. The plugin writes to a thread only when you press Send in the tab.

## Limits

- Two of the three parts rest on things BB does not promise to keep. Hiding rows uses the experimental slot `experimental_appOverlay` and the feed's internal markup (`data-timeline-row-id` and the virtual list); the header button uses the experimental slot `experimental_threadHeaderAction`. A BB update can change or remove any of them: rows then stay visible, or the button disappears. The tab uses the public `threadPanelAction` slot and the public threads API; if an experimental slot is missing, the plugin skips it and the tab is still registered and opens from the right panel's "+" menu. This was checked with BB 0.45 and 0.46 and with a substituted API that lacks the experimental slots, not with later BB versions. Set `hide` to `false` if the feed misbehaves after an update.
- If two feed polls in a row fail, hiding is lifted until the next successful poll, so rows are never kept hidden on outdated data; the cards in the tab stay as they were.
- In a long (virtual) feed each hidden row leaves a gap of about 9 px: that is the spacing between rows, which a plugin cannot remove.
- The feed is polled every 8 seconds, so a new row is hidden with a delay of up to that interval.
- At most 20 pages of thread history are read.
- The marker is placed by the model on instruction. A reply where the model forgot it stays visible.
- The collapsed text is read from a hidden Markdown render of cards near the visible area; on a fast scroll a card may show its source text for a moment.
- In rare kinds of code (tab-indented, inside quotes, nested backticks) a thread id may turn into a link.
- View marks of deleted threads are not cleaned up (one number per thread).
- The entry count in a thread's row comes from the open thread's feed; the agent's own messages to that thread are added when you open the conversation. Messages you wrote to that thread outside the tab are not shown in the conversation.
- The plugin keeps the last 300 messages you sent from the tab, per thread. Whether a thread is archived is refreshed every 10 minutes.
- Enter sends on a phone as well, so a line break cannot be typed there.
- In a narrow panel a card's head wraps on its own: first "More" and the reply tag move to a second row, then the thread name.

## Development

```sh
npm ci
npm run typecheck
bb plugin build
bb plugin install .
```

All interface strings live in `i18n.ts`, one entry per language.

## License

MIT
