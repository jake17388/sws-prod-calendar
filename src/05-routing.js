// ── Routing ──────────────────────────────────────────────────────────────────
// Anything thrown below this point — a malformed request body, a LockService
// timeout under load (a normal condition, not a bug), a Calendar hiccup —
// otherwise escapes as Apps Script's own HTML error page. The client then calls
// r.json() on HTML and rejects with an opaque SyntaxError that says nothing
// about what actually failed. These wrappers guarantee every response is JSON
// the client can reason about, and log the stack for Stackdriver.
function doGet(e) {
  try {
    return routeGet(e);
  } catch (err) {
    console.error('doGet failed: %s\n%s', err && err.message, err && err.stack);
    return json({ error: 'internal', message: 'Unexpected server error' });
  }
}

function doPost(e) {
  try {
    return routePost(e);
  } catch (err) {
    console.error('doPost failed: %s\n%s', err && err.message, err && err.stack);
    return json({ error: 'internal', message: 'Unexpected server error' });
  }
}

function routeGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action;

  if (action === 'getProductionJobs') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    ensureOperationalTriggersOnce();
    if ((params.from && !validDateOverride(params.from)) || (params.to && !validDateOverride(params.to))) {
      return json({ error: 'bad_request', message: 'Invalid date range' });
    }
    return json(getProductionJobs(e, actor));
  }
  if (action === 'getUsers') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    if (!canAccessUserManagement(actor.department)) return json({ error: 'forbidden' });
    return json({ users: visibleUsersFor(actor) });
  }
  if (action === 'getCommonTasks') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    if (!canAssignDepartments(actor.department)) return json({ error: 'forbidden' });
    return json({ tasks: getCommonTasks() });
  }
  if (action === 'getCostingButtons') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    if (!canUseJobSelector(actor.department) && !canManageCostingButtons(actor.department)) return json({ error: 'forbidden' });
    return json({ buttons: getCostingButtons() });
  }
  if (action === 'getTrackingVersion') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    return json({ version: productionJobsVersion_(actor) });
  }
  if (action === 'getJobTimeStatus') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    if (!canUseJobSelector(actor.department)) return json({ error: 'forbidden' });
    return json(getJobTimeStatus(actor));
  }
  if (action === 'getJobTimeLog') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    if (!canViewJobTimeLog(actor)) return json({ error: 'forbidden' });
    return json(getJobTimeLog(actor, params));
  }
  if (action === 'exportJobTimeLog') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    if (!canViewJobTimeLog(actor)) return json({ error: 'forbidden' });
    return json(exportJobTimeLog(actor, params));
  }
  if (action === 'lookupSquarecoilJob') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    if (!canUseJobSelector(actor.department)) return json({ error: 'forbidden' });
    return json(lookupSquarecoilJob_(params.jobNum));
  }
  if (action === 'getArchivedJobs') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    return json(searchArchivedJobs(actor, params.q || ''));
  }
  if (action === 'getProofFile') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    const jobNum = String(e.parameter.jobNum || '');
    if (!validJobKey(jobNum)) return json({ error: 'bad_request', message: 'Invalid job number' });
    if (!canAccessJobKey(actor, jobNum)) return json({ error: 'forbidden' });
    return json(getSquarecoilProductionFile(jobNum));
  }
  if (action === 'getAdditionalFile') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    return json(getAdditionalFile(actor, params));
  }
  if (action === 'getProductionStatuses') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    if (!canManageProductionStatuses(actor.department)) return json({ error: 'forbidden' });
    return json(productionStatusSettings_());
  }
  if (action === 'getSquarecoilStatus') {
    const actor = resolveActor(e.parameter.token);
    if (!actor || actor.department !== 'Admin') return json(UNAUTHORIZED);
    return json({ connected: isSquarecoilConfigured_() });
  }
  if (action === 'getSystemHealth') {
    const actor = resolveActor(e.parameter.token);
    if (!actor || actor.department !== 'Admin') return json(UNAUTHORIZED);
    return json(getSystemHealth());
  }
  // The app itself is hosted on GitHub Pages, not here
  return ContentService.createTextOutput(
    'SWS Production Calendar: https://jake17388.github.io/sws-prod-calendar/');
}

