# Quiz battles

Publish a quiz, then click Start Quiz Battle on its card. This creates a persistent room code and `/battle/:code` link. Share it; private quizzes also require the original invitation code. The host joins as a player. Friends join without accounts, choose a display name, and mark ready. The host can start after at least two players are ready.

The server owns the active question index, deadline and score. Everyone receives the same current question, and future answer keys are never included in events. Each round lasts 30 seconds by default (API configurable from 10 to 180 seconds). Each participant can submit once per round; duplicate or stale-round answers return 409. A correct exact-set answer earns 1,000 points. Scores become visible only when the round closes, then the leaderboard updates. Final ranks appear after the last deadline.

WebSockets stream sanitized current database state once per second. Reconnecting uses the existing HttpOnly guest cookie and participant record; a browser refresh restores membership. A player cannot join after the battle starts, but an existing player can reconnect. Lobby state shows ready and connection indicators. The server checks host ownership, quiz publication/expiration, room expiry (four hours), membership and unique answer constraints. A host can watch an active room after reconnecting. Tied scores share the same points; display ordering breaks ties alphabetically.

Use a single worker/process. Database-backed room state survives process restarts, with elapsed rounds advanced from deadlines. Multi-instance rate limiting, adversarial load testing, host transfer and rich host moderation are not implemented. These limits are explicit; no distributed scaling claim is made.
