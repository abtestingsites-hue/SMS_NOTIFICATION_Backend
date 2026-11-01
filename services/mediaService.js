const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const storageProvider = require('./storageProvider');

const MEDIA_DB_PATH = path.join(__dirname, '..', 'data', 'media.json');
const MEDIA_DIR = path.join(__dirname, '..', 'uploads', 'media');

class MediaService {
    constructor() {
        this.lock = Promise.resolve();
    }

    async _read() {
        try {
            const raw = await fs.readFile(MEDIA_DB_PATH, 'utf8');
            return JSON.parse(raw);
        } catch {
            const initial = { media: [] };
            await this._write(initial);
            return initial;
        }
    }

    async _write(data) {
        await (this.lock = this.lock.then(async () => {
            await fs.writeFile(MEDIA_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
        }));
    }

    determineMediaType(mimeType) {
        if (!mimeType) return 'document';
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.startsWith('video/')) return 'video';
        if (mimeType === 'application/pdf') return 'document';
        return 'document';
    }

    async getAll(query = {}) {
        const db = await this._read();
        let items = db.media || [];

        if (query.type && query.type !== 'all') {
            items = items.filter(m => m.mediaType === query.type);
        }

        if (query.search) {
            const q = query.search.toLowerCase();
            items = items.filter(m =>
                (m.originalName && m.originalName.toLowerCase().includes(q)) ||
                (m.caption && m.caption.toLowerCase().includes(q)) ||
                (m.tags && m.tags.some(t => t.toLowerCase().includes(q)))
            );
        }

        return items.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    }

    async getById(id) {
        const db = await this._read();
        return (db.media || []).find(m => String(m.id) === String(id)) || null;
    }

    async registerUpload(file, { caption = '', tags = [] } = {}) {
        if (!file) throw new Error('No file provided');

        // Durable verification: Read file to validate magic bytes & compute SHA-256
        const filePath = file.path;
        const fileBuffer = await fs.readFile(filePath);

        const isValid = storageProvider.validateMagicBytes(fileBuffer, file.mimetype);
        if (!isValid) {
            try { await fs.unlink(filePath); } catch (e) {}
            throw new Error(`File integrity check failed: Content signature does not match declared MIME type ${file.mimetype}`);
        }

        const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        const db = await this._read();
        if (!db.media) db.media = [];

        const mediaType = this.determineMediaType(file.mimetype);
        const recordId = 'med_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        const record = {
            id: recordId,
            filename: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            mediaType: mediaType,
            size: file.size,
            checksum,
            storageDriver: 'DURABLE_OBJECT_STORAGE',
            magicBytesVerified: true,
            url: `/uploads/media/${file.filename}`,
            assetStreamUrl: `/api/media/asset/${recordId}`,
            uploadedAt: new Date().toISOString(),
            caption: caption || '',
            tags: Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(Boolean) : []),
            references: []
        };

        db.media.unshift(record);
        await this._write(db);
        return record;
    }

    async update(id, updates) {
        const db = await this._read();
        const index = (db.media || []).findIndex(m => String(m.id) === String(id));
        if (index === -1) throw new Error('Media asset not found');

        const current = db.media[index];
        db.media[index] = {
            ...current,
            caption: updates.caption !== undefined ? updates.caption : current.caption,
            tags: updates.tags !== undefined ? updates.tags : current.tags
        };

        await this._write(db);
        return db.media[index];
    }

    async delete(id, { force = false } = {}) {
        const db = await this._read();
        const item = (db.media || []).find(m => String(m.id) === String(id));
        if (!item) throw new Error('Media asset not found');

        if (!force && item.references && item.references.length > 0) {
            return {
                success: false,
                referenced: true,
                references: item.references,
                message: `Asset is referenced in ${item.references.length} campaign(s) or template(s). Confirm force deletion.`
            };
        }

        // Remove disk file
        const filePath = path.join(MEDIA_DIR, item.filename);
        try {
            await fs.unlink(filePath);
        } catch (e) {
            console.warn(`File unlink warning for ${filePath}:`, e.message);
        }

        // Remove from DB
        db.media = db.media.filter(m => String(m.id) !== String(id));
        await this._write(db);
        return { success: true, deletedId: id };
    }

    async addReference(mediaId, referenceDescriptor) {
        const db = await this._read();
        const item = (db.media || []).find(m => String(m.id) === String(mediaId));
        if (item) {
            if (!item.references) item.references = [];
            if (!item.references.includes(referenceDescriptor)) {
                item.references.push(referenceDescriptor);
                await this._write(db);
            }
        }
    }
}

module.exports = new MediaService();

