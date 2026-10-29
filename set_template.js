const http = require('http');

const templateText = `Hi {{1}} 👋

✨ *Exclusive Offer Just for You!* ✨

{{2}}

⏰ *Offer Valid Until:* {{3}}

Visit our store and grab your favorite styles before time runs out.
Come and get it soon! 🛍️🔥

Reply *STOP* to opt out.`;

const data = JSON.stringify({
    template: templateText
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/template',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    res.on('data', (d) => {
        process.stdout.write(d);
    });
});

req.on('error', (error) => {
    console.error(error);
});

req.write(data);
req.end();
