# Chat pipeline logs

Runtime JSONL written by `chatLog()` to `chat-pipeline.log` in this directory
(or `ASTROLABE_CHAT_LOG_PATH`). One JSON object per line.

Useful steps: `chat.start`, `query.resolve`, `topic.mismatch`, `agent.decision`,
`pack.stats`, `answer.continue`, `chat.end`.

Disable file logging with `ASTROLABE_CHAT_LOG=0`.
