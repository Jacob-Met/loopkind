import { createHash } from 'node:crypto';
const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function verifyPlan(project, plan) {
  const errors = [];
  const fail = message => { if (errors.length < 64) errors.push(message); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(project) || !object(plan) || !Array.isArray(project.members) || !Array.isArray(project.skills)) return { ok: false, errors: ['Expected a canonical project and a plan'] };
  let expectedRevision;
  try { expectedRevision = sha256(project); } catch { return { ok: false, errors: ['Project is not serializable'] }; }
  if (plan.inputRevision !== expectedRevision) fail('Plan inputRevision does not match the current project');
  const source = new Map();
  for (const member of project.members) {
    if (!object(member) || typeof member.id !== 'string' || source.has(member.id)) { fail('Project has invalid or duplicate member IDs'); continue; }
    source.set(member.id, member);
  }
  const skills = new Set(project.skills.map(skill => skill?.id));
  if (!Array.isArray(plan.members) || plan.members.length < 2 || plan.members.length > 4 || !Array.isArray(plan.tasks) || plan.tasks.length !== plan.members.length) return { ok: false, errors: [...errors, 'A plan must contain one task per member in a two-to-four-person cycle'] };
  const memberIds = new Set(plan.members);
  if (memberIds.size !== plan.members.length || plan.members.some(id => typeof id !== 'string')) fail('Plan membership contains duplicate or invalid IDs');
  for (const id of memberIds) {
    const member = source.get(id);
    if (!member) { fail(`Unknown member ${id}`); continue; }
    if (member.active !== true || member.confirmed !== true || member.materialsReady !== true) fail(`Member ${id} is not active, reviewed, and ready`);
    if (!skills.has(member.offer) || !skills.has(member.need) || typeof member.afterReceive !== 'boolean' || !Number.isInteger(member.durationMinutes) || member.durationMinutes < 15 || member.durationMinutes > 180 || member.durationMinutes % 15 !== 0) fail(`Member ${id} has incomplete or invalid service requirements`);
  }
  const approvals = Array.isArray(plan.approvalRequired) ? plan.approvalRequired : [];
  if (approvals.length !== memberIds.size || new Set(approvals).size !== approvals.length || approvals.some(id => !memberIds.has(id))) fail('Approval is required from every cycle member, exactly once');
  const outgoing = new Map(), incoming = new Map(), taskIds = new Set();
  for (const task of plan.tasks) {
    if (!object(task)) { fail('Invalid task record'); continue; }
    const provider = source.get(task.providerId), recipient = source.get(task.recipientId);
    if (!memberIds.has(task.providerId) || !memberIds.has(task.recipientId) || task.providerId === task.recipientId) fail('Every task must join two distinct members of this cycle');
    const expectedId = `${task.providerId}->${task.recipientId}`;
    if (task.id !== expectedId || taskIds.has(task.id)) fail(`Invalid or duplicate task ID ${task.id}`);
    taskIds.add(task.id);
    if (outgoing.has(task.providerId)) fail(`Member ${task.providerId} gives more than once`);
    if (incoming.has(task.recipientId)) fail(`Member ${task.recipientId} receives more than once`);
    outgoing.set(task.providerId, task); incoming.set(task.recipientId, task);
    const validTime = Number.isInteger(task.start) && Number.isInteger(task.end) && task.start >= 0 && task.end <= 1440 && task.end > task.start && task.start % 15 === 0 && task.end % 15 === 0;
    if (!validTime) fail(`Task ${task.id} has invalid quarter-hour bounds`);
    if (!provider || !recipient) { fail(`Task ${task.id} has an unknown participant`); continue; }
    if (task.skill !== provider.offer || task.skill !== recipient.need || !skills.has(task.skill)) fail(`Task ${task.id} does not match the declared offer and need`);
    if (task.end - task.start !== provider.durationMinutes) fail(`Task ${task.id} duration differs from its provider's commitment`);
    for (const member of [provider, recipient]) {
      if (!Array.isArray(member.windows) || !member.windows.some(window => object(window) && Number.isInteger(window.start) && Number.isInteger(window.end) && window.start <= task.start && task.end <= window.end)) fail(`Task ${task.id} is not wholly within ${member.id}'s availability`);
    }
  }
  for (const id of memberIds) {
    if (!outgoing.has(id) || !incoming.has(id)) fail(`Member ${id} must give and receive exactly once`);
    const member = source.get(id), before = incoming.get(id), after = outgoing.get(id);
    if (member?.afterReceive === true && before && after && before.end > after.start) fail(`Member ${id} must finish receiving help before giving help`);
  }
  for (let first = 0; first < plan.tasks.length; first++) {
    const a = plan.tasks[first]; if (!object(a)) continue;
    for (let second = first + 1; second < plan.tasks.length; second++) {
      const b = plan.tasks[second]; if (!object(b)) continue;
      const sharesPerson = [a.providerId, a.recipientId].some(id => id === b.providerId || id === b.recipientId);
      if (sharesPerson && Math.max(a.start, b.start) < Math.min(a.end, b.end)) fail(`Tasks ${a.id} and ${b.id} overlap for a shared participant`);
    }
  }
  const visited = new Set(); let current = plan.members[0];
  for (let step = 0; step < memberIds.size; step++) {
    if (visited.has(current) || !memberIds.has(current)) { fail('Tasks do not form one connected cycle'); break; }
    if (current !== plan.members[step]) fail('Declared member order does not match the actual help cycle');
    visited.add(current); current = outgoing.get(current)?.recipientId;
  }
  if (visited.size !== memberIds.size || current !== plan.members[0]) fail('Tasks do not close one connected cycle through every member');
  try {
    const expectedPlanId = `plan-${sha256({ inputRevision: plan.inputRevision, tasks: plan.tasks }).slice(0, 20)}`;
    if (plan.id !== expectedPlanId) fail('Plan ID does not bind its exact input revision and tasks');
  } catch { fail('Plan tasks are not serializable'); }
  return { ok: errors.length === 0, errors };
}
