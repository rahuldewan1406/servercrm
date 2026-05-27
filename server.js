'use strict';
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { SESClient, SendEmailCommand, GetAccountSendingEnabledCommand } = require('@aws-sdk/client-ses');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValid  = a => typeof a === 'string' && EMAIL_RE.test(a.trim());

const rlMap = new Map();
function rateLimiter(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = rlMap.get(ip) || { count:0, start:now };
  if (now - rec.start > 60000) { rec.count=0; rec.start=now; }
  rec.count++;
  rlMap.set(ip, rec);
  if (rec.count > 10) return res.status(429).json({ message:'Too many requests. Wait 60s.' });
  next();
}
setInterval(() => { const now=Date.now(); for(const[ip,r]of rlMap)if(now-r.start>120000)rlMap.delete(ip); }, 60000);

const SES_REGION    = process.env.SES_REGION    || 'ap-south-1';
const SES_FROM      = process.env.SES_FROM_EMAIL || 'noreply@dic.org.in';
const SES_FROM_NAME = process.env.SES_FROM_NAME  || 'DIC-NHAI CRM';

const ses = new SESClient({ region: SES_REGION });

async function checkSES() {
  try {
    await ses.send(new GetAccountSendingEnabledCommand({}));
    console.log(`[SES] Connected ✅  region:${SES_REGION}  from:${SES_FROM}`);
  } catch(e) {
    console.warn(`[SES] Check failed: ${e.message}`);
  }
}
checkSES();

app.post('/api/send-email', rateLimiter, async (req, res) => {
  const { to, subject, body, html, replyTo } = req.body || {};
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean).map(s=>s.trim());
  if (!recipients.length) return res.status(400).json({ message:'At least one recipient required.' });
  const invalid = recipients.filter(e=>!isValid(e));
  if (invalid.length) return res.status(400).json({ message:`Invalid email(s): ${invalid.join(', ')}` });
  if (!subject?.trim()) return res.status(400).json({ message:'Subject is required.' });
  if (!body?.trim() && !html?.trim()) return res.status(400).json({ message:'Email body is required.' });
  try {
    const cmd = new SendEmailCommand({
      Source: `${SES_FROM_NAME} <${SES_FROM}>`,
      Destination: { ToAddresses: recipients },
      Message: {
        Subject: { Data: subject.trim(), Charset:'UTF-8' },
        Body: {
          ...(html?.trim() && { Html: { Data: html.trim(), Charset:'UTF-8' } }),
          Text: { Data: body?.trim() || html?.replace(/<[^>]+>/g,'') || '', Charset:'UTF-8' },
        },
      },
      ...(replyTo && isValid(replyTo) && { ReplyToAddresses:[replyTo] }),
    });
    const r = await ses.send(cmd);
    console.log(`[SES] Sent to ${recipients.join(',')} MessageId:${r.MessageId}`);
    res.json({ message:'Email sent successfully.', messageId:r.MessageId });
  } catch(e) {
    console.error('[SES] Send failed:', e.name, e.message);
    const msg = e.name==='MessageRejected' ? `SES rejected: ${e.message}`
      : e.name==='MailFromDomainNotVerifiedException' ? `Sender not verified: ${SES_FROM}`
      : e.name==='AccountSendingPausedException' ? 'SES account sending paused'
      : `Email failed: ${e.message}`;
    res.status(500).json({ message: msg, code: e.name });
  }
});

app.post('/api/send-email/test', rateLimiter, async (req, res) => {
  const { to } = req.body || {};
  if (!to || !isValid(to)) return res.status(400).json({ message:'Valid "to" email required.' });
  try {
    const cmd = new SendEmailCommand({
      Source: `${SES_FROM_NAME} <${SES_FROM}>`,
      Destination: { ToAddresses:[to] },
      Message: {
        Subject: { Data:'DIC-NHAI CRM — SES Email Test', Charset:'UTF-8' },
        Body: {
          Html: { Data:`<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
            <div style="background:#0a1628;color:#f0c060;padding:16px 24px;border-radius:10px 10px 0 0">
              <strong style="font-size:18px">DIC — NHAI CRM</strong>
            </div>
            <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:28px">
              <h2 style="color:#0a1628">✅ AWS SES Working!</h2>
              <p style="color:#4b5563;line-height:1.6">This test confirms AWS SES is configured correctly for <strong>Digital India Corporation — NHAI CRM</strong>.</p>
              <div style="background:#f8faff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0;font-size:13px">
                <div><strong>From:</strong> ${SES_FROM}</div>
                <div><strong>Region:</strong> ${SES_REGION}</div>
                <div><strong>Time:</strong> ${new Date().toISOString()}</div>
              </div>
              <p style="color:#98a0ad;font-size:12px;margin-top:16px">Digital India Corporation · National Highways Authority of India</p>
            </div>
          </div>`, Charset:'UTF-8' },
          Text: { Data:`DIC-NHAI CRM — SES Test\nFrom: ${SES_FROM}\nRegion: ${SES_REGION}\nTime: ${new Date().toISOString()}`, Charset:'UTF-8' },
        },
      },
    });
    const r = await ses.send(cmd);
    res.json({ message:`Test email sent to ${to}`, messageId:r.MessageId });
  } catch(e) {
    console.error('[SES] Test failed:', e.name, e.message);
    res.status(500).json({ message:`Test failed: ${e.message}`, code:e.name });
  }
});

app.get('/api/health', async (req, res) => {
  let sesStatus='unknown';
  try { await ses.send(new GetAccountSendingEnabledCommand({})); sesStatus='ok'; }
  catch(e) { sesStatus=e.message; }
  res.json({ status:'ok', ses:{ status:sesStatus, region:SES_REGION, from:SES_FROM } });
});

app.get('/health', (req,res) => res.json({ status:'ok', transport:'ses' }));

const PORT = process.env.SMTP_SERVER_PORT || 3001;
app.listen(PORT, () => console.log(`[SES Server] Listening on port ${PORT}`));
