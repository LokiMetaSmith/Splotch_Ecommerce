import { google } from 'googleapis';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

async function sendEmail({ to, subject, text, html, oauth2Client }) {
  console.log('[sendEmail] OAuth2 Client Credentials:', oauth2Client.credentials);
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const mail = new MailComposer({
      to,
      subject,
      text,
      html,
      textEncoding: 'base64',
    });

    const message = await mail.compile().build();
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    console.log('Email sent:', res.data);
    return res.data;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

export { sendEmail };
