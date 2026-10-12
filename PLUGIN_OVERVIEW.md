Run one thread that hands work to child threads, and your conversation with it fills up with their messages and completion notices. Notify Feed takes that traffic out of the main feed and lists it in a tab beside it, so the feed shows what you said and what the agent said to you. Agents still receive every message; only what you see changes.

## What you get

- Messages from other threads and BB's notices about child threads (completed, failed, interrupted, needs attention, digest) leave the main feed. Your own messages, ordinary agent replies and the turn in progress stay.
- A Notifications button in the thread header shows how many entries the thread has, or how many are new since you last opened the tab.
- The tab lists entries by day, newest first, with filters for Done, Attention and Info. Each card shows the time, the kind, the sending thread and three lines of text; click it to read the whole entry.
- A thread's message and its completion notice within 60 seconds become one card.
- Thread ids and task keys in the text become links.
- A switch turns the tab into a list of sending threads. Open one to read your agent's whole conversation with it in time order, including what the agent sent to it on its own.
- Under a conversation there is a field: write to that thread without leaving the one you are in. Your message goes to it as an ordinary user message and starts or joins its turn.
- Tell the agent, off by default, also sends the agent of the open thread a short note that you wrote to the other thread. The note lands in the tab, and it starts the agent's turn: BB cannot deliver a message without one.
- The tab has no width thresholds and reads the same in a wide panel and on a phone.

## Settings

- `language`: `en` or `ru`. With `ru` BB's system notices are shown in Russian too.
- `marker`: empty by default. Set a marker such as `[bg]` and the plugin asks your agents to start short housekeeping replies with it; finished replies that start with the marker move to the tab. Leave it empty and no instruction is added to your agents.
- `hide`: on by default. Turn it off and the main feed is stock BB again while the button and the tab keep working.
- `threads`: a JSON array of thread ids to work in. Empty means every thread.

## How it works

The tab reads the thread through BB's own API. Nothing leaves your machine, and there is no account or external service. The plugin stores, per thread, the time you last looked at the tab, the view you chose and the last 300 messages you sent from the tab. It writes to a thread only when you press Send, and it reads another thread's feed only while that thread's conversation is open on screen.

## Limits

Checked with BB 0.45 and 0.46. Hiding rows and the header button rest on BB's experimental plugin slots and, for hiding, on the feed's internal markup; a BB update can change them, and rows then stay visible or the button disappears until the plugin is updated. The tab itself uses the public plugin API and opens from the right panel's "+" menu even when those slots are missing. If the plugin cannot read the feed twice in a row, nothing is hidden until it can. The feed is polled every 8 seconds, so a new row is hidden with a short delay. At most 20 pages of thread history are read.