function canAccessJobKey(actor, jobKey) {
  if (!actor || !validJobKey(jobKey)) return false;
  if (JOB_DEPARTMENTS.indexOf(actor.department) === -1) return true;
  const tracking = getAllTracking()[String(jobKey)];
  return !!tracking && (tracking.departments || []).indexOf(actor.department) !== -1;
}

function routePost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return json({ error: 'bad_request', message: 'Missing request body' });
  }
  if (e.postData.contents.length > MAX_UPLOAD_REQUEST_CHARS) {
    return json({ error: 'bad_request', message: 'Request body is too large' });
  }
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ error: 'bad_request', message: 'Request body is not valid JSON' });
  }
  if (!data || typeof data !== 'object') {
    return json({ error: 'bad_request', message: 'Request body must be a JSON object' });
  }
  if (data.action !== 'addAdditionalFile' && e.postData.contents.length > MAX_STANDARD_REQUEST_CHARS) {
    return json({ error: 'bad_request', message: 'Request body is too large' });
  }

  if (data.action === 'login') {
    return json(checkPin(data.pin, data.deviceId));
  }

  const actor = resolveActor(data.token);
  if (!actor) return json(UNAUTHORIZED);
  if (actor.mustChangePin && data.action !== 'updateSelf') {
    return json({ error: 'pin_change_required', message: 'Change your temporary PIN before continuing' });
  }
  const user = actor.name;
  const respond = operation => json(runMutationOnce(actor, data, operation));

  if (data.action === 'toggleComplete') {
    return respond(() => {
      if (!canMarkJobComplete(actor.department)) return { error: 'forbidden' };
      const archiveSnapshot = normalizeArchiveSnapshot(data.jobKey, data.archiveSnapshot);
      const result = setTracking(data.jobKey, {
        completed: !!data.completed,
        ...(archiveSnapshot ? { archiveSnapshot } : {}),
      }, user);
      if (result.success && data.completed) {
        try { evictSquarecoilFileCache(data.jobKey); } catch (err) { /* best-effort */ }
      }
      return result;
    });
  }
  if (data.action === 'updateDueDate') {
    return respond(() => {
      const job = { isOtherProduction: actor.department === 'Manager' && isOtherProductionJob_(data.jobKey) };
      if (!canEditDueDateForJob(actor.department, job)) return { error: 'forbidden' };
      const dueDate = String(data.dueDate || '');
      if (!validDateOverride(dueDate)) return { success: false, error: 'Invalid due date' };
      return setTracking(data.jobKey, { dueOverride: dueDate }, user);
    });
  }
  if (data.action === 'updateJobDepartments') return respond(() => updateJobDepartments(actor, data));
  if (data.action === 'toggleDepartmentTaskDone') return respond(() => toggleDepartmentTaskDone(actor, data));
  if (data.action === 'startJobTime') return respond(() => startJobTime(actor, data));
  if (data.action === 'stopJobTime') return respond(() => stopJobTime(actor));
  if (data.action === 'updateJobTimeEntry') return respond(() => updateJobTimeEntry(actor, data));
  if (data.action === 'deleteJobTimeEntry') return respond(() => deleteJobTimeEntry(actor, data));
  if (data.action === 'addNote') return respond(() => addNote(actor, data));
  if (data.action === 'updateNote') return respond(() => updateNote(actor, data));
  if (data.action === 'deleteNote') return respond(() => deleteNote(actor, data));
  if (data.action === 'addUser') return respond(() => addUser(actor, data));
  if (data.action === 'updateUser') return respond(() => updateUser(actor, data));
  if (data.action === 'deleteUser') return respond(() => deleteUser(actor, data));
  if (data.action === 'updateSelf') return respond(() => updateSelf(actor, data));
  if (data.action === 'revokeUserSessions') return respond(() => revokeUserSessions(actor, data));
  if (data.action === 'saveCommonTasks') return respond(() => saveCommonTasks(actor, data));
  if (data.action === 'saveCostingButtons') return respond(() => saveCostingButtons(actor, data));
  if (data.action === 'saveProductionStatuses') return respond(() => saveProductionStatuses(actor, data));
  if (data.action === 'addAdditionalFile') return respond(() => addAdditionalFile(actor, data));
  if (data.action === 'deleteAdditionalFile') return respond(() => deleteAdditionalFile(actor, data));
  if (data.action === 'refreshSquarecoilFilesNow') {
    return respond(() => {
      if (actor.department !== 'Admin') return { error: 'forbidden' };
      if (!isSquarecoilConfigured_()) return { success: false, error: 'Squarecoil credentials are not configured' };
      try { refreshSquarecoilProductionFiles(); } catch (err) { return { success: false, error: err.message }; }
      return { success: true };
    });
  }
  return json({ error: 'unknown action' });
}

