const fs = require('fs');
const FormData = require('form-data');
const http = require('http');
const path = require('path');

const uploadFile = (filePath, type) => {
    return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));

        const request = http.request({
            host: 'localhost',
            port: 3000,
            path: `/api/upload/${type}`,
            method: 'POST',
            headers: form.getHeaders()
        }, response => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => resolve(JSON.parse(data)));
        });

        form.pipe(request);
        request.on('error', reject);
    });
};

const startCampaign = () => {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: 'localhost',
            port: 3000,
            path: '/api/campaigns/start',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, response => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => resolve(JSON.parse(data)));
        });

        req.write(JSON.stringify({ name: 'Automated Test Campaign', scheduleDelayHours: 0 }));
        req.end();
        req.on('error', reject);
    });
};

async function run() {
    try {
        console.log('Uploading Customers...');
        const custRes = await uploadFile(path.join(__dirname, 'sample_customers.csv'), 'customers');
        console.log('Customers Uploaded:', custRes);

        console.log('Uploading Offers...');
        const offerRes = await uploadFile(path.join(__dirname, 'sample_offers.csv'), 'offers');
        console.log('Offers Uploaded:', offerRes);

        console.log('Starting Campaign...');
        const campRes = await startCampaign();
        console.log('Campaign Started:', campRes);
    } catch (error) {
        console.error('Test Failed:', error);
    }
}

run();
