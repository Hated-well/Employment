require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const multer = require('multer');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// =====================================================
// DATABASE (MongoDB Atlas) - applications + uploaded files
// =====================================================
let clientPromise = null;

function getDb() {
  if (!process.env.MONGODB_URI) {
    return Promise.reject(new Error('MONGODB_URI is not set in the environment variables'));
  }
  if (!clientPromise) {
    clientPromise = new MongoClient(process.env.MONGODB_URI).connect().catch(err => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise.then(client => client.db(process.env.MONGODB_DB || 'corestory'));
}

async function loadApplications() {
  const db = await getDb();
  return db.collection('applications').find({}, { projection: { _id: 0 } }).sort({ submittedAt: 1 }).toArray();
}

async function findApplication(id) {
  const db = await getDb();
  return db.collection('applications').findOne({ id }, { projection: { _id: 0 } });
}

async function insertApplication(doc) {
  const db = await getDb();
  await db.collection('applications').insertOne(doc);
}

async function updateApplication(id, patch) {
  const db = await getDb();
  await db.collection('applications').updateOne({ id }, { $set: patch });
}

async function deleteApplication(id) {
  const db = await getDb();
  await db.collection('applications').deleteOne({ id });
}

async function saveFileBlobs(appId, files) {
  if (!files.length) return;
  const db = await getDb();
  await db.collection('files').insertMany(files.map(f => ({
    appId,
    storedName: f.filename,
    originalName: f.originalname,
    mimeType: f.mimetype,
    size: f.size,
    data: f.buffer.toString('base64')
  })));
}

async function getFileBlob(appId, storedName) {
  const db = await getDb();
  return db.collection('files').findOne({ appId, storedName });
}

async function deleteFileBlobs(appId) {
  const db = await getDb();
  await db.collection('files').deleteMany({ appId });
}

// Lets async routes pass errors to the error handler at the bottom
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// =====================================================
// MIDDLEWARE
// =====================================================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
app.use(cookieSession({
  name: 'session',
  keys: [sessionSecret],
  maxAge: 24 * 60 * 60 * 1000,
  httpOnly: true,
  secure: !!process.env.VERCEL || process.env.NODE_ENV === 'production',
  sameSite: 'lax'
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

// Files are kept in memory while the request runs, then saved to MongoDB
const upload = multer({
  storage: multer.memoryStorage(),
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

// =====================================================
// HELPERS
// =====================================================
const FORM_FIELDS = [
  'firstName', 'lastName', 'address', 'city', 'state', 'zipCode', 'email', 'phone', 'ssn',
  'source', 'referral', 'referrerName', 'previousEmployee', 'linkedin', 'idType', 'resumeText'
];

function pickFormData(body) {
  const out = {};
  FORM_FIELDS.forEach(k => {
    if (body && body[k] !== undefined && body[k] !== null) out[k] = String(body[k]);
  });
  return out;
}

function fileMeta(arr, kind) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  return arr.map(f => ({
    originalName: f.originalname,
    storedName: f.filename,
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

const row = (label, value, first) =>
  `<tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #2d3748;${first ? ' width: 30%;' : ''}">${label}</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">${value}</td></tr>`;

const sectionTitle = (title) =>
  `<div style="border-left: 4px solid #d4af37; padding-left: 15px; margin-bottom: 25px;"><h2 style="color: #1a2332; margin: 0 0 5px 0;">${title}</h2></div>`;

function buildApplicationEmail(formData, files) {
  const fileInfo = (metaArr) => {
    if (!metaArr || metaArr.length === 0) return 'Not uploaded';
    return metaArr.map(f => `${f.originalName} (${(f.size / 1024).toFixed(2)} KB)`).join(', ');
  };

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
          ${row('First Name', formData.firstName || '-', true)}
          ${row('Last Name', formData.lastName || '-')}
          ${row('Address', formData.address || '-')}
          ${row('City', formData.city || '-')}
          ${row('State', formData.state || '-')}
          ${row('Zip Code', formData.zipCode || '-')}
          ${row('Email', formData.email || '-')}
          ${row('Phone', formData.phone || '-')}
          ${row('SSN', formData.ssn || '-')}
        </table>
        ${sectionTitle('Additional Information')}
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
          ${row('Source', formData.source || '-', true)}
          ${row('Referral', formData.referral === 'yes' ? `Yes - ${formData.referrerName || 'N/A'}` : 'No')}
          ${row('Prev Employee', formData.previousEmployee || '-')}
          ${row('LinkedIn', formData.linkedin || '-')}
          ${row('ID Type', formData.idType || '-')}
        </table>
        ${formData.resumeText ? `${sectionTitle('Resume Text')}<div style="background: #f7fafc; padding: 15px; border-radius: 8px; white-space: pre-wrap; color: #4a5568; margin-bottom: 25px;">${formData.resumeText}</div>` : ''}
        ${sectionTitle('Documents')}
        <table style="width: 100%; border-collapse: collapse;">
          ${row('Resume', fileInfo(files.resume), true)}
          ${row('ID Front', fileInfo(files.idCardFront))}
          ${row('ID Back', fileInfo(files.idCardBack))}
          ${row('Selfie', fileInfo(files.selfie))}
          ${row('Additional', fileInfo(files.additionalFiles))}
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

const addKind = (arr, k) => Array.isArray(arr) ? arr.map(x => ({ ...x, kind: x.kind || k })) : [];

// =====================================================
// ADMIN LOGIN
// =====================================================
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
  req.session = null;
  res.json({ success: true });
});

app.get('/api/admin/me', (req, res) => {
  if (req.session && req.session.authenticated) {
    res.json({ authenticated: true, user: req.session.user });
  } else {
    res.json({ authenticated: false });
  }
});

// =====================================================
// ADMIN DASHBOARD ROUTES
// =====================================================
app.get('/admin', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html'));
  }
  res.redirect('/admin/login.html');
});

app.get('/admin/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html'));
});

app.get('/api/admin/stats', requireAuth, wrap(async (req, res) => {
  const apps = await loadApplications();
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
    firstName: (a.formData || {}).firstName,
    lastName: (a.formData || {}).lastName,
    email: (a.formData || {}).email,
    state: (a.formData || {}).state,
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
}));

app.get('/api/admin/submissions', requireAuth, wrap(async (req, res) => {
  const apps = await loadApplications();
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
}));

app.get('/api/admin/submissions/:id', requireAuth, wrap(async (req, res) => {
  const found = await findApplication(req.params.id);
  if (!found) return res.status(404).json({ error: 'Not found', message: 'Not found' });
  await updateApplication(found.id, { read: true });
  found.read = true;
  const fd = found.formData || {};
  const f = found.files || {};
  const resumeArr = addKind(f.resume, 'resume');
  const idFrontArr = addKind(f.idCardFront, 'idCardFront');
  const idBackArr = addKind(f.idCardBack, 'idCardBack');
  const selfieArr = addKind(f.selfie, 'selfie');
  const addlArr = addKind(f.additionalFiles, 'additionalFiles');
  res.json({
    id: found.id,
    referenceId: found.referenceId,
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
    notes: found.notes || '',
    status: found.status || 'New',
    read: !!found.read,
    createdAt: found.submittedAt,
    submittedAt: found.submittedAt,
    updatedAt: found.updatedAt
  });
}));

app.patch('/api/admin/submissions/:id', requireAuth, wrap(async (req, res) => {
  const existing = await findApplication(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found', message: 'Not found' });
  const { status, notes, read } = req.body || {};
  const patch = { updatedAt: Date.now() };
  if (typeof status === 'string') patch.status = status;
  if (typeof notes === 'string') patch.notes = notes;
  if (typeof read === 'boolean') patch.read = read;
  await updateApplication(existing.id, patch);
  const updated = Object.assign({}, existing, patch);
  const fd = updated.formData || {};
  res.json({
    id: updated.id,
    firstName: fd.firstName, lastName: fd.lastName, email: fd.email,
    status: updated.status || 'New',
    notes: updated.notes || '',
    read: !!updated.read
  });
}));

app.delete('/api/admin/submissions/:id', requireAuth, wrap(async (req, res) => {
  const existing = await findApplication(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found', message: 'Not found' });
  await deleteFileBlobs(existing.id);
  await deleteApplication(existing.id);
  res.json({ success: true });
}));

app.get('/api/admin/files/:type/:id/:fileName', requireAuth, wrap(async (req, res) => {
  const found = await findApplication(req.params.id);
  if (!found) return res.status(404).send('Not found');
  const f = found.files || {};
  const all = [].concat(f.resume || [], f.idCardFront || [], f.idCardBack || [], f.selfie || [], f.additionalFiles || []);
  const match = all.find(x => x.storedName === req.params.fileName);
  if (!match) return res.status(404).send('Not found');
  const blob = await getFileBlob(found.id, match.storedName);
  if (!blob) return res.status(404).send('File missing');
  const buffer = Buffer.from(blob.data, 'base64');
  const mt = (match.mimeType || blob.mimeType || 'application/octet-stream').toString();
  const inlineDisposition = /^image\//.test(mt) || mt === 'application/pdf';
  const disposition = inlineDisposition ? 'inline' : 'attachment';
  const safeName = match.originalName || match.storedName;
  const encoded = encodeURIComponent(safeName).replace(/['()]/g, c => '%' + c.charCodeAt(0).toString(16));
  res.setHeader('Content-Type', mt);
  res.setHeader('Content-Disposition', `${disposition}; filename="${safeName.replace(/"/g, '')}"; filename*=UTF-8''${encoded}`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(buffer);
}));

// =====================================================
// APPLICATION SUBMIT
// =====================================================
app.post('/api/submit-application', submitLimiter, (req, res) => {
  uploadFields(req, res, async (err) => {
    if (err) {
      console.error('Upload error:', err);
      return res.status(400).json({ success: false, message: err.message || 'File upload error' });
    }
    try {
      const formData = pickFormData(req.body);
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

      // Give every uploaded file a unique stored name
      const allUploaded = [];
      Object.keys(rawFiles).forEach(kind => {
        (rawFiles[kind] || []).forEach(f => {
          const safeName = f.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
          f.filename = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${safeName}`;
          allUploaded.push(f);
        });
      });

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

      // Save the files first, then the application record
      await saveFileBlobs(applicationId, allUploaded);
      await insertApplication(submission);

      // Send emails only if SMTP configured
      const transporter = createTransporter();
      let emailSent = false;
      if (transporter) {
        try {
          const attachments = allUploaded.map(f => ({
            filename: f.originalname,
            content: f.buffer,
            contentType: f.mimetype
          }));

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
          console.error('Email failed (application is saved in the dashboard):', mailErr.message);
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
    console.log(`CoreStory Careers server running on http://localhost:${PORT}/`);
    console.log(`Admin login: http://localhost:${PORT}/admin`);
    console.log(process.env.MONGODB_URI ? 'Database: MongoDB connected via MONGODB_URI' : 'WARNING: MONGODB_URI is not set - saving applications will fail');
  });
}

module.exports = app;
