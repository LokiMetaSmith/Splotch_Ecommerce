# Server CLI Interface

The Print Shop server includes a Command Line Interface (CLI) to manage the underlying database. It allows administrators to securely perform basic maintenance tasks directly from the terminal, such as managing users and WebAuthn credentials.

## Prerequisites

Before using the CLI, ensure you have installed the server dependencies:

```bash
cd server
pnpm install
```

## Configuration

The CLI interacts directly with the database configured for your server. It respects the same environment variables as the main application to determine which database to connect to.

*   **`DB_PROVIDER`**: If set to `mongo`, the CLI will attempt to connect to a MongoDB instance.
*   **`MONGO_URL`**: If using MongoDB, this variable must contain the connection string. If `MONGO_URL` is set, the CLI automatically defaults to the MongoDB provider.
*   **`DB_PATH`**: If you are using the local `lowdb` JSON database (the default behavior), this variable overrides the default path. If not set, it defaults to `server/db.json`.

You can set these variables in your `server/.env` file or export them directly in your shell before running the CLI.

> **Note:** The CLI currently handles operations on unencrypted local DBs or Mongo.

## Usage

You can run the CLI script using Node.js from within the `server` directory:

```bash
cd server
node cli.js [command] [options]
```

Or, execute it directly if it has execute permissions:

```bash
./server/cli.js [command] [options]
```

### Global Options

*   `-V, --version`: Output the version number of the CLI tool.
*   `-h, --help`: Display help information for the tool or for a specific command.

## Commands

### `add-user`
Add a new user to the database. The password will be automatically securely hashed using `bcrypt` before storage.

*   **Usage:** `node cli.js add-user <username> <password>`
*   **Arguments:**
    *   `<username>`: The desired username.
    *   `<password>`: The user's password.

### `remove-user`
Remove an existing user and all their associated credentials from the database.

*   **Usage:** `node cli.js remove-user <username>`
*   **Arguments:**
    *   `<username>`: The username of the account to delete.

### `list-users`
List all currently registered usernames in the database.

*   **Usage:** `node cli.js list-users`

### `add-key`
Informational command regarding adding WebAuthn security keys.

*   **Usage:** `node cli.js add-key <username>`
*   **Arguments:**
    *   `<username>`: The username.
*   **Description:** Registering a WebAuthn security key requires interaction with a user's physical hardware and browser APIs. Therefore, this action cannot be performed directly via the terminal. This command outputs instructions directing the user to use the web interface on the login page to register new keys.

### `remove-key`
Remove a specific WebAuthn credential (security key) associated with a user. This is useful if a user loses a hardware key.

*   **Usage:** `node cli.js remove-key <username> <credentialID>`
*   **Arguments:**
    *   `<username>`: The username the key belongs to.
    *   `<credentialID>`: The specific ID of the credential to remove.
