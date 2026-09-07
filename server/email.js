import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { getSecret } from './secretManager.js';
import logger from './logger.js';

async function sendEmail({ to, subject, text, html, oauth2Client }) {
  // If SMTP_HOST is defined, use SMTP transport (Nodemailer)
  const smtpHost = getSecret('SMTP_HOST');
  if (smtpHost) {
    const smtpPort = getSecret('SMTP_PORT');
    logger.info(`[sendEmail] Using SMTP config: Host=${smtpHost} Port=${smtpPort}`);

    const isLocalhost = smtpHost === '127.0.0.1' || smtpHost === 'localhost';
    const rejectUnauthorized = getSecret('SMTP_REJECT_UNAUTHORIZED') === 'true' 
      ? true 
      : (getSecret('SMTP_REJECT_UNAUTHORIZED') === 'false' ? false : !isLocalhost);
    const ignoreTLS = getSecret('SMTP_IGNORE_TLS') === 'true' || (isLocalhost && (Number(smtpPort) || 25) === 25);

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort) || 587,
      secure: getSecret('SMTP_SECURE') === 'true', // true for 465, false for other ports
      ignoreTLS,
      auth: (getSecret('SMTP_USER') && getSecret('SMTP_PASS')) ? {
        user: getSecret('SMTP_USER'),
        pass: getSecret('SMTP_PASS'),
      } : undefined,
      tls: {
          // Do not fail on invalid certs if explicitly allowed or for local loopback
          rejectUnauthorized
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
      logger.info('Email sent via SMTP:', info.messageId);
      return info;
    } catch (error) {
      logger.error(`Error sending email via SMTP: ${error.message}`);
      throw error;
    }
  }

  // Fallback to Gmail API (Legacy)
  logger.info('[sendEmail] OAuth2 Client Credentials:', oauth2Client ? 'Present' : 'Missing');

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

    logger.info('Email sent via Gmail API:', res.data);
    return res.data;
  } catch (error) {
    logger.error(`Error sending email via Gmail API: ${error.message}`);
    throw error;
  }
}

export { sendEmail };
