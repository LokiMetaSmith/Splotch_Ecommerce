// getRefreshToken.js
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });


// Paste the code from the previous step here
const an_authorization_code = 'PASTE_THE_CODE_FROM_YOUR_BROWSER_URL_HERE';

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
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