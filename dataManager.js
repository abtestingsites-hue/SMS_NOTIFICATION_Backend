const fs = require('fs').promises;
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const CUST_PATH = path.join(__dirname, 'data', 'customers.json');
const TEMPLATES_PATH = path.join(__dirname, 'data', 'templates.json');

class DataManager {
    constructor() {
        this.locks = { main: Promise.resolve(), cust: Promise.resolve(), tmpl: Promise.resolve() };
    }

    // Generic Read
    async _readRaw(filePath) {
        try {
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (filePath === CUST_PATH) return { customers: [] };
            if (filePath === TEMPLATES_PATH) return {};
            return { campaigns: [], offers: [], template: "Hi {{1}}...", settings: {} };
        }
    }

    async _writeRaw(filePath, data) {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    }

    // --- Customer Operations (customers.json) ---
    async getCustomers() {
        const db = await this._readRaw(CUST_PATH);
        return db.customers || [];
    }

    async addCustomers(newCustomers) {
        const result = await (this.locks.cust = this.locks.cust.then(async () => {
            const db = await this._readRaw(CUST_PATH);
            if (!db.customers) db.customers = [];

            const existingPhones = new Set(db.customers.map(c => String(c.phone)));

            const uniqueNewCustomers = newCustomers.filter(c => {
                if (!c.phone) return true;
                if (existingPhones.has(String(c.phone))) return false;

                existingPhones.add(String(c.phone));
                return true;
            });

            if (uniqueNewCustomers.length > 0) {
                db.customers.push(...uniqueNewCustomers);
                await this._writeRaw(CUST_PATH, db);
            }

            return db.customers.length;
        }).catch(console.error));
        return result;
    }

    async updateCustomerHistory(phone, templateId) {
        await (this.locks.cust = this.locks.cust.then(async () => {
            const db = await this._readRaw(CUST_PATH);
            const customer = db.customers.find(c => c.phone === phone);
            if (customer) {
                if (!customer.history) customer.history = [];
                customer.history.push(templateId);
                customer.lastContacted = Date.now();
                await this._writeRaw(CUST_PATH, db);
            }
        }).catch(console.error));
    }

    async resetCustomerHistory(phone) {
        await (this.locks.cust = this.locks.cust.then(async () => {
            const db = await this._readRaw(CUST_PATH);
            const customer = db.customers.find(c => c.phone === phone);
            if (customer) {
                customer.history = [];
                await this._writeRaw(CUST_PATH, db);
            }
        }).catch(console.error));
    }

    // --- Campaign/Template Operations (db.json & templates.json) ---
    async _getMainDB() {
        return await this._readRaw(DB_PATH);
    }

    async _saveMainDB(data) {
        await (this.locks.main = this.locks.main.then(async () => {
            await this._writeRaw(DB_PATH, data);
        }).catch(console.error));
    }

    async createCampaign(campaign) {
        const db = await this._getMainDB();
        if (!db.campaigns) db.campaigns = [];
        db.campaigns.push(campaign);
        await this._saveMainDB(db);
        return campaign;
    }

    async getCampaign(id) {
        const db = await this._getMainDB();
        return db.campaigns ? db.campaigns.find(c => c.id === id) : null;
    }

    async getActiveCampaigns() {
        const db = await this._getMainDB();
        if (!db.campaigns) return [];
        return db.campaigns.filter(c => ['PROCESSING', 'SCHEDULED', 'PENDING'].includes(c.status));
    }

    async updateCampaign(id, updates) {
        const result = await (this.locks.main = this.locks.main.then(async () => {
            const db = await this._readRaw(DB_PATH);
            if (!db.campaigns) db.campaigns = [];

            const index = db.campaigns.findIndex(c => c.id === id);
            if (index !== -1) {
                db.campaigns[index] = { ...db.campaigns[index], ...updates };
                await this._writeRaw(DB_PATH, db);
                return db.campaigns[index];
            }
            return null;
        }).catch(console.error));
        return result;
    }

    async getOffers() {
        const db = await this._getMainDB();
        return db.offers || [];
    }

    async addOffers(newOffers) {
        const db = await this._getMainDB();
        if (!db.offers) db.offers = [];
        db.offers.push(...newOffers);
        await this._saveMainDB(db);
        return db.offers.length;
    }

    async getCategoryTemplates() {
        return await this._readRaw(TEMPLATES_PATH);
    }

    async saveCategoryTemplates(templates) {
        await (this.locks.tmpl = this.locks.tmpl.then(async () => {
            await this._writeRaw(TEMPLATES_PATH, templates);
        }).catch(console.error));
    }

    async getTemplate() {
        const db = await this._getMainDB();
        return db.template || "";
    }

    async saveTemplate(template) {
        const db = await this._getMainDB();
        db.template = template;
        await this._saveMainDB(db);
        return db.template;
    }

    // --- Settings & Dual Platform Configuration ---
    async getSettings() {
        const db = await this._getMainDB();
        return db.settings || {
            customerCareNumber: process.env.CUSTOMER_CARE_NUMBER || '+916369825386',
            sendToCustomerCare: true,
            sendToCarePerCustomer: false,
            platform: 'both' // 'both' | 'whatsapp' | 'sms'
        };
    }

    async saveSettings(settings) {
        const db = await this._getMainDB();
        db.settings = {
            ...(db.settings || {
                customerCareNumber: process.env.CUSTOMER_CARE_NUMBER || '+916369825386',
                sendToCustomerCare: true,
                sendToCarePerCustomer: false,
                platform: 'both'
            }),
            ...settings
        };
        await this._saveMainDB(db);
        return db.settings;
    }
}

module.exports = { DataManager: new DataManager() };
