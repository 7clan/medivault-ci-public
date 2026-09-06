/**
 * Structured logging: epoch-timestamped lines to stdout AND
 * <logDir>/provision.log (append). Secret values never pass through here.
 */
import { appendFileSync, mkdirSync } from 'node:fs';

export class Logger {
  private readonly file: string | null;

  constructor(logDir: string) {
    try {
      mkdirSync(logDir, { recursive: true });
      this.file = `${logDir}/provision.log`;
    } catch {
      this.file = null;
    }
  }

  log(level: string, message: string): void {
    const epoch = Math.floor(Date.now() / 1000);
    const line = `${epoch}\t${level}\t${message}\n`;
    process.stdout.write(line);
    if (this.file) {
      try {
        appendFileSync(this.file, line);
      } catch {
        /* file logging is best-effort; stdout is authoritative */
      }
    }
  }

  info(message: string): void {
    this.log('INFO', message);
  }

  warn(message: string): void {
    this.log('WARN', message);
  }

  error(message: string): void {
    this.log('ERROR', message);
  }
}