// Stamps who/when completed a checklist item, based on whether `done` just
// transitioned from the previously-stored version — a text edit or an
// unrelated resync of an already-done item shouldn't overwrite who actually
// completed it. Un-checking clears the stamp, mirroring how the job-level
// completedAt/completedBy reset on un-complete.
function stampChecklistItem(nextItem, prevItem, actorName, actorId, eventAt) {
  const timestamp = eventAt || new Date().toISOString();
  const addedBy = prevItem ? (prevItem.addedBy || '') : actorName;
  const addedById = prevItem ? (prevItem.addedById || '') : (actorId || '');
  const addedAt = prevItem ? (prevItem.addedAt || '') : timestamp;
  const stamped = { ...nextItem, addedBy, addedById, addedAt };
  if (!nextItem.done) return { ...stamped, doneBy: '', doneById: '', doneAt: '' };
  if (prevItem && prevItem.done) return { ...stamped, doneBy: prevItem.doneBy || actorName, doneById: prevItem.doneById || actorId || '', doneAt: prevItem.doneAt || timestamp };
  return { ...stamped, doneBy: actorName, doneById: actorId || '', doneAt: timestamp };
}

// When Paint moves from having open work to all tasks complete, Assembly
// automatically receives the job. An open Assembly task is reused; otherwise
// a Prep for Install task is created with the same attribution and exact
// timestamp as the painter's final completion.
function advancePaintToAssembly(state, previousPaintItems, actor, eventAt) {
  const paintItems = (state.departmentChecklists && state.departmentChecklists.Paint) || [];
  const previous = Array.isArray(previousPaintItems) ? previousPaintItems : [];
  const paintWasOpen = previous.some(item => !item.done);
  const paintIsComplete = paintItems.length > 0 && paintItems.every(item => item.done);
  if (!paintWasOpen || !paintIsComplete) return state;

  const previousById = new Map(previous.map(item => [item.id, item]));
  const finalPaintItem = paintItems.find(item => item.done && !(previousById.get(item.id) || {}).done) || paintItems[paintItems.length - 1];
  const handoffAt = finalPaintItem.doneAt || eventAt || new Date().toISOString();
  const handoffBy = finalPaintItem.doneBy || actor.name;
  const handoffById = finalPaintItem.doneById || actor.id || '';
  const assemblyItems = [...((state.departmentChecklists && state.departmentChecklists.Assembly) || [])];

  if (!assemblyItems.some(item => !item.done)) {
    assemblyItems.push({
      id: Utilities.getUuid(),
      text: 'Prep for Install',
      done: false,
      doneBy: '',
      doneById: '',
      doneAt: '',
      addedBy: handoffBy,
      addedById: handoffById,
      addedAt: handoffAt,
    });
  }

  const departments = state.departments.indexOf('Assembly') === -1
    ? [...state.departments, 'Assembly']
    : [...state.departments];
  const currentDepartments = state.currentDepartments
    .filter(department => department !== 'Paint' && department !== 'Assembly');
  currentDepartments.push('Assembly');

  return {
    ...state,
    departments,
    currentDepartments,
    departmentChecklists: { ...state.departmentChecklists, Assembly: assemblyItems },
  };
}

