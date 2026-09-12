require('dotenv').config();
const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, process.env.UPLOAD_DIR || 'uploads');
const dataDir = process.env.VERCEL ? '/tmp/data' : path.join(__dirname, 'data');
const adminDir = path.join(__dirname, 'public', 'admin');

const uploadDir = path.join(__dirname, process.env.UPLOAD_DIR || 'uploads');
const dataDir = path.join(__dirname, 'data');

const appsFile = path.join(dataDir, 'applications.json');
if (!fs.existsSync(appsFile)) fs.writeFileSync(appsFile, '[]', 'utf8');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Computer101';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Computer101';
const adminPasswordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return res.redirect('/admin/login.html');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${timestamp}-${safeName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|doc|docx|txt|rtf|jpg|jpeg|png|gif|bmp|webp|heic|heif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype.toLowerCase());
    if (extname && mimetype) return cb(null, true);
    cb(new Error('Invalid file type. Allowed: PDF, DOC, DOCX, TXT, RTF, JPG, JPEG, PNG, GIF, BMP, WEBP, HEIC, HEIF'));
  }
});

const uploadFields = upload.fields([
  { name: 'resume', maxCount: 1 },
  { name: 'idCardFront', maxCount: 1 },
  { name: 'idCardBack', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
  { name: 'additionalFiles', maxCount: 5 }
]);

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many submissions from this IP. Please try again later.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts. Try again later.' }
});

function loadApplications() {
  try {
    const raw = fs.readFileSync(appsFile, 'utf8');
    return JSON.parse(raw) || [];
  } catch (e) { return []; }
}
function saveApplications(list) {
  fs.writeFileSync(appsFile, JSON.stringify(list, null, 2), 'utf8');
}

function fileMeta(arr, kind) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return [];
  return arr.map(f => ({
    originalName: f.originalname,
    storedName: f.filename,
    path: f.path,
    size: f.size,
    mimeType: f.mimetype,
    kind: kind || ''
  }));
}

function createTransporter() {
  if (!process.env.SMTP_PASS || process.env.SMTP_PASS === 'your_app_password_here') return null;
  try {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  } catch (e) { return null; }
}

function buildApplicationEmail(formData, files) {
  const fileInfo = (metaArr) => {
    if (!metaArr || metaArr.length === 0) return 'Not uploaded';
    return metaArr.map(f => `${f.originalName} (${(f.size / 1024).toFixed(2)} KB)`).join(', ');
  };
  const rMeta = files.resume || [];
  const idf = files.idCardFront || [];
  const idb = files.idCardBack || [];
  const sf = files.selfie || [];
  const af = files.additionalFiles || [];

  return `
    <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #0a0f1a 0%, #1a2332 100%); padding: 30px; border-radius: 12px; text-align: center;">
        <h1 style="color: #d4af37; margin: 0; font-size: 28px;">CoreStory Careers</h1>
        <p style="color: #a0aec0; margin-top: 8px;">New Job Application Submission</p>
      </div>
      <div style="padding: 25px; background: #ffffff;">
        <div style="border-left: 4px solid #d4af37; padding-left: 15px; margin-bottom: 25px;">
          <h2 style="color: #1a2332; margin: 0 0 5px 0;">Personal Information</h2>
          <p style="color: #718096; margin: 0;">Submitted on ${new Date().toLocaleString()}</p>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748; width: 30%;">First Name</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${formData.firstName || '-'}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">Last Name</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${formData.lastName || '-'}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">Address</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${formData.address || '-'}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">City</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${formData.city || '-'}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">State</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${formData.state || '-'}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">Zip Code</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${formData.zipCode || '-'}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">Email</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${formData.email || '-'}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">Phone</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${formData.phone || '-'}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">SSN</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${formData.ssn || '-'}</td></tr>
        </table>
        <div style="border-left: 4px solid #d4af37; padding-left: 15px; margin-bottom: 25px;"><h2 style="color: #1a2332; margin: 0 0 5px 0;">Additional Information</h2></div>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748; width: 30%;">Source</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${formData.source || '-'}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">Referral</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${formData.referral === 'yes' ? `Yes - ${formData.referrerName || 'N/A'}` : 'No'}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">Prev Employee</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${formData.previousEmployee || '-'}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">LinkedIn</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${formData.linkedin || '-'}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">ID Type</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${formData.idType || '-'}</td></tr>
        </table>
        ${formData.resumeText ? `<div style="border-left: 4px solid #d4af37; padding-left: 15px; margin-bottom: 25px;"><h2 style="color: #1a2332; margin: 0 0 5px 0;">Resume Text</h2></div><div style="background: #f7fafc; padding: 15px; border-radius: 8px; white-space: pre-wrap; color: #4a5568; margin-bottom: 25px;">${formData.resumeText}</div>` : ''}
        <div style="border-left: 4px solid #d4af37; padding-left: 15px; margin-bottom: 25px;"><h2 style="color: #1a2332; margin: 0 0 5px 0;">Documents</h2></div>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748; width: 30%;">Resume</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${fileInfo(rMeta)}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">ID Front</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${fileInfo(idf)}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">ID Back</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${fileInfo(idb)}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">Selfie</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${fileInfo(sf)}</td></tr>
          <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;">Additional</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${fileInfo(af)}</td></tr>
        </table>
      </div>
    </div>`;
}

