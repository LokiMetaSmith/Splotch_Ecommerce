import fs from 'fs';
import { encrypt, decrypt } from '../encryption.js';

export class EncryptedJSONFile {
  constructor(filename) {
    this.filename = filename;
  }

  async read() {
    let data;
    try {
      data = await fs.promises.readFile(this.filename, 'utf-8');
    } catch (e) {
      if (e.code === 'ENOENT') {
        return null;
      }
      throw e;
    }

    if (!data.trim()) return null;

    try {
      // Try to decrypt
      const decrypted = decrypt(data);
      return JSON.parse(decrypted);
    } catch (e) {
      // If decryption fails, assume it's plain JSON (migration path)
      try {
        return JSON.parse(data);
      } catch (parseError) {
        // If it's not JSON either, then it's corrupted or invalid
        throw new Error(`Failed to read database: ${e.message}`);
      }
    }
  }

  async write(data) {
    const str = JSON.stringify(data, null, 2);
    const encrypted = encrypt(str);
    const tempFile = `${this.filename}.tmp`;

    // Write to a temporary file first
    await fs.promises.writeFile(tempFile, encrypted);

    // Atomically rename the temporary file to the target file
    await fs.promises.rename(tempFile, this.filename);
  }
}
