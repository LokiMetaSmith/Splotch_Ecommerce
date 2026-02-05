#!/usr/bin/env node

import { Command } from 'commander';
import { JSONFilePreset } from 'lowdb/node';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSecret } from './secretManager.js';
import { getDatabaseAdapter } from './database/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const program = new Command();

const defaultData = { orders: {}, users: {}, credentials: {}, config: {}, products: {} };

let db;
// Initialization logic similar to server/index.js
// Note: We don't handle encryption here for simplicity in this refactor,
// assuming CLI usage is for admin tasks often with unencrypted local DB or Mongo.
// If encryption is needed for CLI, we should duplicate logic or extract it.
// For now, let's support Mongo/LowDb switching.

if (getSecret('DB_PROVIDER') === 'mongo' || getSecret('MONGO_URL')) {
    const mongoUrl = getSecret('MONGO_URL');
    if (!mongoUrl) {
         console.error('MONGO_URL must be set when DB_PROVIDER is mongo.');
         process.exit(1);
    }
    db = getDatabaseAdapter(mongoUrl);
    await db.connect();
} else {
    const dbPath = getSecret('DB_PATH') || path.join(__dirname, 'db.json');
    const lowdb = await JSONFilePreset(dbPath, defaultData);
    db = getDatabaseAdapter(lowdb);
}

program
    .name('printshop-cli')
    .description('CLI to manage the printshop database')
    .version('1.0.0');

program
    .command('add-user')
    .description('Add a new user')
    .argument('<username>', 'username')
    .argument('<password>', 'password')
    .action(async (username, password) => {
        const existing = await db.getUser(username);
        if (existing) {
            console.log('User already exists');
            return;
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = {
            id: randomUUID(),
            username,
            password: hashedPassword,
            credentials: [],
        };

        await db.createUser(user);

        console.log(`User ${username} added successfully`);
    });

program
    .command('remove-user')
    .description('Remove a user')
    .argument('<username>', 'username')
    .action(async (username) => {
        const deleted = await db.deleteUser(username);
        if (!deleted) {
            console.log('User not found');
            return;
        }

        console.log(`User ${username} removed successfully`);
    });

program
    .command('list-users')
    .description('List all users')
    .action(async () => {
        const usernames = await db.listUsernames();
        console.log(usernames);
    });

program
    .command('add-key')
    .description('Add a new key for a user')
    .argument('<username>', 'username')
    .action((username) => {
        console.log(`Registering a security key requires interaction with a browser's WebAuthn API.`);
        console.log(`Please use the web interface at the login page to add a new key for ${username}.`);
    });

program
    .command('remove-key')
    .description('Remove a key for a user')
    .argument('<username>', 'username')
    .argument('<credentialID>', 'credentialID')
    .action(async (username, credentialID) => {
        const removed = await db.removeCredential(username, credentialID);
        if (!removed) {
            console.log('User or credential not found/failed to remove');
            return;
        }

        console.log(`Credential ${credentialID} removed successfully for user ${username}`);
    });

program.parse(process.argv);
