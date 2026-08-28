// ── Additional project files ────────────────────────────────────────────────
// Files uploaded from the job screen live in a private Drive folder owned by
// the Apps Script account. Only lightweight metadata is stored with the job's
// tracking row; file bytes are fetched on demand so the normal calendar payload
// stays small. The Drive file id is never accepted directly from a client — it
// must first match metadata attached to a job the signed-in user can access.
function getAdditionalFilesFolder() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('ADDITIONAL_FILES_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (err) { /* recreate below */ }
  }
  const folder = DriveApp.createFolder('SWS Prod Calendar - Additional Files');
  props.setProperty('ADDITIONAL_FILES_FOLDER_ID', folder.getId());
  return folder;
}

function normalizeAdditionalFileName(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .slice(0, 160);
}

function addAdditionalFile(actor, data) {
  if (!canUploadAdditionalFiles(actor && actor.department)) return { success: false, error: 'forbidden' };
  const jobKey = String(data.jobKey || '');
  if (!validJobKey(jobKey)) return { success: false, error: 'Invalid job key' };
  if (!canAccessJobKey(actor, jobKey)) return { success: false, error: 'forbidden' };

  const name = normalizeAdditionalFileName(data.name);
  if (!name) return { success: false, error: 'File name is required' };
  const mimeType = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(String(data.mimeType || ''))
    ? String(data.mimeType)
    : 'application/octet-stream';
  const encoded = String(data.base64 || '');
  if (!encoded || encoded.length > Math.ceil(MAX_ADDITIONAL_FILE_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return { success: false, error: 'Invalid or oversized file' };
  }

  let bytes;
  try { bytes = Utilities.base64Decode(encoded); } catch (err) { return { success: false, error: 'Invalid file data' }; }
  if (!bytes.length || bytes.length > MAX_ADDITIONAL_FILE_BYTES) {
    return { success: false, error: 'Files must be 8 MB or smaller' };
  }

  const addedAt = new Date().toISOString();
  const id = Utilities.getUuid();
  let driveFile;
  try {
    const blob = Utilities.newBlob(bytes, mimeType, name);
    driveFile = getAdditionalFilesFolder().createFile(blob);
  } catch (err) {
    console.error('Additional file upload failed for job %s: %s', jobKey, err && err.message);
    return { success: false, error: 'File upload failed — try again' };
  }

  const metadata = {
    id,
    fileId: driveFile.getId(),
    name,
    mimeType,
    size: bytes.length,
    addedBy: actor.name,
    addedById: actor.id || '',
    addedAt,
  };
  const result = setTracking(jobKey, current => {
    const files = current.additionalFiles || [];
    if (files.length >= MAX_ADDITIONAL_FILES_PER_JOB) return { error: 'This project already has the maximum of 50 additional files' };
    return { additionalFiles: files.concat(metadata) };
  }, actor.name);

  if (!result.success) {
    try { driveFile.setTrashed(true); } catch (err) { /* cleanup is best-effort */ }
    return result;
  }
  return { ...result, additionalFiles: additionalFilesForClient(result.additionalFiles) };
}

function getAdditionalFile(actor, data) {
  const jobKey = String(data.jobKey || '');
  const fileId = String(data.fileId || '');
  if (!validJobKey(jobKey) || !fileId || fileId.length > 100) return { error: 'bad_request', message: 'Invalid file request' };
  if (!canAccessJobKey(actor, jobKey)) return { error: 'forbidden' };
  const tracking = getAllTracking()[jobKey] || {};
  const metadata = (tracking.additionalFiles || []).find(file => file.id === fileId);
  if (!metadata) return { error: 'not_found', message: 'File not found' };

  try {
    const blob = DriveApp.getFileById(metadata.fileId).getBlob();
    return {
      available: true,
      name: metadata.name,
      mimeType: metadata.mimeType || blob.getContentType() || 'application/octet-stream',
      base64: Utilities.base64Encode(blob.getBytes()),
    };
  } catch (err) {
    console.error('Additional file download failed for job %s: %s', jobKey, err && err.message);
    return { error: 'not_found', message: 'File is no longer available' };
  }
}

function deleteAdditionalFile(actor, data) {
  if (!actor || actor.department !== 'Admin') return { success: false, error: 'forbidden' };
  const jobKey = String(data.jobKey || '');
  const fileId = String(data.fileId || '');
  if (!validJobKey(jobKey)) return { success: false, error: 'Invalid job key' };
  if (!fileId || fileId.length > 100) return { success: false, error: 'Invalid file id' };
  if (!canAccessJobKey(actor, jobKey)) return { success: false, error: 'forbidden' };

  let removed = null;
  const result = setTracking(jobKey, current => {
    const files = current.additionalFiles || [];
    removed = files.find(file => file.id === fileId) || null;
    if (!removed) return { error: 'File not found' };
    return { additionalFiles: files.filter(file => file.id !== fileId) };
  }, actor.name);

  if (result.success && removed && removed.fileId) {
    try { DriveApp.getFileById(removed.fileId).setTrashed(true); } catch (err) {
      console.warn('Could not trash deleted additional file %s: %s', removed.fileId, err && err.message);
    }
  }
  if (!result.success) return result;
  return { ...result, additionalFiles: additionalFilesForClient(result.additionalFiles) };
}