// Only Admins and Managers can assign departments to a job. Any
// department not in JOB_TAGS is silently dropped rather than erroring, so a
// stale/typo'd tag from the client can't corrupt stored state. Checklist
// items are scoped per department — only departments actually being kept
// get their checklist carried over.
// `departments` is the full set of departments a job ever needs (drives the
// checklist sections). `currentDepartments` is a subset of that — whichever
// department(s) actually have the job right now; it's what a
// production-department account's calendar filters on and what the job-card
// badge shows, since a department not yet "current" doesn't need to see the
// job at all. Multiple departments can be current at once (parallel work),
// and there's deliberately no enforced order — Managers move it around
// however the actual workflow requires.
// Locked once the whole job is marked complete — reopen it (uncheck "Mark
// job complete") to edit departments again.
function updateJobDepartments(actor, data) {
  if (!canAssignDepartments(actor.department)) return { success: false, error: 'forbidden' };
  if (!validJobKey(data.jobKey)) return { success: false, error: 'Invalid job key' };
  if (!Array.isArray(data.departments) || data.departments.length > JOB_TAGS.length) return { success: false, error: 'Invalid departments' };
  if (data.departments.some(dept => JOB_TAGS.indexOf(String(dept)) === -1)) return { success: false, error: 'Invalid department' };

  const existing = getAllTracking()[String(data.jobKey)] || { completed: false, departmentChecklists: {} };
  if (existing.completed) return { success: false, error: 'Job is complete — reopen it to edit departments' };

  const departments = [...new Set(data.departments.map(String))];
  const rawCurrentDepartments = Array.isArray(data.currentDepartments)
    ? data.currentDepartments.filter(d => departments.indexOf(d) !== -1)
    : [];

  // Admins and Managers may reopen a completed task. A Manager still cannot
  // delete it while it remains completed: they must explicitly reopen it
  // first, making that history-changing action visible and intentional.
  // Mirrored client-side in renderEditableChecklist, but enforced here as
  // the actual source of truth.
  const isAdmin = actor.department === 'Admin';

  const transitionAt = new Date().toISOString();
  const departmentChecklists = {};
  const rawChecklists = (data.departmentChecklists && typeof data.departmentChecklists === 'object') ? data.departmentChecklists : {};
  for (let d = 0; d < departments.length; d++) {
    const supplied = Array.isArray(rawChecklists[departments[d]]) ? rawChecklists[departments[d]] : [];
    if (supplied.length > 100) return { success: false, error: 'Up to 100 tasks are allowed per department' };
    if (supplied.some(item => !validText(item && item.text, 300) || String((item && item.id) || '').length > 100)) {
      return { success: false, error: 'Each task must be 1–300 characters' };
    }
  }
  departments.forEach(dept => {
    const items = Array.isArray(rawChecklists[dept]) ? rawChecklists[dept] : [];
    const oldItems = existing.departmentChecklists[dept] || [];
    const incomingById = new Map();
    let nextItems = items
      .map(i => {
        const id = String((i && i.id) || Utilities.getUuid());
        const text = String((i && i.text) || '').trim();
        const done = !!(i && i.done);
        const oldItem = oldItems.find(o => o.id === id);
        const built = stampChecklistItem({ id, text, done }, oldItem, actor.name, actor.id, transitionAt);
        incomingById.set(id, built);
        return built;
      })
      .filter(i => i.text);

    if (!isAdmin) {
      oldItems.forEach(oldItem => {
        if (!oldItem.done) return;
        const incoming = incomingById.get(oldItem.id);
        if (!incoming) {
          // Deleted while still completed by a Manager — put it back exactly
          // as it was. Reopening it is allowed and clears its completion stamp.
          nextItems = nextItems.filter(i => i.id !== oldItem.id);
          nextItems.push(oldItem);
        }
      });
    }

    departmentChecklists[dept] = nextItems;
  });

  // A department can only be "currently" holding the job while it has an
  // open (not-done) task — Ship-In is the one exception, since it has no
  // checklist-driven workflow of its own (see renderDepartmentEditor's
  // self-heal comment). This both rejects a client trying to mark a
  // department current with no open tasks, and auto-drops a department the
  // moment its last open task on this very save gets checked off. Paint is
  // then handed directly to Assembly by advancePaintToAssembly below.
  const currentDepartments = rawCurrentDepartments.filter(dept =>
    dept === 'Ship-In' || (departmentChecklists[dept] || []).some(i => !i.done));

  const nextState = advancePaintToAssembly(
    { departments, departmentChecklists, currentDepartments },
    existing.departmentChecklists.Paint || [],
    actor,
    transitionAt,
  );
  return setTracking(data.jobKey, nextState, actor.name, data.expectedUpdatedAt);
}
