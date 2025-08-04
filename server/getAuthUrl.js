// getAuthUrl.js
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

// --- DEBUG LINE ---
// This will show us if your .env file is being loaded correctly.
console.log('My Client ID is:', process.env.GOOGLE_CLIENT_ID);
// --- END DEBUG LINE ---

// Stop if the Client ID is missing
if (!process.env.GOOGLE_CLIENT_ID) {
    console.error('Error: GOOGLE_CLIENT_ID is missing from your .env file or it is not being loaded.');
    process.exit(1); // Exit the script
}

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);

// Define the scope for sending emails
const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

// This is the crucial part that asks for a refresh token
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline', 
  prompt: 'consent',      
  scope: SCOPES,
});

console.log('Authorize this app by visiting this url:', authUrl);