// getAuthUrl.js
import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);

// Define the scope for sending emails
const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

// This is the crucial part that asks for a refresh token
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline', // IMPORTANT: This is what gets you a refresh token
  prompt: 'consent',      // Ensures you're prompted for consent every time
  scope: SCOPES,
});

console.log('Authorize this app by visiting this url:', authUrl);