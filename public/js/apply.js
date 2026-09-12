(function () {
  'use strict';

  const menuToggle = document.getElementById('menuToggle');
  const navLinks = document.getElementById('navLinks');

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });
  }

  const uploadTabs = document.querySelectorAll('.upload-tab');
  const tabPanels = document.querySelectorAll('.tab-panel');

  uploadTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.getAttribute('data-tab');
      uploadTabs.forEach(t => t.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`${targetTab}-panel`).classList.add('active');
    });
  });

  function setupFileUpload(inputId, dropZoneId, previewId, multiple = false, maxFiles = 1) {
    const input = document.getElementById(inputId);
    const dropZone = document.getElementById(dropZoneId);
    const preview = document.getElementById(previewId);
    let files = [];

    if (!input || !dropZone || !preview) return { input, files };

    function updatePreview() {
      preview.innerHTML = '';
      files.forEach((file, idx) => {
        const item = document.createElement('div');
        item.className = 'file-preview-item';
        const sizeKB = (file.size / 1024).toFixed(1);
        const sizeLabel = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
        item.innerHTML = `
          <span>📎</span>
          <span class="file-name" title="${file.name}">${file.name}</span>
          <span class="file-size">${sizeLabel}</span>
          <button type="button" class="remove-file" data-idx="${idx}">&times;</button>
        `;
        preview.appendChild(item);
      });

      preview.querySelectorAll('.remove-file').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const idx = parseInt(btn.getAttribute('data-idx'));
          files.splice(idx, 1);
          const dt = new DataTransfer();
          files.forEach(f => dt.items.add(f));
          input.files = dt.files;
          updatePreview();
        });
      });
    }

    input.addEventListener('change', () => {
      const newFiles = Array.from(input.files);
      if (multiple) {
        files = [...files, ...newFiles].slice(0, maxFiles);
      } else {
        files = newFiles.slice(0, maxFiles);
      }
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      input.files = dt.files;
      updatePreview();
    });

    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('dragover');
      });
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (multiple) {
        files = [...files, ...droppedFiles].slice(0, maxFiles);
      } else {
        files = droppedFiles.slice(0, maxFiles);
      }
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      input.files = dt.files;
      updatePreview();
    });

    return { input, getFiles: () => files, setFiles: (f) => { files = f; updatePreview(); } };
  }

  setupFileUpload('resumeInput', 'resumeDropZone', 'resumePreview', false, 1);
  setupFileUpload('additionalInput', 'additionalDropZone', 'additionalPreview', true, 5);

  const referralRadios = document.querySelectorAll('input[name="referral"]');
  const referrerGroup = document.getElementById('referrerGroup');
  referralRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'yes' && radio.checked) {
        referrerGroup.style.display = 'block';
      } else if (radio.value === 'no' && radio.checked) {
        referrerGroup.style.display = 'none';
        document.getElementById('referrerName').value = '';
      }
    });
  });

  const phoneInput = document.getElementById('phone');
  if (phoneInput) {
    phoneInput.addEventListener('input', (e) => {
      let value = e.target.value.replace(/\D/g, '');
      if (value.length > 10) value = value.slice(0, 10);
      let formatted = '';
      if (value.length > 6) {
        formatted = `(${value.slice(0, 3)}) ${value.slice(3, 6)}-${value.slice(6)}`;
      } else if (value.length > 3) {
        formatted = `(${value.slice(0, 3)}) ${value.slice(3)}`;
      } else if (value.length > 0) {
        formatted = `(${value}`;
      }
      e.target.value = formatted;
    });
  }

  const cameraVideo = document.getElementById('cameraVideo');
  const cameraCanvas = document.getElementById('cameraCanvas');
  const cameraPlaceholder = document.getElementById('cameraPlaceholder');
  const startCameraBtn = document.getElementById('startCameraBtn');
  const captureBtn = document.getElementById('captureBtn');
  const selfiePreviewImg = document.getElementById('selfiePreviewImg');
  let cameraStream = null;
  let capturedSelfieFile = null;

  if (startCameraBtn && cameraVideo) {
    startCameraBtn.addEventListener('click', async () => {
      try {
        if (cameraStream) {
          cameraStream.getTracks().forEach(track => track.stop());
          cameraStream = null;
          cameraVideo.style.display = 'none';
          cameraPlaceholder.style.display = cameraVideo.srcObject || selfiePreviewImg.style.display === 'block' ? 'none' : 'block';
          startCameraBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            Start Camera
          `;
          captureBtn.style.display = 'none';
          captureBtn.disabled = true;
          return;
        }

        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false
        });

        cameraVideo.srcObject = cameraStream;
        cameraVideo.style.display = 'block';
        cameraPlaceholder.style.display = 'none';
        selfiePreviewImg.style.display = 'none';

        startCameraBtn.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="6" y="6" width="12" height="12"/>
          </svg>
          Stop Camera
        `;
        captureBtn.style.display = 'inline-flex';
        captureBtn.disabled = false;
      } catch (err) {
        console.error('Camera error:', err);
        showAlert('Unable to access camera. Please upload a selfie file instead.', 'error');
      }
    });
  }

  if (captureBtn && cameraCanvas && cameraVideo && selfieInput) {
    captureBtn.addEventListener('click', () => {
      const ctx = cameraCanvas.getContext('2d');
      const videoW = cameraVideo.videoWidth;
      const videoH = cameraVideo.videoHeight;
      cameraCanvas.width = videoW;
      cameraCanvas.height = videoH;
      ctx.drawImage(cameraVideo, 0, 0, videoW, videoH);

      cameraCanvas.toBlob((blob) => {
        if (!blob) return;
        capturedSelfieFile = new File([blob], `selfie-capture-${Date.now()}.png`, { type: 'image/png' });

        const dt = new DataTransfer();
        dt.items.add(capturedSelfieFile);
        selfieInput.files = dt.files;

        selfiePreviewImg.src = URL.createObjectURL(blob);
        selfiePreviewImg.style.display = 'block';
        cameraVideo.style.display = 'none';
        cameraPlaceholder.style.display = 'none';

        if (selfieFilePreview) {
          selfieFilePreview.innerHTML = '';
          const item = document.createElement('div');
          item.className = 'file-preview-item';
          item.innerHTML = `
            <span>📷</span>
            <span class="file-name">Captured Selfie.png</span>
            <span class="file-size">${(blob.size / 1024).toFixed(1)} KB</span>
          `;
          selfieFilePreview.appendChild(item);
        }

        if (cameraStream) {
          cameraStream.getTracks().forEach(track => track.stop());
          cameraStream = null;
          startCameraBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            Start Camera
          `;
          captureBtn.style.display = 'none';
          captureBtn.disabled = true;
        }
      }, 'image/png', 0.9);
    });
  }

  function showAlert(message, type = 'success') {
    const successAlert = document.getElementById('successAlert');
    const errorAlert = document.getElementById('errorAlert');
    if (successAlert) successAlert.classList.remove('show');
    if (errorAlert) errorAlert.classList.remove('show');

    const alert = type === 'success' ? successAlert : errorAlert;
    if (alert) {
      alert.textContent = message;
      alert.classList.add('show');
      alert.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function validateForm() {
    let isValid = true;
    const errors = [];

    document.querySelectorAll('.form-group.error').forEach(g => g.classList.remove('error'));

    const uploadTab = document.querySelector('.upload-tab.active')?.getAttribute('data-tab');
    const resumeFile = document.getElementById('resumeInput')?.files[0];
    const resumeText = document.getElementById('resumeText')?.value?.trim();

    if (uploadTab === 'upload' && !resumeFile) {
      errors.push('Please upload your resume or switch to Paste/Type mode.');
    } else if (uploadTab === 'paste' && !resumeText) {
      errors.push('Please paste or type your resume/work history.');
    }

    const requiredTextFields = [
      { id: 'firstName', msg: 'First name is required' },
      { id: 'lastName', msg: 'Last name is required' },
      { id: 'address', msg: 'Address is required' },
      { id: 'city', msg: 'City is required' },
      { id: 'email', msg: 'Please enter a valid email', isEmail: true },
      { id: 'phone', msg: 'Phone number is required' }
    ];

    requiredTextFields.forEach(field => {
      const el = document.getElementById(field.id);
      const group = el?.closest('.form-group');
      const val = el?.value?.trim() || '';
      let hasError = false;

      if (!val) {
        hasError = true;
      } else if (field.isEmail) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        hasError = !emailRegex.test(val);
      }

      if (hasError) {
        isValid = false;
        group?.classList.add('error');
        errors.push(field.msg);
      }
    });

    const stateSelect = document.getElementById('state');
    if (!stateSelect?.value) {
      stateSelect.closest('.form-group')?.classList.add('error');
      isValid = false;
      errors.push('Please select a state');
    }

    const sourceSelect = document.getElementById('source');
    if (!sourceSelect?.value) {
      sourceSelect.closest('.form-group')?.classList.add('error');
      isValid = false;
      errors.push('Please select how you heard about us');
    }

    const referralSelected = document.querySelector('input[name="referral"]:checked');
    if (!referralSelected) {
      const group = document.querySelector('[data-field="referral"]');
      group?.classList.add('error');
      isValid = false;
      errors.push('Please select Yes or No for employee referral');
    }

    const prevEmpSelect = document.getElementById('previousEmployee');
    if (!prevEmpSelect?.value) {
      prevEmpSelect.closest('.form-group')?.classList.add('error');
      isValid = false;
      errors.push('Please select if you have worked here before');
    }

    if (!isValid && errors.length > 0) {
      showAlert(errors[0], 'error');
    }

    return isValid;
  }

  const form = document.getElementById('applicationForm');
  const submitBtn = document.getElementById('submitBtn');

  if (form && submitBtn) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (!validateForm()) {
        return;
      }

      submitBtn.classList.add('loading');
      submitBtn.disabled = true;

      try {
        const formData = new FormData(form);

        const response = await fetch('/api/submit-application', {
          method: 'POST',
          body: formData
        });

        const result = await response.json();

        if (result.success) {
          showAlert(result.message, 'success');
          form.reset();

          document.querySelectorAll('.file-preview').forEach(p => p.innerHTML = '');

          if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
          }
          if (cameraVideo) cameraVideo.style.display = 'none';
          if (selfiePreviewImg) selfiePreviewImg.style.display = 'none';
          if (cameraPlaceholder) cameraPlaceholder.style.display = 'block';
          if (referrerGroup) referrerGroup.style.display = 'none';
          document.querySelectorAll('.id-card-type').forEach(c => c.classList.remove('selected'));

          uploadTabs.forEach(t => t.classList.remove('active'));
          tabPanels.forEach(p => p.classList.remove('active'));
          uploadTabs[0].classList.add('active');
          tabPanels[0].classList.add('active');

          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          showAlert(result.message || 'Application submission failed. Please try again.', 'error');
        }
      } catch (err) {
        console.error('Submit error:', err);
        showAlert('Network error. Please check your connection and try again.', 'error');
      } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
      }
    });
  }

  document.querySelectorAll('.form-input, .form-select, .form-textarea').forEach(el => {
    el.addEventListener('blur', () => {
      const group = el.closest('.form-group');
      if (!group) return;
      if (group.classList.contains('error')) {
        const val = el.value?.trim();
        if (val) {
          if (el.type === 'email') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (emailRegex.test(val)) group.classList.remove('error');
          } else {
            group.classList.remove('error');
          }
        }
      }
    });
  });
})();
