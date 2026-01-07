import { SMTPServer } from 'smtp-server';
import { sendEmail } from '../server/email.js';

describe('Email Integration Test (SMTP)', () => {
  let server;
  let port;
  let receivedEmails = [];

  beforeAll((done) => {
    // Start a local SMTP server on a random port
    server = new SMTPServer({
      authOptional: true, // We don't need auth for this test sink
      onData(stream, session, callback) {
        let buffers = [];
        stream.on('data', (data) => buffers.push(data));
        stream.on('end', () => {
          const emailData = Buffer.concat(buffers).toString();
          receivedEmails.push({
            from: session.envelope.mailFrom,
            to: session.envelope.rcptTo,
            data: emailData,
          });
          callback();
        });
      },
    });

    server.listen(0, () => {
      port = server.server.address().port;
      console.log(`[TEST] Mock SMTP server listening on port ${port}`);
      // Configure environment variables to point to this server
      process.env.SMTP_HOST = 'localhost';
      process.env.SMTP_PORT = port.toString();
      process.env.SMTP_SECURE = 'false';
      // Bypass potential certificate issues in test
      process.env.SMTP_REJECT_UNAUTHORIZED = 'false';
      done();
    });
  });

  afterAll((done) => {
    // Cleanup
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_REJECT_UNAUTHORIZED;
    server.close(done);
  });

  beforeEach(() => {
    receivedEmails = [];
  });

  test('should send an email via local SMTP server', async () => {
    const emailOptions = {
      to: 'recipient@example.com',
      subject: 'Test Subject',
      text: 'Hello world',
      html: '<p>Hello world</p>',
      // oauth2Client is ignored when SMTP_HOST is set, but we pass null to be explicit
      oauth2Client: null,
    };

    await sendEmail(emailOptions);

    // Wait briefly for the server to process the stream
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(receivedEmails.length).toBe(1);
    const email = receivedEmails[0];

    expect(email.to[0].address).toBe('recipient@example.com');
    expect(email.data).toContain('Subject: Test Subject');
    expect(email.data).toContain('Hello world');
  });

  test('should throw error if SMTP connection fails', async () => {
      // Temporarily break config
      const originalPort = process.env.SMTP_PORT;
      process.env.SMTP_PORT = '12345'; // Wrong port

      await expect(sendEmail({
          to: 'fail@example.com',
          subject: 'Fail',
          text: 'Fail',
          oauth2Client: null
      })).rejects.toThrow();

      process.env.SMTP_PORT = originalPort;
  });
});
