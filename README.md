# CryptoExpertTrade-inspired full-stack project

This is an actual React + Express application with a persistent SQLite database. It is an independently implemented visual approximation of https://cryptoexperttrades.vercel.app/, not a verified pixel-perfect clone. The reference could not be reliably inspected by automated page-text extraction, so compare screenshots in a browser before claiming a precise match.

## Features implemented

- Responsive public website with market-style hero, services, about, plan, contact, and footer sections
- React Router pages for login, registration, password-recovery information, assets, applications, user dashboard, and admin dashboard
- Express API with bcrypt password hashing, JWT authentication, role checks, and authentication rate limiting
- Persistent SQLite tables for users, ledger records, demo investments, support messages, and admin audit logs
- Demo deposit, withdrawal, and investment request flows; admin review and user enable/disable controls
- Environment configuration and single-server production serving of the built frontend

## Requirements

- Node.js 18 or newer
- npm

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Vite normally runs at `http://localhost:5173` and the API at `http://localhost:4000`. The local demo admin is `admin@example.com` with password `ChangeThisAdminPassword123!` unless you change the values in `.env`. Do not use those demo credentials on a public deployment.

## Build and serve

```bash
npm run build
npm start
```

Set `NODE_ENV=production`, a unique `JWT_SECRET` of at least 32 characters, `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD` of at least 14 characters for production. The server refuses to start in production if these security values are missing. Keep `.env` private.

## Deployment notes

Deploy to a Node.js host that supports a persistent disk for the SQLite database, and set `DATABASE_PATH` to a location on that disk. A static-only host such as a basic frontend deployment cannot run the Express API or persist this SQLite database by itself. If deploying frontend and API separately, configure the API URL and CORS before building.

## Important limitations

This project is a demo prototype, not a real broker, exchange, or investment service. It does not execute trades, custody cryptocurrency, connect to an exchange, send actual deposits or withdrawals, or pay returns. Deposit, withdrawal, and investment records are simulated. The dashboard explicitly labels demo data. Password reset email delivery, production email verification, real market-data integration, and payment-provider integration are not configured. Do not accept real customer funds until the business, applicable licensing, contracts, security, privacy obligations, and provider integrations have been independently reviewed.

## Troubleshooting

- If dependencies fail to install, use Node.js 18+ and rerun `npm install` with a working internet connection.
- If port 4000 is in use, change `PORT` in `.env`.
- If the database location is read-only, change `DATABASE_PATH` to a writable persistent location.
- The public reference may change over time; inspect it directly and compare desktop/mobile screenshots before making claims of visual exactness.

## Customer support and accepted payment addresses

The customer dashboard includes a Support area where signed-in customers can open a ticket, choose Bitcoin (BTC), USDT (BEP20), or a general question, add the payment amount and transaction hash, and continue the conversation after an administrator replies. The administrator dashboard includes a Customer support inbox for reading tickets, replying, and opening/closing tickets. Ticket messages and replies are stored in SQLite.

Configured addresses displayed by the project:
- BTC: `bc1qar0qgft08n0al3urce684l5eyfy9wlxzklrkwm`
- USDT (BEP20): `0x2cA8DDB21bC45fc007d1B804E2e31EEc07654fe5`

**Important:** the support inbox does not automatically verify blockchain payments or credit funds. Verify transaction hashes and the correct network independently before marking any payment as received. Never ask customers for seed phrases or private keys. These addresses were entered by the site owner and have not been independently verified here.

## Deploy to Render

This repository includes `render.yaml` for a Render Blueprint deployment. It configures a Node web service, builds the Vite frontend, runs the Express server, and mounts a persistent disk at `/var/data` for the SQLite database. The blueprint uses a paid Starter web service because Render persistent disks are not available on free web services.

1. Upload this project folder to a GitHub repository.
2. In Render, choose **New + → Blueprint** and connect that repository.
3. When prompted, enter `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` (at least 14 characters). Render generates `JWT_SECRET` automatically.
4. Apply the blueprint and wait for the deploy to finish. Open the `.onrender.com` URL shown on the Render service page.
5. Test registration, sign-in, and support ticket/reply flow before inviting customers.

This is still a prototype: deposit/withdrawal/investment workflows are demo-only and payments are not automatically verified on-chain. Do not represent demo balances, returns, or transactions as real. Never store customer wallet seed phrases or private keys.