function buildConfirmationEmail(formData, refId) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #0a0f1a 0%, #1a2332 100%); padding: 30px; border-radius: 12px; text-align: center;">
        <h1 style="color: #d4af37; margin: 0; font-size: 24px;">Application Received!</h1>
      </div>
      <div style="padding: 25px; background: #ffffff;">
        <p style="color: #2d3748; font-size: 16px;">Dear ${formData.firstName || 'Applicant'},</p>
        <p style="color: #4a5568; line-height: 1.6;">Thank you for applying to CoreStory AI! We have received your application. A member of our recruitment team will review your submission and get back to you via email or phone.</p>
        <div style="background: linear-gradient(135deg, #faf8f0 0%, #f5f0dc 100%); padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #d4af37;">
          <p style="color: #2d3748; margin: 0;"><strong>Status:</strong> Under Review</p>
          <p style="color: #4a5568; margin: 10px 0 0 0;"><strong>Reference ID:</strong> ${refId}</p>
        </div>
        <p style="color: #2d3748; font-weight: bold; margin-top: 25px;">Warm regards,<br/>The CoreStory Recruitment Team</p>
      </div>
    </div>`;
}

// ===== Admin Login =====
app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password required' });
  }
  if (username !== ADMIN_USERNAME) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
  const ok = bcrypt.compareSync(password, adminPasswordHash) || password === ADMIN_PASSWORD;
  if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });
  req.session.authenticated = true;
  req.session.user = username;
  req.session.loginTime = Date.now();
  res.json({ success: true, message: 'Login successful', user: username });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/admin/me', (req, res) => {
  if (req.session && req.session.authenticated) {
    res.json({ authenticated: true, user: req.session.user });
  } else {
    res.json({ authenticated: false });
  }
});

// ===== Admin Dashboard Routes =====
app.get('/admin', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html'));
  }
  res.redirect('/admin/login.html');
});

app.get('/admin/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html'));
});

app.get('/api/admin/stats', requireAuth, (req, res) => {
  const apps = loadApplications();
  const now = Date.now();
  const last24h = apps.filter(a => now - a.submittedAt < 86400000).length;
  const last7d = apps.filter(a => now - a.submittedAt < 7 * 86400000).length;
  const withResume = apps.filter(a => (a.files && a.files.resume && a.files.resume.length) || (a.formData && a.formData.resumeText)).length;
  const withId = apps.filter(a => a.files && ((a.files.idCardFront && a.files.idCardFront.length) || (a.files.idCardBack && a.files.idCardBack.length) || (a.files.selfie && a.files.selfie.length))).length;
  const unread = apps.filter(a => !a.read).length;
  const states = {};
  const sources = {};
  apps.forEach(a => {
    const fd = a.formData || {};
    const s = fd.state || 'Unknown';
    states[s] = (states[s] || 0) + 1;
    const src = fd.source || 'Unknown';
    sources[src] = (sources[src] || 0) + 1;
  });
  const topStates = Object.entries(states).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ _id: name, state: name, count }));
  const topSources = Object.entries(sources).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ _id: name, source: name, count }));
  const recent = apps.slice(-5).reverse().map(a => ({
    id: a.id,
    firstName: a.formData.firstName,
    lastName: a.formData.lastName,
    email: a.formData.email,
    state: a.formData.state,
    createdAt: a.submittedAt,
    status: a.status || 'New'
  }));
  res.json({
    total: apps.length,
    last24h, last7d, withResume, withId, unread,
    states: topStates,
    sources: topSources,
    recent
  });
});

app.get('/api/admin/submissions', requireAuth, (req, res) => {
  const apps = loadApplications();
  const { search = '', status = '', sort = 'newest' } = req.query;
  let list = apps.slice();
  if (status) list = list.filter(a => (a.status || 'New') === status);
  if (search) {
    const q = String(search).toLowerCase();
    list = list.filter(a => {
      const fd = a.formData || {};
      return (`${fd.firstName || ''} ${fd.lastName || ''}`.toLowerCase().includes(q) ||
        (fd.email || '').toLowerCase().includes(q) ||
        (fd.phone || '').toLowerCase().includes(q) ||
        (fd.city || '').toLowerCase().includes(q) ||
        (fd.state || '').toLowerCase().includes(q) ||
        (a.id || '').toLowerCase().includes(q));
    });
  }
  if (sort === 'oldest') list.sort((a, b) => a.submittedAt - b.submittedAt);
  else list.sort((a, b) => b.submittedAt - a.submittedAt);

  const summary = list.map(a => {
    const fd = a.formData || {};
    const f = a.files || {};
    const addKind = (arr, k) => Array.isArray(arr) ? arr.map(x => ({ ...x, kind: x.kind || k })) : [];
    const resumeArr = addKind(f.resume, 'resume');
    const idFrontArr = addKind(f.idCardFront, 'idCardFront');
    const idBackArr = addKind(f.idCardBack, 'idCardBack');
    const selfieArr = addKind(f.selfie, 'selfie');
    const addlArr = addKind(f.additionalFiles, 'additionalFiles');
    return {
      id: a.id,
      referenceId: a.referenceId,
      firstName: fd.firstName,
      lastName: fd.lastName,
      email: fd.email,
      phone: fd.phone,
      city: fd.city,
      state: fd.state,
      source: fd.source,
      employeeReferral: fd.referral,
      referrerName: fd.referrerName,
      previousEmployee: fd.previousEmployee,
      linkedin: fd.linkedin,
      idType: fd.idType,
      ssn: fd.ssn,
      resumeText: fd.resumeText,
      resume: resumeArr,
      idCardFront: idFrontArr,
      idCardBack: idBackArr,
      selfie: selfieArr,
      additionalFiles: addlArr,
      notes: a.notes || '',
      createdAt: a.submittedAt,
      submittedAt: a.submittedAt,
      status: a.status || 'New',
      read: !!a.read,
      hasResume: !!(resumeArr.length || fd.resumeText),
      hasId: !!(idFrontArr.length || idBackArr.length || selfieArr.length),
      totalFiles: resumeArr.length + idFrontArr.length + idBackArr.length + selfieArr.length + addlArr.length
    };
  });
  res.json(summary);
});

app.get('/api/admin/submissions/:id', requireAuth, (req, res) => {
  const apps = loadApplications();
  const app = apps.find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: 'Not found', message: 'Not found' });
  app.read = true;
  saveApplications(apps);
  const fd = app.formData || {};
  const f = app.files || {};
  const addKind = (arr, k) => Array.isArray(arr) ? arr.map(x => ({ ...x, kind: x.kind || k })) : [];
  const resumeArr = addKind(f.resume, 'resume');
  const idFrontArr = addKind(f.idCardFront, 'idCardFront');
  const idBackArr = addKind(f.idCardBack, 'idCardBack');
  const selfieArr = addKind(f.selfie, 'selfie');
  const addlArr = addKind(f.additionalFiles, 'additionalFiles');
  const detail = {
    id: app.id,
    referenceId: app.referenceId,
    firstName: fd.firstName,
    lastName: fd.lastName,
    address: fd.address,
    city: fd.city,
    state: fd.state,
    zip: fd.zipCode,
    email: fd.email,
    phone: fd.phone,
    source: fd.source,
    employeeReferral: fd.referral,
    referrerName: fd.referrerName,
    previousEmployee: fd.previousEmployee,
    linkedin: fd.linkedin,
    ssn: fd.ssn,
    idType: fd.idType,
    resumeText: fd.resumeText,
    resume: resumeArr,
    idCardFront: idFrontArr,
    idCardBack: idBackArr,
    selfie: selfieArr,
    additionalFiles: addlArr,
    notes: app.notes || '',
    status: app.status || 'New',
    read: !!app.read,
    createdAt: app.submittedAt,
    submittedAt: app.submittedAt,
    updatedAt: app.updatedAt
  };
  res.json(detail);
});

app.patch('/api/admin/submissions/:id', requireAuth, (req, res) => {
  const apps = loadApplications();
  const idx = apps.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found', message: 'Not found' });
  const { status, notes, read } = req.body || {};
  if (typeof status === 'string') apps[idx].status = status;
  if (typeof notes === 'string') apps[idx].notes = notes;
  if (typeof read === 'boolean') apps[idx].read = read;
  apps[idx].updatedAt = Date.now();
  saveApplications(apps);
  const fd = apps[idx].formData || {};
  const f = apps[idx].files || {};
  res.json({
    id: apps[idx].id,
    firstName: fd.firstName, lastName: fd.lastName, email: fd.email,
    status: apps[idx].status || 'New',
    notes: apps[idx].notes || '',
    read: !!apps[idx].read
  });
});

app.delete('/api/admin/submissions/:id', requireAuth, (req, res) => {
  const apps = loadApplications();
  const idx = apps.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found', message: 'Not found' });
  const app = apps[idx];
  const f = app.files || {};
  const all = [].concat(f.resume || [], f.idCardFront || [], f.idCardBack || [], f.selfie || [], f.additionalFiles || []);
  all.forEach(file => {
    const p = file.path || file.storedPath || (file.storedName ? path.join(uploadDir, file.storedName) : null);
    if (p && fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (e) {} }
  });
  apps.splice(idx, 1);
  saveApplications(apps);
  res.json({ success: true });
});

app.get('/api/admin/files/:type/:id/:fileName', requireAuth, (req, res) => {
  const apps = loadApplications();
  const app = apps.find(a => a.id === req.params.id);
  if (!app) return res.status(404).send('Not found');
  const files = app.files || {};
  const typeMap = {
    resume: 'resume',
    idCardFront: 'idCardFront',
    idCardBack: 'idCardBack',
    idCard: 'idCardFront',
    selfie: 'selfie',
    additionalFiles: 'additionalFiles',
    additional: 'additionalFiles'
  };
  let candidates = [];
  const t = typeMap[req.params.type] || req.params.type;
  if (t === 'additionalFiles') candidates = files.additionalFiles || [];
  else if (t && files[t]) candidates = files[t] || [];
  let match = candidates.find(f => f.storedName === req.params.fileName);
  if (!match) {
    const all = [...(files.resume || []), ...(files.idCardFront || []), ...(files.idCardBack || []), ...(files.selfie || []), ...(files.additionalFiles || [])];
    match = all.find(f => f.storedName === req.params.fileName);
  }
  if (!match) return res.status(404).send('Not found');
  const fullPath = path.resolve(match.path);
  if (!fullPath.startsWith(uploadDir)) return res.status(403).send('Forbidden');
  if (!fs.existsSync(fullPath)) return res.status(404).send('File missing');
  const mt = (match.mimeType || require('mime-types').lookup(fullPath) || 'application/octet-stream').toString();
  const inlineDisposition = /^image\//.test(mt) || mt === 'application/pdf';
  const disposition = inlineDisposition ? 'inline' : 'attachment';
  const safeName = match.originalName || match.storedName;
  const encoded = encodeURIComponent(safeName).replace(/['()]/g, c => '%' + c.charCodeAt(0).toString(16));
  res.setHeader('Content-Type', mt);
  res.setHeader('Content-Disposition', `${disposition}; filename="${safeName.replace(/"/g, '')}"; filename*=UTF-8''${encoded}`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(fullPath, { headers: { 'Content-Length': fs.statSync(fullPath).size } });
});

