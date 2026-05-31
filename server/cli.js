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
if (getSecret('DB_PROVIDER') === 'mongo' || getSecret('MONGO_URL')) {
    const mongoUrl = getSecret('MONGO_URL');
    if (!mongoUrl) {
         console.error('MONGO_URL must be set when DB_PROVIDER is mongo.');
         process.exit(1);
    }
    db = getDatabaseAdapter(mongoUrl);
    await db.connect();
} else {
    // FIX: default to server/db.json instead of cwd
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
    .option('--admin', 'Grant admin privileges to the user')
    .action(async (username, password, options) => {
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
            ...(options.admin ? { role: 'admin' } : {})
        };

        await db.createUser(user);

        console.log(`User ${username} added successfully${options.admin ? ' with admin privileges' : ''}`);
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

program
    .command('update-password')
    .description('Update a user password')
    .argument('<username>', 'username')
    .argument('<password>', 'new password')
    .action(async (username, password) => {
        const user = await db.getUser(username);
        if (!user) {
            console.log('User not found');
            return;
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        user.password = hashedPassword;
        await db.updateUser(user);
        console.log(`Password updated successfully for ${username}`);
    });

program
    .command('interactive')
    .description('Start interactive mode')
    .action(async () => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        while (true) {
            console.log('\n--- Print Shop DB Manager ---');
            console.log('1. List Users');
            console.log('2. Add User');
            console.log('3. Remove User');
            console.log('4. Update User Password');
            console.log('5. Exit');
            const choice = await rl.question('Select an option (1-5): ');
            
            if (choice === '1') {
                const users = await db.listUsernames();
                console.log('Users:', users.length > 0 ? users.join(', ') : 'None');
            } else if (choice === '2') {
                const username = await rl.question('Username: ');
                const password = await rl.question('Password: ');
                const admin = await rl.question('Make admin? (y/N): ');
                
                const existing = await db.getUser(username);
                if (existing) {
                    console.log('Error: User already exists!');
                } else {
                    const hashedPassword = await bcrypt.hash(password, 10);
                    const user = {
                        id: randomUUID(),
                        username,
                        password: hashedPassword,
                        credentials: [],
                        ...(admin.toLowerCase() === 'y' ? { role: 'admin' } : {})
                    };
                    await db.createUser(user);
                    console.log(`User ${username} added!`);
                }
            } else if (choice === '3') {
                const username = await rl.question('Username to remove: ');
                const deleted = await db.deleteUser(username);
                console.log(deleted ? 'User removed!' : 'User not found.');
            } else if (choice === '4') {
                const username = await rl.question('Username: ');
                const user = await db.getUser(username);
                if (!user) {
                    console.log('User not found.');
                } else {
                    const password = await rl.question('New password: ');
                    user.password = await bcrypt.hash(password, 10);
                    await db.updateUser(user);
                    console.log(`Password updated for ${username}!`);
                }
            } else if (choice === '5') {
                break;
            }
        }
        rl.close();
    });

if (process.argv.length <= 2) {
    // Default to interactive mode if no args provided
    await program.parseAsync(['node', 'cli.js', 'interactive']);
} else {
    await program.parseAsync(process.argv);
}
process.exit(0);
