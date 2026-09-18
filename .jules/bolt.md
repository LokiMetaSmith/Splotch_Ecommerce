## 2024-05-24 - [O(1) lookups for Telegram Bot Integrations]
**Learning:** Found an O(N) array search happening repeatedly on `Object.values(this.db.data.orders).find(...)` during telegram bot webhooks to identify which order a user was replying to. As the database of orders grows this becomes noticeably slow, taking ~4+ seconds per 1k requests on 10k orders.
**Action:** Created dedicated O(1) tracking indices for `telegramMessageId` and `telegramPhotoMessageId` similar to the existing `emailIndex`. This brought 1k lookups on a 10k db from 4380ms down to 0.54ms!
