require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 4000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
if (IS_PRODUCTION && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('Production requires JWT_SECRET with at least 32 characters.');
}
if (IS_PRODUCTION && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 14)) {
  throw new Error('Production requires ADMIN_EMAIL and an ADMIN_PASSWORD of at least 14 characters.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'local-development-secret-change-before-deployment-123456';
const dbPath = path.resolve(process.env.DATABASE_PATH || './data/cryptoexperttrades.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 80, standardHeaders: true, legacyHeaders: false }));

const plans = [
  { id: 1, name: 'Market Explorer', rate: 'Demo access', duration: 'Flexible', min: 0, max: null, referral: 'Not enabled', support: 'Standard support' },
  { id: 2, name: 'Portfolio Workspace', rate: 'Demo access', duration: 'Flexible', min: 0, max: null, referral: 'Not enabled', support: 'Standard support' },
  { id: 3, name: 'Advanced Markets', rate: 'Demo access', duration: 'Flexible', min: 0, max: null, referral: 'Not enabled', support: 'Demo support' },
  { id: 4, name: 'Research Workspace', rate: 'Demo access', duration: 'Flexible', min: 0, max: null, referral: 'Not enabled', support: 'Demo support' },
  { id: 5, name: 'Pro Tools Preview', rate: 'Demo access', duration: 'Flexible', min: 0, max: null, referral: 'Not enabled', support: 'Demo support' },
  { id: 6, name: 'Full Platform Preview', rate: 'Demo access', duration: 'Flexible', min: 0, max: null, referral: 'Not enabled', support: 'Demo support' }
];

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', referral_code TEXT NOT NULL UNIQUE,
 referred_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, active INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(referred_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kind TEXT NOT NULL,
 amount_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reference TEXT NOT NULL UNIQUE,
 note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS investments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, plan_id INTEGER NOT NULL,
 amount_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'demo_pending', reference TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS support_tickets (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT NOT NULL, email TEXT NOT NULL,
 subject TEXT NOT NULL, message TEXT NOT NULL, payment_method TEXT NOT NULL DEFAULT '', tx_hash TEXT NOT NULL DEFAULT '', payment_amount TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS support_replies (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, sender_id INTEGER, sender_role TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE, FOREIGN KEY(sender_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS audit_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, action TEXT NOT NULL, target TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Backfill columns when upgrading an existing local database created by an earlier version.
const supportColumns = new Set(db.prepare('PRAGMA table_info(support_tickets)').all().map(column => column.name));
for (const [name, declaration] of [['payment_method', "TEXT NOT NULL DEFAULT ''"], ['tx_hash', "TEXT NOT NULL DEFAULT ''"], ['payment_amount', "TEXT NOT NULL DEFAULT ''"]]) {
 if (!supportColumns.has(name)) db.exec(`ALTER TABLE support_tickets ADD COLUMN ${name} ${declaration}`);
}

function randomCode(prefix='SS') { return `${prefix}-${require('crypto').randomBytes(5).toString('hex').toUpperCase()}`; }
function seedAdmin() {
 const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
 const exists = db.prepare('SELECT id FROM users WHERE email=?').get(email);
 if (!exists) {
  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeThisAdminPassword123!';
  const hash = bcrypt.hashSync(adminPassword, 12);
  db.prepare('INSERT INTO users(name,email,password_hash,role,referral_code) VALUES(?,?,?,?,?)').run('Site Administrator', email, hash, 'admin', randomCode('ADMIN'));
  console.log(`Development admin created: ${email}. ${IS_PRODUCTION ? 'Use your configured production credentials.' : 'Local demo password is ChangeThisAdminPassword123!; change it before deployment.'}`);
 }
}
seedAdmin();

function tokenFor(user) { return jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '12h' }); }
function auth(req, res, next) {
 const header = req.headers.authorization || '';
 const token = header.startsWith('Bearer ') ? header.slice(7) : '';
 if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
 try { req.user = jwt.verify(token, JWT_SECRET); next(); }
 catch { return res.status(401).json({ error: 'Your session has expired. Please sign in again.' }); }
}
function adminOnly(req, res, next) { if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' }); next(); }
function publicUser(row) { return { id: row.id, name: row.name, email: row.email, role: row.role, referralCode: row.referral_code, createdAt: row.created_at }; }
function getUser(id) { return db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(id); }
function totals(userId) {
 const sums = db.prepare(`SELECT
 COALESCE(SUM(CASE WHEN kind='deposit' AND status='approved' THEN amount_cents ELSE 0 END),0) deposits,
 COALESCE(SUM(CASE WHEN kind='withdrawal' AND status IN ('approved','completed') THEN amount_cents ELSE 0 END),0) withdrawals,
 COALESCE(SUM(CASE WHEN kind='demo_credit' AND status='approved' THEN amount_cents ELSE 0 END),0) demoCredits
 FROM ledger WHERE user_id=?`).get(userId);
 const invested = db.prepare("SELECT COALESCE(SUM(amount_cents),0) amount FROM investments WHERE user_id=? AND status!='rejected'").get(userId).amount;
 const available = sums.deposits + sums.demoCredits - sums.withdrawals - invested;
 return { totalDeposits: sums.deposits / 100, totalWithdrawals: sums.withdrawals / 100, totalInvestments: invested / 100, availableBalance: available / 100, demoMode: true };
}
function audit(adminId, action, target) { db.prepare('INSERT INTO audit_logs(admin_id,action,target) VALUES(?,?,?)').run(adminId, action, target); }

app.get('/api/health', (req,res) => res.json({ ok:true, mode:'demo', message:'API is running. Financial workflows are demo-only.' }));
app.get('/api/plans', (req,res) => res.json({ plans, disclaimer: 'Rates and terms are unverified reference-site claims, shown for design demonstration only. No returns are promised.' }));
app.post('/api/auth/register', (req,res) => {
 const name = String(req.body.name || '').trim(); const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || ''); const confirm = String(req.body.confirmPassword || ''); const referral = String(req.body.referralCode || '').trim();
 if (name.length < 2 || name.length > 100) return res.status(400).json({ error:'Enter your full name.' });
 if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error:'Enter a valid email address.' });
 if (password.length < 10) return res.status(400).json({ error:'Password must be at least 10 characters.' });
 if (password !== confirm) return res.status(400).json({ error:'Passwords do not match.' });
 if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(409).json({ error:'An account with this email already exists.' });
 let referredBy = null;
 if (referral) { const refUser = db.prepare('SELECT id FROM users WHERE referral_code=?').get(referral); if (refUser) referredBy = refUser.id; }
 const result = db.prepare('INSERT INTO users(name,email,password_hash,role,referral_code,referred_by) VALUES(?,?,?,?,?,?)').run(name,email,bcrypt.hashSync(password,12),'user',randomCode(),referredBy);
 const user = getUser(result.lastInsertRowid); res.status(201).json({ token:tokenFor(user), user:publicUser(user) });
});
app.post('/api/auth/login', (req,res) => {
 const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
 const user = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
 if (!user || !bcrypt.compareSync(password,user.password_hash)) return res.status(401).json({ error:'Email or password is incorrect.' });
 res.json({ token:tokenFor(user), user:publicUser(user) });
});
app.get('/api/me', auth, (req,res) => { const user = getUser(req.user.id); if (!user) return res.status(401).json({error:'Account unavailable.'}); res.json({ user:publicUser(user), totals:totals(user.id) }); });
app.get('/api/dashboard', auth, (req,res) => {
 const user = getUser(req.user.id); if (!user) return res.status(401).json({error:'Account unavailable.'});
 const transactions = db.prepare('SELECT id,kind,amount_cents,status,reference,note,created_at FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 30').all(user.id).map(x=>({...x,amount:x.amount_cents/100}));
 const investments = db.prepare('SELECT i.*,p.name plan_name FROM investments i LEFT JOIN (SELECT 1 id, "Seed Trade" name UNION SELECT 2,"Standard Trade" UNION SELECT 3,"Elite Trade" UNION SELECT 4,"VIP Trade" UNION SELECT 5,"Gold Trade" UNION SELECT 6,"Life Insurance Trade") p ON p.id=i.plan_id WHERE i.user_id=? ORDER BY i.id DESC LIMIT 30').all(user.id).map(x=>({...x,amount:x.amount_cents/100}));
 res.json({ user:publicUser(user), totals:totals(user.id), transactions, investments });
});
app.post('/api/demo/deposit', auth, (req,res) => {
 if (process.env.DEMO_MODE === 'false') return res.status(403).json({error:'Demo transactions are disabled.'});
 const amount = Number(req.body.amount); if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) return res.status(400).json({error:'Enter a demo amount between $1 and $1,000,000.'});
 const reference = randomCode('DEMO'); db.prepare('INSERT INTO ledger(user_id,kind,amount_cents,status,reference,note) VALUES(?,?,?,?,?,?)').run(req.user.id,'deposit',Math.round(amount*100),'pending',reference,'Demo deposit request; not real money.');
 res.status(201).json({message:'Demo deposit request recorded as pending. No payment was made and no funds were credited.',reference});
});
app.post('/api/demo/withdraw', auth, (req,res) => {
 if (process.env.DEMO_MODE === 'false') return res.status(403).json({error:'Demo transactions are disabled.'});
 const amount = Number(req.body.amount); if (!Number.isFinite(amount) || amount < 1) return res.status(400).json({error:'Enter a valid amount.'});
 const cents = Math.round(amount * 100); const reference = randomCode('WD');
 try {
  const create = db.transaction(() => {
   const current = totals(req.user.id);
   if (cents > Math.round(current.availableBalance * 100)) throw new Error('INSUFFICIENT_DEMO_BALANCE');
   db.prepare('INSERT INTO ledger(user_id,kind,amount_cents,status,reference,note) VALUES(?,?,?,?,?,?)').run(req.user.id,'withdrawal',cents,'pending',reference,'Demo withdrawal request; not real money.');
  });
  create();
 } catch (error) { if (error.message === 'INSUFFICIENT_DEMO_BALANCE') return res.status(400).json({error:'Insufficient available demo balance.'}); throw error; }
 res.status(201).json({message:'Demo withdrawal request recorded as pending. No payment was sent.',reference});
});
app.post('/api/demo/invest', auth, (req,res) => {
 if (process.env.DEMO_MODE === 'false') return res.status(403).json({error:'Demo investments are disabled.'});
 const plan = plans.find(p=>p.id===Number(req.body.planId)); const amount = Number(req.body.amount);
 if (!plan) return res.status(400).json({error:'Choose a valid plan.'});
 if (!Number.isFinite(amount) || amount < plan.min || (plan.max && amount > plan.max)) return res.status(400).json({error:`Amount must be between $${plan.min.toLocaleString()} and ${plan.max ? '$'+plan.max.toLocaleString() : 'no stated maximum'}.`});
 const cents = Math.round(amount * 100); const reference = randomCode('INV');
 try {
  const create = db.transaction(() => {
   const balance = totals(req.user.id).availableBalance;
   if (cents > Math.round(balance * 100)) throw new Error('INSUFFICIENT_DEMO_BALANCE');
   db.prepare('INSERT INTO investments(user_id,plan_id,amount_cents,status,reference) VALUES(?,?,?,?,?)').run(req.user.id,plan.id,cents,'demo_pending',reference);
  });
  create();
 } catch (error) { if (error.message === 'INSUFFICIENT_DEMO_BALANCE') return res.status(400).json({error:'Insufficient demo balance. No real money can be invested in this prototype.'}); throw error; }
 res.status(201).json({message:'Demo investment recorded. This is not a real investment and no returns will be paid.',reference});
});
app.get('/api/payment-methods', (req,res) => res.json({ methods: [{ id:'BTC', name:'Bitcoin (BTC)', address:'bc1qar0qgft08n0al3urce684l5eyfy9wlxzklrkwm' }, { id:'USDT_BEP20', name:'USDT (BEP20)', address:'0x2cA8DDB21bC45fc007d1B804E2e31EEc07654fe5' }] }));
app.get('/api/support', auth, (req,res) => {
 const tickets=db.prepare('SELECT * FROM support_tickets WHERE user_id=? ORDER BY id DESC').all(req.user.id);
 const replies=db.prepare('SELECT r.* FROM support_replies r JOIN support_tickets t ON t.id=r.ticket_id WHERE t.user_id=? ORDER BY r.id').all(req.user.id);
 res.json({tickets,replies});
});
app.post('/api/support', auth, (req,res) => {
 const subject=String(req.body.subject||'').trim().slice(0,160), message=String(req.body.message||'').trim().slice(0,5000);
 const paymentMethod=String(req.body.paymentMethod||'').trim(); const txHash=String(req.body.txHash||'').trim().slice(0,200); const paymentAmount=String(req.body.paymentAmount||'').trim().slice(0,80);
 if(subject.length<3 || message.length<5) return res.status(400).json({error:'Enter a subject and a message of at least 5 characters.'});
 if(paymentMethod && !['BTC','USDT_BEP20','OTHER'].includes(paymentMethod)) return res.status(400).json({error:'Choose a valid payment method.'});
 const user=getUser(req.user.id); if(!user) return res.status(401).json({error:'Account unavailable.'});
 const result=db.prepare('INSERT INTO support_tickets(user_id,name,email,subject,message,payment_method,tx_hash,payment_amount) VALUES(?,?,?,?,?,?,?,?)').run(user.id,user.name,user.email,subject,message,paymentMethod,txHash,paymentAmount);
 res.status(201).json({message:'Your support ticket has been submitted.',ticketId:result.lastInsertRowid});
});
app.post('/api/support/:id/reply', auth, (req,res) => {
 const ticket=db.prepare('SELECT * FROM support_tickets WHERE id=? AND user_id=?').get(Number(req.params.id),req.user.id); if(!ticket) return res.status(404).json({error:'Support ticket not found.'});
 const message=String(req.body.message||'').trim().slice(0,5000); if(message.length<2) return res.status(400).json({error:'Enter a reply.'});
 db.prepare('INSERT INTO support_replies(ticket_id,sender_id,sender_role,message) VALUES(?,?,?,?)').run(ticket.id,req.user.id,'user',message); db.prepare("UPDATE support_tickets SET status='open' WHERE id=?").run(ticket.id); res.status(201).json({message:'Your reply has been sent.'});
});
app.post('/api/contact', (req,res) => {
 const name=String(req.body.name||'').trim(), email=String(req.body.email||'').trim(), subject=String(req.body.subject||'').trim(), message=String(req.body.message||'').trim();
 if (!name || !/^\S+@\S+\.\S+$/.test(email) || !subject || message.length<5) return res.status(400).json({error:'Complete all fields with a valid email address.'});
 db.prepare('INSERT INTO support_tickets(name,email,subject,message) VALUES(?,?,?,?)').run(name,email,subject,message);
 res.status(201).json({message:'Your message has been saved to the demo inbox.'});
});
app.get('/api/admin/support', auth, adminOnly, (req,res) => {
 const tickets=db.prepare(`SELECT t.*,u.role user_role FROM support_tickets t LEFT JOIN users u ON u.id=t.user_id ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END, t.id DESC`).all();
 const replies=db.prepare('SELECT * FROM support_replies ORDER BY id').all(); res.json({tickets,replies});
});
app.post('/api/admin/support/:id/reply', auth, adminOnly, (req,res) => {
 const ticket=db.prepare('SELECT * FROM support_tickets WHERE id=?').get(Number(req.params.id)); if(!ticket) return res.status(404).json({error:'Support ticket not found.'});
 const message=String(req.body.message||'').trim().slice(0,5000); if(message.length<2) return res.status(400).json({error:'Enter a reply.'});
 db.prepare('INSERT INTO support_replies(ticket_id,sender_id,sender_role,message) VALUES(?,?,?,?)').run(ticket.id,req.user.id,'admin',message); db.prepare("UPDATE support_tickets SET status='waiting' WHERE id=?").run(ticket.id); audit(req.user.id,'support_reply',String(ticket.id)); res.status(201).json({message:'Reply sent to customer.'});
});
app.post('/api/admin/support/:id/status', auth, adminOnly, (req,res) => {
 const status=String(req.body.status||''); if(!['open','waiting','closed'].includes(status)) return res.status(400).json({error:'Invalid support status.'});
 const ticket=db.prepare('SELECT id FROM support_tickets WHERE id=?').get(Number(req.params.id)); if(!ticket) return res.status(404).json({error:'Support ticket not found.'});
 db.prepare('UPDATE support_tickets SET status=? WHERE id=?').run(status,ticket.id); audit(req.user.id,'support_status',`${ticket.id}:${status}`); res.json({message:`Ticket marked ${status}.`});
});
app.get('/api/admin/summary', auth, adminOnly, (req,res) => {
 const users=db.prepare('SELECT id,name,email,role,active,created_at FROM users ORDER BY id DESC LIMIT 100').all();
 const ledger=db.prepare('SELECT l.*,u.email FROM ledger l JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 100').all().map(x=>({...x,amount:x.amount_cents/100}));
 const pending=db.prepare("SELECT COUNT(*) n FROM ledger WHERE status='pending'").get().n;
 const investmentCount=db.prepare('SELECT COUNT(*) n FROM investments').get().n;
 const logs=db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50').all();
 const supportCount=db.prepare("SELECT COUNT(*) n FROM support_tickets WHERE status!='closed'").get().n; res.json({users,ledger,pending,investmentCount,logs,supportCount,mode:'demo'});
});
app.post('/api/admin/ledger/:id/review', auth, adminOnly, (req,res) => {
 const status=String(req.body.status||''); if (!['approved','rejected','completed'].includes(status)) return res.status(400).json({error:'Invalid status.'});
 const item=db.prepare('SELECT * FROM ledger WHERE id=?').get(Number(req.params.id)); if (!item) return res.status(404).json({error:'Transaction not found.'});
 // Deposits are intentionally not credited by admin approval in this prototype.
 db.prepare('UPDATE ledger SET status=? WHERE id=?').run(status,item.id); audit(req.user.id,`ledger_${status}`,item.reference);
 res.json({message:`Transaction status updated to ${status}. This remains demo data.`});
});
app.post('/api/admin/users/:id/toggle', auth, adminOnly, (req,res) => {
 const userId=Number(req.params.id); if (userId===req.user.id) return res.status(400).json({error:'You cannot deactivate your own admin account.'});
 const user=getUser(userId); if (!user) return res.status(404).json({error:'User not found.'});
 db.prepare('UPDATE users SET active=? WHERE id=?').run(user.active?0:1,userId); audit(req.user.id,'toggle_user',String(userId)); res.json({message:'User status updated.'});
});

const dist = path.resolve(__dirname, '../dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get('*', (req,res,next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(dist,'index.html'))); }
app.use((err,req,res,next)=>{ console.error(err); res.status(500).json({error:'Unexpected server error.'}); });
app.listen(PORT, ()=>console.log(`CryptoExpertTrade demo API running on http://localhost:${PORT}`));
