// getRefreshToken.js
import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

// Paste the code from the previous step here
const an_authorization_code = 'PASTE_THE_CODE_FROM_YOUR_BROWSER_URL_HERE';

const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);

async function getTokens() {
  try {
    const { tokens } = await oAuth2Client.getToken(an_authorization_code);
    console.log('Your tokens:', tokens);
    console.log('\nCopy this refresh token and add it to your .env file:');
    console.log(tokens.refresh_token);
  } catch (error) {
    console.error('Error getting tokens:', error);
  }
}

getTokens();