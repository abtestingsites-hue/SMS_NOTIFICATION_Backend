require('dotenv').config();
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const waFrom = process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER || 'whatsapp:+14155238886';
const smsFrom = process.env.TWILIO_SMS_NUMBER || '+13185208639';
const targetNumber = process.env.CUSTOMER_CARE_NUMBER || '+916369825386';

console.log('--- Twilio Dual Platform Test (WhatsApp + Cellular SMS) ---');
console.log(`SID: ${accountSid ? '✅ Received' : '❌ Missing'}`);
console.log(`Token: ${authToken ? '✅ Received' : '❌ Missing'}`);
console.log(`WhatsApp Sender: ${waFrom}`);
console.log(`Cellular SMS Sender: ${smsFrom}`);
console.log(`Target Number: ${targetNumber}`);

if (!accountSid || !authToken) {
    console.error('❌ Missing credentials in .env file');
    process.exit(1);
}

const client = new twilio(accountSid, authToken);

let clean = targetNumber.trim().replace(/\s+/g, '').replace(/^whatsapp:/i, '');
if (/^\d{10}$/.test(clean)) clean = '+91' + clean;
else if (!clean.startsWith('+')) clean = '+' + clean;

async function runTests() {
    // 1. WhatsApp Test
    console.log(`\n1️⃣ Testing WhatsApp to whatsapp:${clean} from ${waFrom}...`);
    try {
        const waMsg = await client.messages.create({
            body: '🔔 Dual Platform Test: WhatsApp message delivered successfully.',
            from: waFrom,
            to: `whatsapp:${clean}`
        });
        console.log(`✅ WhatsApp Delivered! SID: ${waMsg.sid}`);
    } catch (e) {
        console.error(`❌ WhatsApp Failed: ${e.message} (Code: ${e.code})`);
    }

    // 2. Cellular SMS Test
    console.log(`\n2️⃣ Testing Cellular SMS to ${clean} from ${smsFrom}...`);
    try {
        const smsMsg = await client.messages.create({
            body: '🔔 Dual Platform Test: Cellular SMS delivered successfully.',
            from: smsFrom,
            to: clean
        });
        console.log(`✅ Cellular SMS Delivered! SID: ${smsMsg.sid}`);
    } catch (e) {
        console.error(`❌ Cellular SMS Failed: ${e.message} (Code: ${e.code})`);
        if (e.code === 21608) {
            console.log('💡 Note: Twilio trial accounts require recipient numbers to be verified under Verified Caller IDs (or account upgrade).');
        }
    }
}

runTests();
