import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { getSecret } from './secretManager.js';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

/**
 * Perform application backup (db.json and uploads directory)
 */
export async function performBackup() {
  const method = getSecret('BACKUP_METHOD', 'local');
  const destination = getSecret('BACKUP_DESTINATION', './backups');
  const retentionDays = parseInt(getSecret('BACKUP_RETENTION_DAYS', '30'), 10);

  logger.info(`[BACKUP] Starting backup routine (Method: ${method}, Destination: ${destination}, Retention: ${retentionDays} days)...`);

  const backupScript = path.join(projectRoot, 'scripts', 'backup.sh');

  // If running on a system with bash and backup.sh exists, use the shell script
  if (fs.existsSync(backupScript) && process.platform !== 'win32') {
    return new Promise((resolve, reject) => {
      const args = [backupScript, '--method', method, destination];
      if (retentionDays > 0) {
        args.push('--retention-days', String(retentionDays));
      }

      const child = spawn('bash', args, { cwd: projectRoot, stdio: 'pipe' });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        if (code === 0) {
          logger.info(`[BACKUP] Backup script completed successfully.\n${stdout.trim()}`);
          resolve({ success: true, stdout });
        } else {
          logger.error(`[BACKUP] Backup script exited with code ${code}.\n${stderr.trim()}`);
          reject(new Error(`Backup script failed with code ${code}`));
        }
      });
    });
  }

  // Cross-platform fallback for local backups
  try {
    const destDir = path.isAbsolute(destination) ? destination : path.join(projectRoot, destination);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFolder = path.join(destDir, `backup-${timestamp}`);
    fs.mkdirSync(backupFolder, { recursive: true });

    // Copy db.json
    const dbSource = path.join(projectRoot, 'server', 'db.json');
    if (fs.existsSync(dbSource)) {
      fs.copyFileSync(dbSource, path.join(backupFolder, 'db.json'));
    }

    // Copy pricing.json if exists
    const pricingSource = path.join(projectRoot, 'server', 'pricing.json');
    if (fs.existsSync(pricingSource)) {
      fs.copyFileSync(pricingSource, path.join(backupFolder, 'pricing.json'));
    }

    // Copy uploads directory if exists
    const uploadsSource = path.join(projectRoot, 'server', 'uploads');
    if (fs.existsSync(uploadsSource)) {
      const destUploads = path.join(backupFolder, 'uploads');
      fs.cpSync(uploadsSource, destUploads, { recursive: true, errorOnExist: false });
    }

    logger.info(`[BACKUP] Local backup created at: ${backupFolder}`);

    // Prune old backups
    if (retentionDays > 0) {
      const now = Date.now();
      const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
      const entries = fs.readdirSync(destDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('backup-')) {
          const entryPath = path.join(destDir, entry.name);
          try {
            const stats = fs.statSync(entryPath);
            if (now - stats.mtimeMs > maxAgeMs) {
              logger.info(`[BACKUP] Pruning expired backup: ${entry.name}`);
              fs.rmSync(entryPath, { recursive: true, force: true });
            }
          } catch (statErr) {
            logger.warn(`[BACKUP] Could not inspect ${entry.name}:`, statErr.message);
          }
        }
      }
    }

    return { success: true, path: backupFolder };
  } catch (err) {
    logger.error('[BACKUP] Error performing backup:', err);
    throw err;
  }
}

/**
 * Start recurring background backup scheduler
 */
export function startBackupScheduler() {
  const enabled = getSecret('BACKUP_ENABLED', 'true') === 'true';
  if (!enabled) {
    logger.info('[BACKUP] Automated backups are disabled (BACKUP_ENABLED != true).');
    return null;
  }

  const intervalHours = parseFloat(getSecret('BACKUP_INTERVAL_HOURS', '24')) || 24;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  logger.info(`[BACKUP] Automated backup scheduler initialized. Running every ${intervalHours} hours.`);

  const timer = setInterval(async () => {
    try {
      await performBackup();
    } catch (err) {
      logger.error('[BACKUP] Scheduled backup failed:', err);
    }
  }, intervalMs);

  return timer;
}
