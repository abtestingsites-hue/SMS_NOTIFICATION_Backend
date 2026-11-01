const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');

const MEDIA_DIR = path.join(__dirname, '..', 'uploads', 'media');
if (!fsSync.existsSync(MEDIA_DIR)) {
    fsSync.mkdirSync(MEDIA_DIR, { recursive: true });
}

class StorageProvider {
    constructor() {
        this.driver = process.env.STORAGE_DRIVER || 'DURABLE_OBJECT_STORAGE'; // DURABLE_OBJECT_STORAGE | S3_BUCKET
        this.s3Bucket = process.env.S3_BUCKET_NAME || '';
    }

    validateMagicBytes(buffer, mimeType) {
        if (!buffer || buffer.length < 4) return false;

        const hex = buffer.slice(0, 12).toString('hex').toLowerCase();

        if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
            return hex.startsWith('ffd8ff');
        }
        if (mimeType === 'image/png') {
            return hex.startsWith('89504e47');
        }
        if (mimeType === 'image/webp') {
            // RIFF....WEBP
            return hex.startsWith('52494646') && buffer.slice(8, 12).toString('ascii') === 'WEBP';
        }
        if (mimeType === 'application/pdf') {
            return hex.startsWith('25504446'); // %PDF
        }
        if (mimeType === 'video/mp4') {
            // ftyp box
            return buffer.slice(4, 8).toString('ascii') === 'ftyp';
        }

        return true;
    }

    async saveAsset(fileBuffer, originalFilename, mimeType) {
        // 1. Validate magic bytes
        const isValidMagic = this.validateMagicBytes(fileBuffer, mimeType);
        if (!isValidMagic) {
            throw new Error(`File integrity check failed: Content signature does not match declared MIME type ${mimeType}`);
        }

        // 2. Compute SHA-256 checksum
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        // 3. Generate immutable filename
        const ext = path.extname(originalFilename).toLowerCase();
        const storedFilename = `durable_${Date.now()}_${hash.substring(0, 12)}${ext}`;
        const targetPath = path.join(MEDIA_DIR, storedFilename);

        // 4. Save to persistent storage
        await fs.writeFile(targetPath, fileBuffer);

        return {
            storedFilename,
            checksum: hash,
            sizeBytes: fileBuffer.length,
            targetPath,
            storageDriver: this.driver
        };
    }

    async readAsset(storedFilename) {
        const filePath = path.join(MEDIA_DIR, storedFilename);
        try {
            await fs.access(filePath);
            return await fs.readFile(filePath);
        } catch {
            throw new Error(`Storage asset not found: ${storedFilename}`);
        }
    }

    async deleteAsset(storedFilename) {
        const filePath = path.join(MEDIA_DIR, storedFilename);
        try {
            await fs.unlink(filePath);
            return true;
        } catch (e) {
            console.warn(`Asset deletion note (${storedFilename}):`, e.message);
            return false;
        }
    }

    getAssetPath(storedFilename) {
        return path.join(MEDIA_DIR, storedFilename);
    }
}

module.exports = new StorageProvider();

