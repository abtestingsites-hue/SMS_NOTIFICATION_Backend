const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'db.json');
const custPath = path.join(__dirname, 'data', 'customers.json');

try {
    const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

    // Extract customers
    const customers = dbData.customers || [];

    // Write new file
    fs.writeFileSync(custPath, JSON.stringify({ customers }, null, 2));
    console.log(`✅ Migrated ${customers.length} customers into customers.json`);

    // Remove from db.json
    delete dbData.customers;
    fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2));
    console.log("✅ Removed customers from db.json");

} catch (e) {
    console.error("Migration failed:", e);
}
