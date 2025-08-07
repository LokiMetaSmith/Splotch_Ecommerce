import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
} from '@simplewebauthn/server';

// Mock environment variables required by the WebAuthn logic
const RP_ID = 'localhost';
const RP_NAME = 'Splotch';
const EXPECTED_ORIGIN = 'http://localhost:5173';

describe('WebAuthn Library Verification', () => {

    describe('Registration', () => {
        it('should generate valid registration options', async () => {
            const options = await generateRegistrationOptions({
                rpID: RP_ID,
                rpName: RP_NAME,
                userName: 'testuser',
            });

            expect(options).toBeDefined();
            expect(options.challenge).toBeDefined();
            expect(options.rp).toBeDefined();
            expect(options.rp.id).toEqual(RP_ID);
            expect(options.user.name).toEqual('testuser');
            expect(options.pubKeyCredParams).toBeInstanceOf(Array);
        });

        it('should fail verification of a fake registration response in a predictable way', async () => {
            const userName = 'testuser-verification';
            // 1. Generate registration options
            const options = await generateRegistrationOptions({
                rpID: RP_ID,
                rpName: RP_NAME,
                userName,
            });

            // 2. Create a fake response mimicking what the browser's startRegistration() would produce
            // This response is structurally correct but cryptographically invalid.
            const fakeBrowserResponse = {
                id: 'fake-credential-id-123',
                rawId: 'ZmFrZS1jcmVkZW50aWFsLWlkLTEyMw==', // base64url encoding of "fake-credential-id-123"
                response: {
                    // A real clientDataJSON would be a JSON string with challenge, origin, etc.
                    clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiZmFrZS1jaGFsbGVuZ2UiLCJvcmlnaW4iOiJodHRwOi8vbG9jYWxob3N0OjUxNzMifQ==',
                    // A real attestationObject would contain the authenticator data and attestation statement.
                    attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVjESZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NBAAAAAAAAAAAAAAAAAAAAAAAAAAAAUGFrZS1jcmVkZW50aWFsLWlkLTEyMwA',
                },
                type: 'public-key',
                clientExtensionResults: {},
            };

            // 3. Attempt to verify the fake response
            // We expect this to throw an error because the challenge and signature are invalid.
            // The purpose of this test is to confirm that the verifyRegistrationResponse function
            // is being called correctly and is actively trying to validate the data.
            await expect(verifyRegistrationResponse({
                response: fakeBrowserResponse,
                expectedChallenge: options.challenge, // Use the real challenge from the options
                expectedOrigin: EXPECTED_ORIGIN,
                expectedRPID: RP_ID,
            })).rejects.toThrow(); // It should throw an error, proving it's validating.
        });
    });

    // I will add authentication tests here later.
    describe('Authentication', () => {
        // This is a mock of a credential that would have been saved during registration.
        const mockAuthenticator = {
            credentialID: 'mock-credential-id-456',
            credentialPublicKey: 'cHVibGljLWtleS1kYXRh', // "public-key-data"
            counter: 1,
            credentialDeviceType: 'singleDevice',
            credentialBackedUp: false,
            transports: ['internal'],
        };

        it('should generate valid authentication options', async () => {
            const options = await generateAuthenticationOptions({
                rpID: RP_ID,
                allowCredentials: [{
                    id: mockAuthenticator.credentialID,
                    type: 'public-key',
                    transports: mockAuthenticator.transports,
                }, ],
            });

            expect(options).toBeDefined();
            expect(options.challenge).toBeDefined();
            expect(options.rpId).toEqual(RP_ID);
            expect(options.allowCredentials).toBeInstanceOf(Array);
            expect(options.allowCredentials[0].id).toEqual(mockAuthenticator.credentialID);
        });

        it('should fail verification of a fake authentication response predictably', async () => {
            // 1. Generate authentication options
            const options = await generateAuthenticationOptions({
                rpID: RP_ID,
                allowCredentials: [{
                    id: mockAuthenticator.credentialID,
                    type: 'public-key',
                    transports: mockAuthenticator.transports,
                }, ],
            });

            // 2. Create a fake response mimicking the browser's startAuthentication()
            const fakeBrowserResponse = {
                id: mockAuthenticator.credentialID,
                rawId: 'bW9jay1jcmVkZW50aWFsLWlkLTQ1Ng==', // base64url of "mock-credential-id-456"
                response: {
                    clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiZmFrZS1jaGFsbGVuZ2UiLCJvcmlnaW4iOiJodHRwOi8vbG9jYWxob3N0OjUxNzMifQ==',
                    authenticatorData: 'SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MBAAAABQ==',
                    signature: 'ZmFrZS1zaWduYXR1cmU=', // "fake-signature"
                    userHandle: 'dXNlci1oYW5kbGUtZm9yLXRlc3Q=', // "user-handle-for-test"
                },
                type: 'public-key',
                clientExtensionResults: {},
            };

            // 3. Attempt to verify the fake response
            // This should fail because the signature, challenge, etc., are not valid.
            await expect(verifyAuthenticationResponse({
                response: fakeBrowserResponse,
                expectedChallenge: options.challenge,
                expectedOrigin: EXPECTED_ORIGIN,
                expectedRPID: RP_ID,
                authenticator: mockAuthenticator,
            })).rejects.toThrow();
        });
    });
});
