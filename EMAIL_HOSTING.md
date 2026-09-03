# Splotch Email Hosting Architecture

This document outlines the three supported strategies for handling outbound emails from the Splotch Print Shop SBC. Due to typical residential and commercial ISP restrictions on Port 25 and strict IP reputation rules for inbox delivery, direct-to-inbox self-hosting is discouraged. 

---

## 1. The Hybrid Approach (Recommended for Production)

This is the standard approach for physical hardware deployments. The SBC runs a local, lightweight SMTP server (Postfix) configured strictly as a **Send-Only Relay**.

### Architecture
- The Node.js application (`nodemailer`) connects to `127.0.0.1:25` with no authentication.
- Postfix receives the email and queues it locally (protecting against temporary internet outages).
- Postfix acts as a smart host, authenticating and forwarding the email via a transactional email provider (e.g., SendGrid, Mailgun, Amazon SES).

### Setup Instructions (Ubuntu SBC)
1. Install Postfix:
   \`\`\`bash
   sudo apt-get update
   sudo apt-get install postfix libsasl2-modules
   \`\`\`
   *(When prompted, choose "Internet with smarthost" or "Satellite system")*

2. Configure `/etc/postfix/main.cf`:
   \`\`\`ini
   relayhost = [smtp.sendgrid.net]:587
   smtp_sasl_auth_enable = yes
   smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd
   smtp_sasl_security_options = noanonymous
   smtp_tls_security_level = encrypt
   header_size_limit = 4096000
   \`\`\`

3. Set up authentication (`/etc/postfix/sasl_passwd`):
   \`\`\`
   [smtp.sendgrid.net]:587 apikey:YOUR_SENDGRID_API_KEY
   \`\`\`
   \`\`\`bash
   sudo postmap /etc/postfix/sasl_passwd
   sudo chmod 0600 /etc/postfix/sasl_passwd /etc/postfix/sasl_passwd.db
   sudo systemctl restart postfix
   \`\`\`

4. App Configuration (`.env`):
   \`\`\`env
   SMTP_HOST=127.0.0.1
   SMTP_PORT=25
   EMAIL_FROM=notifications@yourdomain.com
   \`\`\`

---

## 2. Full Cloud Self-Hosted (Not Recommended for Local SBCs)

If you require 100% self-hosted infrastructure without a third-party transactional relay, this must be deployed on a Cloud VPS (e.g., DigitalOcean, Linode) with a clean IP address and unblocked Port 25.

### Architecture
- Deploy **Docker Mailserver** or **Mailu** on a cloud server.
- Configure SPF, DKIM, DMARC, and reverse DNS (PTR) records for the cloud IP.
- The Splotch SBC connects remotely to the cloud server via Port 587 (Submission).

### App Configuration (\`.env\`)
\`\`\`env
SMTP_HOST=mail.yourcloudserver.com
SMTP_PORT=587
SMTP_USER=printshop@yourdomain.com
SMTP_PASS=your_secure_password
SMTP_SECURE=true
EMAIL_FROM=printshop@yourdomain.com
\`\`\`

---

## 3. Local Sandbox / Catch-All (For Unit Tests & E2E)

For development and automated testing, we use **Mailpit**. Mailpit acts as a fake SMTP server that intercepts all outbound mail and displays it in a local web interface. No emails are ever actually delivered to the internet.

### Architecture
- The application automatically defaults to this configuration when `NODE_ENV=test`.
- Connects to `127.0.0.1:1025`.

### Setup Instructions
1. Install Mailpit on the SBC or Dev Machine:
   \`\`\`bash
   sudo bash -c "$(curl -sL https://raw.githubusercontent.com/axllent/mailpit/develop/install.sh)"
   \`\`\`

2. Run Mailpit:
   \`\`\`bash
   mailpit
   \`\`\`
   - SMTP Server runs on \`localhost:1025\`
   - Web Dashboard runs on \`http://localhost:8025\`

3. The App Configuration automatically detects `NODE_ENV=test` and bypasses the production Postfix/Relay setup, piping all mail directly to Mailpit.
