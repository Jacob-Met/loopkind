import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { verifyPlan } from './verify.mjs';

  const VERSION = 'loopkind-cycles-and-time/0.1.0', SLOT = 15;
  class InputError extends Error { constructor(message) { super(message); this.name = 'InputError'; } }
  const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
  function label(value, field, max = 120, empty = false) {
    if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\u0000-\u001f]/.test(value)) throw new InputError(field + ' must be clear text of at most ' + max + ' characters.');
    return value.trim();
  }
  function identifier(value, field, max = 32) {
    if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value)) throw new InputError(field + ' must use letters, numbers, hyphens or underscores.');
    return value;
  }
  function validateProject(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1) throw new InputError('Open a LOOPKIND version 1 project.');
    const title = label(raw.title ?? 'A circle of help', 'Title');
    if (typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) throw new InputError('Choose a date in YYYY-MM-DD format.');
    const parsedDate = new Date(raw.date + 'T00:00:00Z');
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== raw.date) throw new InputError('Choose a valid calendar date.');
    const offset = typeof raw.utcOffset === 'string' && /^([+-])(\d{2}):(\d{2})$/.exec(raw.utcOffset);
    if (!offset || +offset[2] > 14 || ![0, 15, 30, 45].includes(+offset[3]) || (+offset[2] === 14 && +offset[3] !== 0)) throw new InputError('Choose a fixed UTC offset, such as -07:00 or +00:00.');
    if (!Array.isArray(raw.skills) || raw.skills.length < 1 || raw.skills.length > 24) throw new InputError('Use 1–24 explicit skill categories.');
    const skillIds = new Set();
    const skills = raw.skills.map(s => {
      if (!s || typeof s !== 'object') throw new InputError('Every skill needs an ID and label.');
      const id = identifier(s.id, 'Skill ID', 64);
      if (skillIds.has(id)) throw new InputError('Skill IDs must be unique.');
      skillIds.add(id); return { id, label: label(s.label, 'Skill label') };
    });
    if (!Array.isArray(raw.members) || raw.members.length > 12) throw new InputError('This workbench supports up to 12 people.');
    const ids = new Set();
    const members = raw.members.map(m => {
      if (!m || typeof m !== 'object' || Array.isArray(m)) throw new InputError('Every person needs an offer record.');
      const id = identifier(m.id, 'Person ID');
      if (ids.has(id)) throw new InputError('Person IDs must be unique.');
      ids.add(id);
      for (const key of ['active', 'confirmed']) if (typeof m[key] !== 'boolean') throw new InputError('Explicitly choose ' + key + ' for ' + id + '.');
      for (const key of ['afterReceive', 'materialsReady']) if (m[key] !== null && typeof m[key] !== 'boolean') throw new InputError('Choose or clarify ' + key + ' for ' + id + '.');
      for (const key of ['offer', 'need']) if (m[key] !== null && !skillIds.has(m[key])) throw new InputError('Choose a known skill for ' + id + ' ' + key + '.');
      const duration = m.durationMinutes;
      if (duration !== null && (!Number.isInteger(duration) || duration < 15 || duration > 180 || duration % SLOT)) throw new InputError('Outgoing sessions must last 15–180 minutes, in exact 15-minute increments.');
      if (!Array.isArray(m.windows) || m.windows.length > 16) throw new InputError('Use at most 16 availability windows per person.');
      const sorted = m.windows.map(w => {
        if (!w || !Number.isInteger(w.start) || !Number.isInteger(w.end) || w.start < 0 || w.end > 1440 || w.end <= w.start || w.start % SLOT || w.end % SLOT) throw new InputError('Availability must use increasing 15-minute boundaries within the selected day.');
        return { start: w.start, end: w.end };
      }).sort((a, b) => a.start - b.start || a.end - b.end);
      const windows = [];
      for (const w of sorted) {
        const previous = windows.at(-1);
        if (previous && w.start <= previous.end) previous.end = Math.max(previous.end, w.end);
        else windows.push({ ...w });
      }
      if (m.confirmed && (m.offer === null || m.need === null || duration === null || m.afterReceive === null || m.materialsReady === null || !windows.length)) throw new InputError('Complete ' + id + "'s offer and requirements before marking them reviewed.");
      const notes = m.notes === undefined ? '' : m.notes;
      if (typeof notes !== 'string' || notes.length > 3000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(notes)) throw new InputError('Offer notes must be at most 3,000 characters.');
      return { id, name: label(m.name, 'Name', 80), active: m.active, offer: m.offer, need: m.need,
        durationMinutes: duration, windows, afterReceive: m.afterReceive, materialsReady: m.materialsReady, confirmed: m.confirmed, notes };
    });
    return { version: 1, title, date: raw.date, utcOffset: raw.utcOffset, skills, members };
  }
  function projectRevision(project) { return digest(validateProject(project)); }
  function enumerateCycles(members) {
    const ids = members.map(m => m.id).sort(), byId = new Map(members.map(m => [m.id, m]));
    const edges = new Map(ids.map(id => [id, ids.filter(other => other !== id && byId.get(id).offer === byId.get(other).need)]));
    const cycles = [];
    for (const first of ids) {
      function visit(path) {
        for (const next of edges.get(path.at(-1))) {
          if (next === first && path.length >= 2) cycles.push([...path]);
          else if (path.length < 4 && next > first && !path.includes(next)) visit(path.concat(next));
        }
      }
      visit([first]);
    }
    return cycles;
  }
  function scheduleCycle(cycle, byId, budget) {
    const tasks = cycle.map((id, i) => {
      const provider = byId.get(id), recipient = byId.get(cycle[(i + 1) % cycle.length]);
      const starts = new Set(); let largestSharedWindow = 0;
      for (const a of provider.windows) for (const b of recipient.windows) {
        const start = Math.max(a.start, b.start), end = Math.min(a.end, b.end);
        largestSharedWindow = Math.max(largestSharedWindow, end - start);
        for (let t = start; t + provider.durationMinutes <= end; t += SLOT) starts.add(t);
      }
      return { id: provider.id + '->' + recipient.id, providerId: provider.id, recipientId: recipient.id,
        skill: provider.offer, duration: provider.durationMinutes, starts: [...starts].sort((a, b) => a - b), largestSharedWindow };
    });
    const predecessors = tasks.map(() => []);
    tasks.forEach((task, index) => { if (byId.get(task.providerId).afterReceive) predecessors[index].push((index + tasks.length - 1) % tasks.length); });
    const degree = predecessors.map(x => x.length), ready = degree.flatMap((n, i) => n === 0 ? [i] : []);
    let seen = 0;
    while (ready.length) {
      const current = ready.shift(); seen++;
      predecessors.forEach((parents, i) => { if (parents.includes(current) && --degree[i] === 0) ready.push(i); });
    }
    if (seen !== tasks.length) return { reason: 'circular_prerequisites', detail: { waitingMembers: cycle.filter(id => byId.get(id).afterReceive) } };
    const impossible = tasks.find(t => !t.starts.length);
    if (impossible) return { reason: 'availability', detail: { taskId: impossible.id, providerId: impossible.providerId, recipientId: impossible.recipientId, requiredMinutes: impossible.duration, largestSharedWindow: impossible.largestSharedWindow } };
    const assigned = new Map();
    function compatible(index, start) {
      const task = tasks[index], end = start + task.duration;
      for (const [otherIndex, otherStart] of assigned) {
        const other = tasks[otherIndex], otherEnd = otherStart + other.duration;
        const shared = [task.providerId, task.recipientId].some(id => id === other.providerId || id === other.recipientId);
        if (shared && Math.max(start, otherStart) < Math.min(end, otherEnd)) return false;
        if (predecessors[index].includes(otherIndex) && otherEnd > start) return false;
        if (predecessors[otherIndex].includes(index) && end > otherStart) return false;
      }
      return true;
    }
    function search() {
      if (assigned.size === tasks.length) return true;
      let chosen = -1, options = null;
      for (let i = 0; i < tasks.length; i++) if (!assigned.has(i)) {
        const starts = tasks[i].starts.filter(start => compatible(i, start));
        if (!starts.length) return false;
        if (options === null || starts.length < options.length) { chosen = i; options = starts; }
      }
      for (const start of options) {
        if (budget.explored >= budget.maxStates) { budget.exhausted = true; return false; }
        budget.explored++; assigned.set(chosen, start);
        if (search()) return true;
        assigned.delete(chosen);
        if (budget.exhausted) return false;
      }
      return false;
    }
    if (!search()) return { reason: budget.exhausted ? 'search_limit' : 'no_schedule', detail: { members: cycle } };
    const scheduled = tasks.map((task, index) => ({ id: task.id, providerId: task.providerId, recipientId: task.recipientId, skill: task.skill, start: assigned.get(index), end: assigned.get(index) + task.duration }))
      .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id, 'en'));
    return { tasks: scheduled };
  }
  function findPlans(input, { maxStates = 250000 } = {}) {
    const started = performance.now(), project = validateProject(input);
    if (!Number.isInteger(maxStates) || maxStates < 1 || maxStates > 2000000) throw new InputError('Use a positive bounded search budget.');
    const inputRevision = digest(project), byId = new Map(project.members.map(m => [m.id, m]));
    const blockedMembers = [], eligible = [];
    for (const member of project.members) {
      const reasons = [];
      if (!member.active) reasons.push('inactive');
      if (!member.confirmed) reasons.push('unreviewed');
      if (member.materialsReady !== true) reasons.push('materials_not_ready');
      if (!member.offer || !member.need || !member.durationMinutes || !member.windows.length || typeof member.afterReceive !== 'boolean') reasons.push('incomplete');
      if (reasons.length) blockedMembers.push({ id: member.id, reasons }); else eligible.push(member);
    }
    const cycles = enumerateCycles(eligible), plans = [], rejectedCycles = [], feasibleBySize = { 2: 0, 3: 0, 4: 0 };
    const budget = { maxStates, explored: 0, exhausted: false }; let checkedCycles = 0, rejectedCount = 0;
    for (const cycle of cycles) {
      const result = scheduleCycle(cycle, byId, budget); checkedCycles++;
      if (result.tasks) {
        const tasks = result.tasks, id = 'plan-' + digest({ inputRevision, tasks }).slice(0, 20);
        const plan = { id, inputRevision, members: [...cycle], tasks, approvalRequired: [...cycle],
          metrics: { people: cycle.length, startsAt: Math.min(...tasks.map(t => t.start)), finishesAt: Math.max(...tasks.map(t => t.end)), sessionMinutes: tasks.reduce((sum, task) => sum + task.end - task.start, 0) } };
        plan.validation = verifyPlan(project, plan);
        if (!plan.validation.ok) throw new Error('Internal plan verification failed: ' + plan.validation.errors.join('; '));
        plans.push(plan); feasibleBySize[cycle.length]++;
      } else {
        rejectedCount++;
        if (rejectedCycles.length < 24) rejectedCycles.push({ members: [...cycle], reason: result.reason, detail: result.detail });
      }
      if (budget.exhausted) break;
    }
    plans.sort((a, b) => b.members.length - a.members.length || a.metrics.finishesAt - b.metrics.finishesAt || a.metrics.startsAt - b.metrics.startsAt || a.id.localeCompare(b.id, 'en'));
    return { project, inputRevision, algorithmVersion: VERSION, plans: plans.slice(0, 12), rejectedCycles, blockedMembers,
      search: { maxStates, explored: budget.explored, exhausted: budget.exhausted, complete: !budget.exhausted,
        cycleLengths: [2, 3, 4], slotMinutes: SLOT, enumeratedCycles: cycles.length, checkedCycles, feasibleCycles: plans.length,
        feasibleBySize, rejectedCount, returnedPlans: Math.min(12, plans.length), resultLimit: 12, optimalityProven: false },
      execution: { elapsedMs: Math.round((performance.now() - started) * 100) / 100 } };
  }

export {InputError,validateProject,projectRevision,findPlans,VERSION};
