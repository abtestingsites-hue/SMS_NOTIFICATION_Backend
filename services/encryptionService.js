const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

class EncryptionService {
    constructor() {
        this.primaryKey = process.env.ENCRYPTION_MASTER_KEY || '';
        this.previousKeys = (process.env.ENCRYPTION_PREVIOUS_KEYS || '')
            .split(',')
            .map(k => k.trim())
            .filter(Boolean);

        // In non-production, allow development fallback with explicit warning
        if (!this.primaryKey) {
            if (process.env.NODE_ENV === 'production') {
                throw new Error('[FATAL SECURITY ERROR] ENCRYPTION_MASTER_KEY is mandatory in production environment. Refusing to boot.');
            } else {
                console.warn('[SECURITY NOTICE] ENCRYPTION_MASTER_KEY not set; using local development master seed. DO NOT USE IN PRODUCTION.');
                this.primaryKey = 'sms_campaign_system_master_enterprise_secret_2026_dev_seed';
            }
        }
    }

    validateConfiguration() {
        if (process.env.NODE_ENV === 'production') {
            if (!this.primaryKey || this.primaryKey.length < 32) {
                throw new Error('[FATAL SECURITY ERROR] ENCRYPTION_MASTER_KEY must be at least 32 characters long in production.');
            }
            // Entropy / complexity check: disallow trivial strings
            const isTrivial = /^(.)\1+$/.test(this.primaryKey) || this.primaryKey.toLowerCase().includes('password') || this.primaryKey.toLowerCase().includes('12345');
            if (isTrivial) {
                throw new Error('[FATAL SECURITY ERROR] ENCRYPTION_MASTER_KEY possesses insufficient entropy.');
            }
        }
        return {
            configured: true,
            algorithm: ALGORITHM,
            iterations: ITERATIONS,
            keyRotationActive: this.previousKeys.length > 0,
            previousKeysCount: this.previousKeys.length
        };
    }

    _deriveKey(masterSecret, salt) {
        return crypto.pbkdf2Sync(masterSecret, salt, ITERATIONS, KEY_LENGTH, 'sha512');
    }

    encrypt(text) {
        if (!text || typeof text !== 'string') return '';
        try {
            const salt = crypto.randomBytes(SALT_LENGTH);
            const iv = crypto.randomBytes(IV_LENGTH);
            const key = this._deriveKey(this.primaryKey, salt);

            const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const tag = cipher.getAuthTag();

            // Combined format: salt:iv:tag:ciphertext
            return [
                salt.toString('hex'),
                iv.toString('hex'),
                tag.toString('hex'),
                encrypted
            ].join(':');
        } catch (err) {
            console.error('Encryption operation error:', err);
            throw new Error('Encryption failed: ' + err.message);
        }
    }

    decrypt(cipherText) {
        if (!cipherText || typeof cipherText !== 'string' || !cipherText.includes(':')) {
            return cipherText || '';
        }

        const parts = cipherText.split(':');
        if (parts.length !== 4) return cipherText;

        const salt = Buffer.from(parts[0], 'hex');
        const iv = Buffer.from(parts[1], 'hex');
        const tag = Buffer.from(parts[2], 'hex');
        const encrypted = parts[3];

        // Candidate keys: Primary active key first, followed by rotation keys
        const candidates = [this.primaryKey, ...this.previousKeys];

        for (const secretCandidate of candidates) {
            try {
                const key = this._deriveKey(secretCandidate, salt);
                const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
                decipher.setAuthTag(tag);

                let decrypted = decipher.update(encrypted, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                return decrypted; // Success!
            } catch {
                // Try next candidate key in rotation pool
                continue;
            }
        }

        console.error('Decryption failed across all candidate keys.');
        return cipherText;
    }

    reencrypt(cipherText) {
        const decrypted = this.decrypt(cipherText);
        if (!decrypted || decrypted === cipherText) return cipherText;
        return this.encrypt(decrypted);
    }

    maskSecret(secret) {
        if (!secret || typeof secret !== 'string') return '••••••••••••';
        const str = secret.trim();
        if (str.length <= 4) return '••••••••';
        const visible = str.slice(-4);
        return '••••••••••••' + visible;
    }
}

module.exports = new EncryptionService();
