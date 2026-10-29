# SMS & WhatsApp Marketing Campaign - Backend

Node.js and Express backend engine powering dual-channel SMS and WhatsApp promotional marketing campaigns with Twilio integration.

## Features
- **Dual Channel Dispatch**: Dispatches marketing campaigns simultaneously across Cellular SMS and WhatsApp.
- **Smart Queue & Scheduling**: Automated queue scheduler with rate limiting and campaign expiration checks.
- **Target Audience Segmentation**: Filter campaigns by demographic (Men, Women, Boys, Girls, Children, All).
- **Customer Care Verification**: Automated preview and broadcast copies dispatched directly to Customer Care.
- **Single Recipient Test Suite**: Dedicated endpoint to test individual customer delivery without exhausting campaign quotas.
- **Trial & Carrier Compliance**: Automatic message segmentation and GSM-7 formatting for cellular networks.

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your Twilio credentials:
```bash
cp .env.example .env
```

```env
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
TWILIO_SMS_NUMBER=+12202404020
CUSTOMER_CARE_NUMBER=+916369825386
```

### 3. Run the Server
```bash
# Production / Standard
node index.js

# Development (auto-reload)
npx nodemon index.js
```
The server will run on `http://localhost:3000`.

