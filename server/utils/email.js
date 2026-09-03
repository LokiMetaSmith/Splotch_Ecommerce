import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

export const sendEmail = async ({ to, subject, text, html }) => {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.warn("Email configuration missing. Simulating email send:");
        console.warn(`To: ${to}, Subject: ${subject}\n${text}`);
        return true;
    }

    try {
        const info = await transporter.sendMail({
            from: `"Splotch Print Shop" <${process.env.SMTP_USER}>`,
            to,
            subject,
            text,
            html
        });
        console.log(`Message sent: ${info.messageId}`);
        return true;
    } catch (error) {
        console.error("Error sending email:", error);
        throw error;
    }
};
