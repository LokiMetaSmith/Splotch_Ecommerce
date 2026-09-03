import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const isTestEnv = process.env.NODE_ENV === 'test';

// Configuration logic supporting Hybrid Postfix (local relay) and Mailpit (testing)
const smtpConfig = {
    host: isTestEnv ? '127.0.0.1' : (process.env.SMTP_HOST || '127.0.0.1'),
    port: isTestEnv ? 1025 : parseInt(process.env.SMTP_PORT || '25', 10),
    secure: process.env.SMTP_SECURE === 'true',
};

// Only add auth if explicitly provided (local Postfix/Mailpit usually don't need auth from localhost)
if (process.env.SMTP_USER && process.env.SMTP_PASS && !isTestEnv) {
    smtpConfig.auth = {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    };
}

const transporter = nodemailer.createTransport(smtpConfig);

export const sendEmail = async ({ to, subject, text, html }) => {
    // We only simulate if we are NOT in test mode AND there's no SMTP_HOST defined and no local postfix intended.
    // Since we default to 127.0.0.1, we assume a local relay (Postfix) or Mailpit is available.
    
    const fromAddress = process.env.EMAIL_FROM || process.env.SMTP_USER || 'notifications@splotch.local';

    try {
        const info = await transporter.sendMail({
            from: `"Splotch Print Shop" <${fromAddress}>`,
            to,
            subject,
            text,
            html
        });
        console.log(`Message sent: ${info.messageId} (Host: ${smtpConfig.host}:${smtpConfig.port})`);
        return true;
    } catch (error) {
        console.error(`Error sending email via ${smtpConfig.host}:${smtpConfig.port}:`, error.message);
        console.warn("If you are running locally without Postfix or Mailpit, emails will fail to send.");
        // We don't throw error to prevent the app from crashing on local dev without mail servers
        return false;
    }
};