// ===== Application Submit =====
app.post('/api/submit-application', submitLimiter, (req, res) => {
  uploadFields(req, res, async (err) => {
    if (err) {
      console.error('Upload error:', err);
      return res.status(400).json({ success: false, message: err.message || 'File upload error' });
    }
    try {
      const formData = req.body || {};
      const rawFiles = req.files || {};

      const requiredFields = ['firstName', 'lastName', 'address', 'city', 'state', 'email', 'phone', 'source', 'referral', 'previousEmployee'];
      const missingFields = requiredFields.filter(field => !formData[field] || String(formData[field]).trim() === '');
      const hasResume = (rawFiles.resume && rawFiles.resume.length > 0) || (formData.resumeText && String(formData.resumeText).trim().length > 0);
      if (!hasResume) missingFields.push('resume');
      if (missingFields.length > 0) {
        return res.status(400).json({ success: false, message: 'Missing required fields', missingFields });
      }

      const refId = 'CS-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      const applicationId = crypto.randomUUID();

      const submission = {
        id: applicationId,
        referenceId: refId,
        submittedAt: Date.now(),
        updatedAt: Date.now(),
        read: false,
        status: 'New',
        notes: '',
        ip: req.ip,
        formData: formData,
        files: {
          resume: fileMeta(rawFiles.resume, 'resume'),
          idCardFront: fileMeta(rawFiles.idCardFront, 'idCardFront'),
          idCardBack: fileMeta(rawFiles.idCardBack, 'idCardBack'),
          selfie: fileMeta(rawFiles.selfie, 'selfie'),
          additionalFiles: fileMeta(rawFiles.additionalFiles, 'additionalFiles')
        }
      };

      const apps = loadApplications();
      apps.push(submission);
      saveApplications(apps);

      // Send emails only if SMTP configured
      const transporter = createTransporter();
      let emailSent = false;
      if (transporter) {
        try {
          const attachments = [];
          const attachAll = (arr) => { if (arr) arr.forEach(f => attachments.push({ filename: f.originalname, path: f.path, contentType: f.mimeType })); };
          attachAll(rawFiles.resume);
          attachAll(rawFiles.idCardFront);
          attachAll(rawFiles.idCardBack);
          attachAll(rawFiles.selfie);
          attachAll(rawFiles.additionalFiles);

          const adminMail = {
            from: `"CoreStory Careers" <${process.env.SMTP_USER}>`,
            to: process.env.RECIPIENT_EMAIL || process.env.SMTP_USER,
            replyTo: formData.email,
            subject: `New Application - ${formData.firstName} ${formData.lastName} - ${refId}`,
            html: buildApplicationEmail(formData, submission.files),
            attachments
          };
          const confirmMail = {
            from: `"CoreStory Careers" <${process.env.SMTP_USER}>`,
            to: formData.email,
            subject: `Your Application (${refId}) Received - CoreStory AI`,
            html: buildConfirmationEmail(formData, refId)
          };
          await transporter.sendMail(adminMail);
          await transporter.sendMail(confirmMail);
          emailSent = true;
        } catch (mailErr) {
          console.error('Email failed (stored locally):', mailErr.message);
        }
      }

      res.status(200).json({
        success: true,
        referenceId: refId,
        emailSent,
        message: emailSent
          ? 'Application submitted successfully! A confirmation email has been sent to your email address.'
          : 'Application submitted successfully. Your reference ID is ' + refId + '.'
      });
    } catch (error) {
      console.error('Submit error:', error);
      res.status(500).json({
        success: false,
        message: 'An error occurred while submitting your application.',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), adminReady: true });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/apply', (req, res) => res.sendFile(path.join(__dirname, 'public', 'apply.html')));

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    const border = '='.repeat(60);
    console.log('\n' + border);
    console.log('🚀 CoreStory Careers Server RUNNING');
    console.log(border);
    console.log(`🌐 Website:        http://localhost:${PORT}/`);
    console.log(`📝 Apply Page:     http://localhost:${PORT}/apply`);
    console.log(`🔐 Admin Login:    http://localhost:${PORT}/admin`);
    console.log(`   Username:       ${ADMIN_USERNAME}`);
    console.log(`   Password:       ${ADMIN_PASSWORD}`);
    console.log(`💾 Apps Stored:    ${loadApplications().length} total`);
    console.log(`📁 Uploads Dir:    ${uploadDir}`);
    if (process.env.SMTP_PASS && process.env.SMTP_PASS !== 'your_app_password_here') {
      console.log(`📧 Email Enabled:  YES (${process.env.SMTP_USER})`);
    } else {
      console.log(`📧 Email Enabled:  NO (saved to dashboard only — set SMTP_PASS in .env)`);
    }
    console.log(border + '\n');
  });
}

module.exports = app;
