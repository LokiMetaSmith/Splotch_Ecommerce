import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

async function sendEmail({ to, subject, text, html, oauth2Client }) {
  // If SMTP_HOST is defined, use SMTP transport (Nodemailer)
  if (process.env.SMTP_HOST) {
    console.log(`[sendEmail] Using SMTP config: Host=${process.env.SMTP_HOST} Port=${process.env.SMTP_PORT}`);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: (process.env.SMTP_USER && process.env.SMTP_PASS) ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      } : undefined,
      tls: {
          // Do not fail on invalid certs if explicitly allowed (useful for local testing/self-signed)
          rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false'
      }
    });

    try {
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || '"Print Shop" <noreply@example.com>',
        to,
        subject,
        text,
        html,
      });
      console.log('Email sent via SMTP:', info.messageId);
      return info;
    } catch (error) {
      console.error('Error sending email via SMTP:', error);
      throw error;
    }
  }

  // Fallback to Gmail API (Legacy)
  console.log('[sendEmail] OAuth2 Client Credentials:', oauth2Client ? 'Present' : 'Missing');

  if (!oauth2Client) {
      throw new Error('No email configuration found (SMTP_HOST is missing and oauth2Client is null)');
  }

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

    console.log('Email sent via Gmail API:', res.data);
    return res.data;
  } catch (error) {
    console.error('Error sending email via Gmail API:', error);
    throw error;
  }
}

export { sendEmail };
