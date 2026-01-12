# Telegram Chat ID Finder

A simple Node.js script to help you find the correct `chatId` for any Telegram user, group, or channel by logging the details of incoming messages sent to your bot.

## Setup

1.  **Install Dependencies:** Make sure you have the required Node.js packages installed.

    ```bash
    pnpm install telegraf dotenv
    ```

2.  **Environment Variables:** Ensure you have a `.env` file in the same directory with your bot token.

    ```dotenv
    # .env
    TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN_HERE
    ```

## Usage

1.  **Save the Script:** Save the following code as `findId.js`:

    ```javascript
    // findId.js
    import { Telegraf } from 'telegraf';
    import dotenv from 'dotenv';

    // Load environment variables from your .env file
    dotenv.config();

    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
        console.error("Error: TELEGRAM_BOT_TOKEN is not set in your .env file.");
        process.exit(1);
    }

    const bot = new Telegraf(token);

    console.log('ID Finder Bot is running. Send or forward a message to it...');

    bot.on('message', (ctx) => {
      console.log('--- NEW MESSAGE RECEIVED ---');
      // In Telegraf, the message object is at ctx.message
      console.log(JSON.stringify(ctx.message, null, 2));
    });

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

    bot.launch();
    ```

2.  **Run the Script:** Execute the script from your terminal.

    ```bash
    node findId.js
    ```

    You will see the message: `ID Finder Bot is running. Send or forward a message to it...`

3.  **Send a Message to Your Bot:**

      * **For a Private Chat or Group:** From the target chat, send any message directly to your bot.
      * **For a Channel:** Find any message within the channel, select "Forward," and choose your bot as the recipient.

## Interpreting the Output

Check the terminal where the script is running. It will print a detailed JSON object for each message it receives.

### For Direct Messages (Users & Groups)

Look for the `id` inside the `chat` object.

```json
{
  "message_id": 123,
  "chat": {
    "id": 123456789,
    "type": "private"
  },
  "...": "..."
}
```

In this example, the `chatId` is **`123456789`**.

### For Forwarded Messages from a Channel

Look for the `id` inside the `forward_from_chat` object. Channel and group IDs are often large negative numbers.

```json
{
  "message_id": 124,
  "forward_from_chat": {
    "id": -1001234567890,
    "title": "My Awesome Channel",
    "type": "channel"
  },
  "...": "..."
}
```

In this example, the channel's `chatId` is **`-1001234567890`**.
