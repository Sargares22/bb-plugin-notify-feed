# Changelog

## 0.3.2 - 2026-10-19

- Long threads no longer show empty gaps where hidden rows were. BB 0.46 dropped the row attribute the plugin relied on, so in a feed of 20+ rows hidden rows got `display:none` and kept their old height. They now shrink to 1px there.
- When you come back to a thread, its rows are hidden from the first render instead of after the first poll, so the feed no longer jumps.

## 0.3.1 - 2026-10-12

- With `language` set to `en`, cards made from BB's notices about a child thread start with a full phrase: "Failed.", "Interrupted: its host daemon restarted.", "Completed." They used to start with "failed." and "was interrupted because…", left over once BB's header line was removed. The rest of BB's text is unchanged, and so is `ru`.
- README, overview and description rewritten; a screenshot added to the README.

## 0.3.0 - 2026-10-12

- First public release of Notify Feed.
