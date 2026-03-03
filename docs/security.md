# Security Best Practices

This document outlines security best practices for this project, covering the web server, domain configuration, and application-level security.

## Web Server Security

*   **Harden the Operating System:**
    *   Use a minimal installation of the operating system.
    *   Remove or disable all unnecessary services and software.
    *   Keep the OS and all software up to date with the latest security patches.
*   **Secure Configuration:**
    *   Run the web server with a dedicated, non-root user with minimal privileges.
    *   Disable or remove any default or example applications and configurations.
    *   Configure the server to disallow directory listing.
    *   Implement and configure a firewall, only allowing traffic to necessary ports (e.g., 80, 443).
*   **Logging and Monitoring:**
    *   Enable detailed logging for the web server and operating system.
    *   Regularly monitor logs for suspicious activity.
    *   Use a centralized logging solution to aggregate and analyze logs.
*   **Access Control & Deployment Best Practices:**
    *   **SSH Keys**: Use SSH keys for authentication instead of passwords. Add public keys to your cloud provider team account (e.g., DigitalOcean Team SSH Keys) for centralized access control.
    *   **Disable Password Auth**: Disable password-based authentication for SSH by modifying `/etc/ssh/sshd_config`.
    *   **CI/CD Integration**: Store private SSH keys securely in CI/CD secret management systems (e.g., GitHub Secrets, Vault) to allow developer-agnostic deployments without exposing keys manually.
    *   **Firewalls**: Use Cloud Firewalls to restrict SSH access to a small number of trusted IP addresses and CI/CD server ranges.
    *   **Two-Factor Authentication (2FA)**: Mandate 2FA for all team members accessing the infrastructure control plane (e.g., DigitalOcean account).
    *   For a detailed guide on advanced production deployments, GitOps, and Terraform, see [Best Practices for Secure Deployment](deployment/remote-vps.md#best-practices-for-secure-deployment--team-access).

## Domain Name Security

*   **Registrar Security:**
    *   Use a reputable domain registrar.
    *   Enable registrar lock to prevent unauthorized transfers of the domain.
    *   Use a strong, unique password for the registrar account and enable two-factor authentication (2FA).
*   **DNS Security:**
    *   Use a reputable DNS provider.
    *   Implement DNSSEC (Domain Name System Security Extensions) to protect against DNS spoofing and cache poisoning.
    *   Monitor DNS records for any unauthorized changes.
*   **Email Security:**
    *   Implement SPF (Sender Policy Framework), DKIM (DomainKeys Identified Mail), and DMARC (Domain-based Message Authentication, Reporting, and Conformance) to prevent email spoofing.

## Server-Side Application Security

*   **Follow the OWASP Top 10:** The [OWASP Top 10](https://owasp.org/www-project-top-ten/) is a standard awareness document for developers and web application security. It represents a broad consensus about the most critical security risks to web applications. All developers should be familiar with and code defensively against these vulnerabilities.
    1.  **Broken Access Control:** Ensure that users cannot act outside of their intended permissions.
    2.  **Cryptographic Failures:** Protect data in transit and at rest using strong, up-to-date cryptography.
    3.  **Injection:** Prevent injection flaws (e.g., SQL, NoSQL, OS, and LDAP injection) by validating and sanitizing all user-supplied input.
    4.  **Insecure Design:** Proactively design and architect the application with security in mind.
    5.  **Security Misconfiguration:** Securely configure all application components and remove or disable unused features.
    6.  **Vulnerable and Outdated Components:** Keep all libraries, frameworks, and other software components up to date.
    7.  **Identification and Authentication Failures:** Protect user accounts and manage sessions securely.
    8.  **Software and Data Integrity Failures:** Protect against modifications to software and data.
*   **Input Validation:**
    *   Validate all input from the client-side and server-side.
    *   Use a whitelist approach for validation where possible.
*   **Output Encoding:**
    *   Encode all output to prevent XSS (Cross-Site Scripting) attacks.
*   **Session Management:**
    *   Use secure, randomly generated session IDs.
    *   Regenerate session IDs after login.
    *   Implement secure session termination (logout).
*   **Dependency Management:**
    *   Use a tool like `npm audit` or `snyk` to regularly scan for vulnerabilities in third-party libraries and frameworks.
    *   Keep all dependencies up to date.
    *   **Completed Action:** Replaced `node-telegram-bot-api` with `telegraf` to address vulnerabilities related to the deprecated `request` package.
