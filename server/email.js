import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { getSecret } from './secretManager.js';

async function sendEmail({ to, subject, text, html, oauth2Client }) {
  // If SMTP_HOST is defined, use SMTP transport (Nodemailer)
  const smtpHost = getSecret('SMTP_HOST');
  if (smtpHost) {
    const smtpPort = getSecret('SMTP_PORT');
    console.log(`[sendEmail] Using SMTP config: Host=${smtpHost} Port=${smtpPort}`);

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort) || 587,
      secure: getSecret('SMTP_SECURE') === 'true', // true for 465, false for other ports
      auth: (getSecret('SMTP_USER') && getSecret('SMTP_PASS')) ? {
        user: getSecret('SMTP_USER'),
        pass: getSecret('SMTP_PASS'),
      } : undefined,
      tls: {
          // Do not fail on invalid certs if explicitly allowed (useful for local testing/self-signed)
          rejectUnauthorized: getSecret('SMTP_REJECT_UNAUTHORIZED') !== 'false'
      }
    });

    try {
      const info = await transporter.sendMail({
        from: getSecret('SMTP_FROM') || '"Print Shop" <noreply@example.com>',
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
