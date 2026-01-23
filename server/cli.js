#!/usr/bin/env node

import { Command } from 'commander';
import { JSONFilePreset } from 'lowdb/node';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSecret } from './secretManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const program = new Command();

const defaultData = { orders: [], users: {}, credentials: {} };
const dbPath = getSecret('DB_PATH') || path.join(__dirname, 'db.json');
const db = await JSONFilePreset(dbPath, defaultData);

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
        if (db.data.users[username]) {
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

        db.data.users[username] = user;
        await db.write();

        console.log(`User ${username} added successfully`);
    });

program
    .command('remove-user')
    .description('Remove a user')
    .argument('<username>', 'username')
    .action(async (username) => {
        if (!db.data.users[username]) {
            console.log('User not found');
            return;
        }

        delete db.data.users[username];
        await db.write();

        console.log(`User ${username} removed successfully`);
    });

program
    .command('list-users')
    .description('List all users')
    .action(() => {
        console.log(Object.keys(db.data.users));
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
        if (!db.data.users[username]) {
            console.log('User not found');
            return;
        }

        const user = db.data.users[username];
        const credentialIndex = user.credentials.findIndex(c => c.credentialID === credentialID);

        if (credentialIndex === -1) {
            console.log('Credential not found');
            return;
        }

        user.credentials.splice(credentialIndex, 1);
        delete db.data.credentials[credentialID];
        await db.write();

        console.log(`Credential ${credentialID} removed successfully for user ${username}`);
    });

program.parse(process.argv);
