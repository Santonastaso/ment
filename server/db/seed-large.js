const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('./database');
const { runSchema } = require('./schema');
const bcrypt = require('bcryptjs');
const { computeAllMatches } = require('../utils/matching');
const { generateTempPassword } = require('../utils/password');

runSchema();

// Wipe existing data so the bulk seed is idempotent
db.exec(`
  DELETE FROM match_scores;
  DELETE FROM sessions;
  DELETE FROM connections;
  DELETE FROM skills;
  DELETE FROM career_history;
  UPDATE users SET manager_id = NULL;
  DELETE FROM users;
`);

// ---------- Deterministic PRNG (xorshift32) so reseeds match ----------
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}
const rand = makeRng(20260506);
const pick = arr => arr[Math.floor(rand() * arr.length)];
const pickN = (arr, n) => {
  const set = new Set();
  const cap = Math.min(n, arr.length);
  while (set.size < cap) set.add(pick(arr));
  return [...set];
};
const weightedPick = pairs => {
  // pairs: [[value, weight], ...]
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let r = rand() * total;
  for (const [val, w] of pairs) {
    if ((r -= w) <= 0) return val;
  }
  return pairs[pairs.length - 1][0];
};

// ---------- Source pools ----------
const FIRST_NAMES = [
  'Aaron','Aiden','Alex','Alice','Amelia','Amir','Andrea','Anika','Anna','Antonio',
  'Aria','Arjun','Arthur','Asha','Astrid','Aurora','Avery','Beatrice','Ben','Bianca',
  'Caleb','Camille','Carla','Carlos','Caroline','Cassandra','Cecilia','Charlie','Chloe','Christian',
  'Claire','Connor','Daniel','David','Diana','Diego','Dimitri','Dylan','Eduardo','Eleanor',
  'Elena','Eli','Elif','Elise','Elliot','Emil','Emma','Erin','Ethan','Eva',
  'Felix','Fernanda','Finn','Fiona','Francesca','Gabriel','Gemma','George','Grace','Greta',
  'Hana','Hannah','Harper','Hazel','Helena','Henry','Hiroshi','Holly','Ian','Imani',
  'Ines','Iris','Isaac','Isabel','Ivy','Jack','Jade','James','Jasmine','Javier',
  'Jay','Jelena','Jin','Joanna','Jonas','Jordan','Julia','Kai','Kalia','Karim',
  'Kate','Kenji','Kiara','Kim','Klara','Lana','Lara','Laura','Leah','Leo',
  'Leonardo','Lila','Liam','Lina','Linnea','Logan','Louis','Luca','Lucia','Luis',
  'Maeve','Malik','Marco','Maria','Martin','Mateo','Maya','Mei','Mia','Miguel',
  'Mila','Mina','Mira','Naomi','Nikolas','Nina','Noah','Nora','Oliver','Olivia',
  'Omar','Oscar','Owen','Paloma','Pavel','Penelope','Petra','Quentin','Rafael','Ravi',
  'Ren','Rhea','Rita','Roman','Ruth','Sam','Sara','Saskia','Sebastian','Selena',
  'Sergei','Simon','Sofia','Sonia','Sophie','Stella','Tara','Theo','Tomas','Una',
  'Vera','Victor','Violet','Wei','Xavier','Yasmin','Yusuf','Zoe'
];
const LAST_NAMES = [
  'Adler','Akhtar','Alvarez','Andersson','Aoki','Arnold','Bauer','Becker','Bennett','Bernard',
  'Bianchi','Blake','Boateng','Bose','Brennan','Bright','Brooks','Bryant','Cabrera','Cardenas',
  'Carlsen','Castro','Chen','Cho','Choi','Cohen','Cole','Conti','Costa','Davies',
  'Delgado','Diaz','Doyle','Drake','Dubois','Eriksen','Espinoza','Evans','Farias','Fernandez',
  'Ferraro','Fischer','Fontaine','Foster','Fournier','Friedman','Garcia','Gibson','Gomez','Greer',
  'Gupta','Hale','Hansen','Hara','Harris','Hartley','Hassan','Hayashi','Hernandez','Hoffman',
  'Holm','Howell','Iqbal','Jansen','Jensen','Jiang','Jimenez','Johansen','Jonsson','Kapoor',
  'Karlsson','Kato','Kaur','Keller','Khan','Kim','Klein','Kowalski','Krause','Kumar',
  'Lambert','Larsen','Lee','Lefevre','Levy','Liang','Lima','Lindberg','Lopez','Lund',
  'Madsen','Maeda','Marin','Martin','Martinez','Mehta','Meier','Mendez','Merten','Meyer',
  'Miller','Mitchell','Moller','Moreno','Morgan','Morris','Moss','Mueller','Nakamura','Navarro',
  'Nguyen','Nielsen','Novak','Okafor','Olsen','Ortiz','Osei','Owens','Palmer','Park',
  'Pereira','Perez','Petrov','Phillips','Pierce','Popov','Porter','Quinn','Ramirez','Ramos',
  'Reed','Reyes','Ricci','Richter','Rivera','Robinson','Rojas','Romano','Rossi','Russo',
  'Sanchez','Santos','Sato','Schmidt','Schneider','Schubert','Schultz','Serrano','Shah','Silva',
  'Singh','Smith','Sokolov','Stein','Stewart','Suarez','Suzuki','Taylor','Thomas','Thompson',
  'Torres','Tran','Vargas','Vasquez','Vega','Vincent','Wagner','Walker','Wang','Watanabe',
  'Watson','Webb','Weber','White','Wilkins','Williams','Wilson','Winters','Wright','Wu',
  'Yamada','Yang','Young','Zhang','Zhao','Zimmermann'
];

const DEPARTMENTS = [
  'Engineering', 'Finance', 'Marketing', 'Operations',
  'HR', 'Legal', 'Product', 'Design', 'Sales', 'Customer Success'
];

const ROLES_BY_DEPT = {
  'Engineering':       ['Software Engineer','Senior Software Engineer','Staff Engineer','Frontend Engineer','Backend Engineer','Data Engineer','DevOps Engineer','Engineering Manager','Principal Engineer','SRE'],
  'Finance':           ['Financial Analyst','Senior Financial Analyst','Accountant','Controller','FP&A Lead','Treasury Analyst','Audit Manager','Head of Finance','Tax Manager','Compliance Officer'],
  'Marketing':         ['Marketing Coordinator','Content Strategist','SEO Lead','Brand Manager','Performance Marketer','Marketing Manager','Demand Gen Lead','VP of Marketing','Copywriter','Lifecycle Marketer'],
  'Operations':        ['Operations Analyst','Supply Chain Manager','Operations Lead','Procurement Manager','VP of Operations','Logistics Coordinator','Process Manager','BizOps Lead','Vendor Manager','Workplace Manager'],
  'HR':                ['HR Generalist','Recruiter','People Operations Lead','Compensation Analyst','HR Business Partner','Head of People','L&D Manager','Talent Sourcer','DEI Lead','HRIS Analyst'],
  'Legal':             ['Legal Counsel','Senior Counsel','Paralegal','Compliance Lead','Privacy Officer','Contracts Manager','Litigation Manager','General Counsel','IP Counsel','Regulatory Lead'],
  'Product':           ['Product Manager','Senior Product Manager','Product Lead','Product Marketing Manager','Group PM','Director of Product','Product Analyst','VP of Product','Associate PM','Product Ops Lead'],
  'Design':            ['Product Designer','Senior Product Designer','Design Lead','UX Researcher','Visual Designer','Design Systems Lead','Interaction Designer','Head of Design','Brand Designer','Service Designer'],
  'Sales':             ['Account Executive','Sales Development Rep','Senior AE','Sales Manager','Regional Sales Lead','VP of Sales','Enterprise AE','Solutions Engineer','Sales Operations Lead','BDR'],
  'Customer Success':  ['CS Associate','CS Manager','Senior CSM','Implementation Manager','Customer Support Lead','Director of CS','Onboarding Specialist','Renewals Manager','VP of CS','CS Ops Analyst']
};

const SKILLS_BY_DEPT = {
  'Engineering':       ['React','TypeScript','Python','system design','microservices','data pipelines','SQL','Kubernetes','Docker','CI/CD','code review','frontend architecture','backend architecture','DevOps','cloud infrastructure','API design','technical roadmapping','engineering leadership','observability','testing strategy'],
  'Finance':           ['financial modeling','Excel','SQL','budgeting','forecasting','financial analysis','accounting','compliance','risk management','treasury','tax strategy','audit prep','financial reporting','data analysis','Python','controls'],
  'Marketing':         ['SEO','content strategy','copywriting','analytics','brand storytelling','growth marketing','social media','demand generation','email marketing','PPC','event marketing','partnerships','positioning','customer research'],
  'Operations':        ['process optimization','project management','vendor management','supply chain','procurement','operations analytics','change management','program management','vendor negotiations','logistics','workplace ops','BizOps'],
  'HR':                ['recruiting','interviewing','people management','coaching','compensation','employee relations','onboarding design','culture building','DEI','L&D','HRIS','performance management','organizational design'],
  'Legal':             ['contract drafting','negotiation','compliance','privacy','regulatory strategy','IP strategy','litigation management','legal research','risk advisory','employment law','M&A','data protection'],
  'Product':           ['product strategy','user research','roadmapping','prioritization','PRD writing','stakeholder management','GTM strategy','data-driven product','PM coaching','feature scoping','metrics design','product analytics','experimentation'],
  'Design':            ['UX research','interaction design','visual design','design systems','prototyping','usability testing','information architecture','design leadership','accessibility','service design','brand design','wireframing'],
  'Sales':             ['discovery calls','pipeline management','negotiation','demo skills','enterprise sales','SaaS sales','closing','sales operations','account planning','prospecting','solution selling','forecasting'],
  'Customer Success':  ['onboarding','customer health','renewal strategy','expansion','customer advocacy','escalation management','support operations','playbook design','training delivery','QBRs','churn analysis']
};

const CROSS_DEPT_SKILLS = ['leadership','mentoring','communication','public speaking','time management','negotiation','data analysis','strategic thinking','presentation skills','stakeholder management','technical writing'];

const SENIORITY_DIST = [
  ['junior', 30],
  ['mid',    40],
  ['senior', 22],
  ['lead',    8],
];

// Locations grouped by region — distribution roughly mirrors a realistic global org
const LOCATION_DIST = [
  // North America (~25%)
  ['New York', 7], ['San Francisco', 6], ['Toronto', 4], ['Mexico City', 3], ['Austin', 3], ['Chicago', 2],
  // EMEA (~35%)
  ['London', 9], ['Berlin', 5], ['Paris', 4], ['Madrid', 3], ['Amsterdam', 3], ['Stockholm', 3], ['Dublin', 2],
  ['Milan', 2], ['Zurich', 2], ['Tel Aviv', 2],
  // APAC (~20%)
  ['Tokyo', 4], ['Singapore', 4], ['Sydney', 3], ['Mumbai', 3], ['Bangalore', 3], ['Seoul', 2], ['Hong Kong', 2],
  // Latin America / MEA (~10%)
  ['São Paulo', 3], ['Buenos Aires', 2], ['Dubai', 3], ['Johannesburg', 2],
  // Remote (~10%)
  ['Remote', 10],
];

// ---------- Generate users ----------
const TARGET_USERS = 300;
const demoPassword = generateTempPassword();
const passwordHash = bcrypt.hashSync(demoPassword, 10);

const insertUser = db.prepare(`
  INSERT INTO users (email, password_hash, name, department, seniority, current_role, tenure_years, location, bio, shadow_role_response, onboarding_complete, is_admin, must_change_password)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
`);
const insertCareer = db.prepare(`
  INSERT INTO career_history (user_id, role, department, company, description, start_year, end_year)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertSkill = db.prepare(`
  INSERT INTO skills (user_id, skill, type, example_project) VALUES (?, ?, ?, ?)
`);
const insertSession = db.prepare(`
  INSERT INTO sessions (mentor_id, mentee_id, title, scheduled_at, status, pre_session_question, reflection, topics, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
`);

// Compute explicit topics for a session by intersecting mentor's can_teach with
// mentee's wants_to_learn — used so seeded past meetings have realistic topic
// chips instead of relying on the runtime fallback.
const skillsByUserCache = {};
function topicsForPair(mentorId, menteeId) {
  const mt = (skillsByUserCache[mentorId + ':teach'] ||=
    db.prepare("SELECT skill FROM skills WHERE user_id = ? AND type = 'can_teach'").all(mentorId).map(r => r.skill));
  const ml = (skillsByUserCache[menteeId + ':learn'] ||=
    new Set(db.prepare("SELECT skill FROM skills WHERE user_id = ? AND type = 'wants_to_learn'").all(menteeId).map(r => r.skill.toLowerCase().trim())));
  return mt.filter(s => ml.has(s.toLowerCase().trim())).slice(0, 3);
}

const usedEmails = new Set();
const userIds = [];
const userById = new Map();

// Always start with the admin so its credentials are stable
{
  const result = insertUser.run(
    'admin@ment.io',
    passwordHash,
    'Admin Operator',
    'HR',
    'lead',
    'Platform Administrator',
    5,
    'London',
    'Operates the MENT platform.',
    '',
    1
  );
  const id = result.lastInsertRowid;
  userIds.push(id);
  userById.set(id, { dept: 'HR', seniority: 'lead', is_admin: true });
  usedEmails.add('admin@ment.io');
}

const insertEverything = db.transaction(() => {
  let created = 0;
  let attempts = 0;
  while (created < TARGET_USERS && attempts < TARGET_USERS * 6) {
    attempts++;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const baseEmail = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '');
    let email = `${baseEmail}@ment.io`;
    if (usedEmails.has(email)) {
      email = `${baseEmail}${created}@ment.io`;
      if (usedEmails.has(email)) continue;
    }
    usedEmails.add(email);
    const name = `${first} ${last}`;

    const dept = pick(DEPARTMENTS);
    const seniority = weightedPick(SENIORITY_DIST);
    const role = pick(ROLES_BY_DEPT[dept]);
    const tenure = Math.floor(rand() * 12); // 0..11
    const location = weightedPick(LOCATION_DIST);
    const shadowChance = rand();
    const shadow = shadowChance < 0.18
      ? `A day in ${pick(DEPARTMENTS.filter(d => d !== dept))} would help me understand how decisions land beyond my team.`
      : '';
    const bio = '';

    const result = insertUser.run(email, passwordHash, name, dept, seniority, role, tenure, location, bio, shadow, 0);
    const id = result.lastInsertRowid;
    userIds.push(id);
    userById.set(id, { dept, seniority, is_admin: false });
    created++;

    // ---------- Skills ----------
    // can_teach: 2-5 skills mostly from their dept + occasional cross-dept
    const teachCount = 2 + Math.floor(rand() * 4);
    const deptTeachPool = SKILLS_BY_DEPT[dept];
    const teachSkills = pickN(deptTeachPool, Math.min(teachCount, deptTeachPool.length));
    if (rand() < 0.4) teachSkills.push(pick(CROSS_DEPT_SKILLS));
    for (const s of teachSkills) {
      const example = rand() < 0.35
        ? `Led a project on ${s.toLowerCase()} that shipped in the last 18 months.`
        : '';
      insertSkill.run(id, s, 'can_teach', example);
    }

    // wants_to_learn: 2-4 skills, biased to other depts so cross-dept matching fires
    const learnCount = 2 + Math.floor(rand() * 3);
    const otherDept = pick(DEPARTMENTS.filter(d => d !== dept));
    const learnPool = [...SKILLS_BY_DEPT[otherDept], ...CROSS_DEPT_SKILLS];
    const learnSkills = pickN(learnPool, Math.min(learnCount, learnPool.length));
    for (const s of learnSkills) {
      insertSkill.run(id, s, 'wants_to_learn', '');
    }

    // ---------- Career history (sometimes cross-dept, fuels Signal 2) ----------
    if (rand() < 0.45) {
      const prevDept = rand() < 0.6 ? pick(DEPARTMENTS.filter(d => d !== dept)) : dept;
      const prevRole = pick(ROLES_BY_DEPT[prevDept]);
      const startYear = 2010 + Math.floor(rand() * 10);
      const endYear = startYear + 1 + Math.floor(rand() * 4);
      insertCareer.run(id, prevRole, prevDept, '', '', startYear, endYear);
    }
  }
});

console.log(`Generating ${TARGET_USERS} employees…`);
insertEverything();
console.log(`✓ Inserted ${userIds.length - 1} employees + 1 admin`);

// ---------- Manager assignments ----------
// Build an org tree by department. Within each dept, leads manage seniors,
// seniors manage mids, mids manage juniors. Skip some assignments so part of
// the workforce stays unmanaged (realistic mix).
const SENIORITY_RANK = { lead: 3, senior: 2, mid: 1, junior: 0 };
const employeeIds = userIds.slice(1);
const byDept = {};
for (const id of employeeIds) {
  const u = userById.get(id);
  (byDept[u.dept] ||= []).push({ id, seniority: u.seniority });
}
const setManager = db.prepare('UPDATE users SET manager_id = ? WHERE id = ?');
const assignManagers = db.transaction(() => {
  for (const dept of Object.keys(byDept)) {
    const folks = byDept[dept];
    folks.sort((a, b) => SENIORITY_RANK[b.seniority] - SENIORITY_RANK[a.seniority]);
    const leads   = folks.filter(f => f.seniority === 'lead');
    const seniors = folks.filter(f => f.seniority === 'senior');
    const mids    = folks.filter(f => f.seniority === 'mid');
    const juniors = folks.filter(f => f.seniority === 'junior');
    // Round-robin assignment so reports cluster reasonably
    const assignTo = (subset, managers) => {
      if (managers.length === 0) return;
      subset.forEach((person, i) => {
        // 90% of folks get a manager; 10% remain unassigned
        if (rand() > 0.9) return;
        const m = managers[i % managers.length];
        setManager.run(m.id, person.id);
      });
    };
    assignTo(seniors, leads);
    assignTo(mids,    [...leads, ...seniors]);
    assignTo(juniors, [...seniors, ...mids]);
  }
});
assignManagers();
const reportCount = db.prepare(
  'SELECT COUNT(*) as cnt FROM users WHERE manager_id IS NOT NULL'
).get().cnt;
const managerCount = db.prepare(
  'SELECT COUNT(DISTINCT manager_id) as cnt FROM users WHERE manager_id IS NOT NULL'
).get().cnt;
console.log(`✓ ${reportCount} employees assigned to ${managerCount} managers`);

// ---------- Sample sessions across states ----------
// We want every UI state visible: pending, scheduled, completed (with and without reflection).
const sessionTitles = ['Career growth chat','Skill deep-dive','Cross-team perspective','Mentor introduction','Feedback session','Quick how-do-you-do','Project advice','Network expansion'];

function rIso(deltaDays) {
  return new Date(Date.now() + deltaDays * 24 * 60 * 60 * 1000).toISOString();
}

// 30 sessions: ~10 pending, ~10 scheduled, ~10 completed (half with reflection)
const SESSION_TARGET = 30;
let sessionsCreated = 0;
for (let i = 0; i < SESSION_TARGET * 4 && sessionsCreated < SESSION_TARGET; i++) {
  const mentor = pick(employeeIds);
  let mentee = pick(employeeIds);
  while (mentee === mentor) mentee = pick(employeeIds);

  const bucket = sessionsCreated % 3; // 0=pending, 1=scheduled, 2=completed
  let status, scheduled, reflection;
  if (bucket === 0) {
    status = 'pending'; scheduled = null; reflection = '';
  } else if (bucket === 1) {
    status = 'scheduled'; scheduled = rIso(1 + Math.floor(rand() * 14)); reflection = '';
  } else {
    status = 'completed';
    scheduled = rIso(-1 - Math.floor(rand() * 30));
    reflection = rand() < 0.5
      ? `I will try ${pick(['rewriting our roadmap','hosting a cross-team review','asking different questions','running a quick experiment'])} based on this conversation.`
      : '';
  }
  const title = pick(sessionTitles);
  const question = pick([
    'What is the single biggest lever I am missing?',
    'How would you approach this if you had to start over today?',
    'Who else should I be talking to inside the company?',
    'What signals tell you something is going off track?'
  ]);
  const topics = JSON.stringify(topicsForPair(mentor, mentee));

  insertSession.run(mentor, mentee, title, scheduled, status, question, reflection, topics);
  sessionsCreated++;
}

console.log(`✓ Created ${sessionsCreated} sample sessions across pending/scheduled/completed`);

// ---------- Past meetings for the first N employees ----------
// Guarantees that the early demo accounts (Avery Singh, the next few in id
// order) each have a couple of completed past meetings so the "Past meetings"
// section on their profile is populated for demos.
const DEMO_PERSONAS = 12; // first 12 employees (low ids) get past meetings
const POOL = employeeIds.slice(0, 60); // pick counterparts from the first 60
const REFLECTIONS = [
  'I will try rewriting our planning doc with the framing they suggested.',
  'I want to host a cross-team review next week to test the idea we discussed.',
  'I am going to ask sharper questions in my next 1:1 — quality over quantity.',
  'I will run a small experiment to validate the assumption they pushed back on.',
  'I am going to draft a proposal using their structuring approach.',
  '',
];
const PAST_TITLES = [
  'Quarterly career conversation', 'Stuck on a tricky tradeoff',
  'Sounding-board session', 'Cross-functional handover',
  'Skill ramp-up plan', 'Honest feedback exchange',
];

// Pick a counterpart that has at least one overlapping skill with the persona
// (so the seeded meeting has topics to show). Falls back to a random pick if
// nothing overlaps within a few attempts.
function pickOverlappingCounterpart(personaId, role) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = pick(POOL);
    if (candidate === personaId) continue;
    const [mId, mtId] = role === 'mentor' ? [personaId, candidate] : [candidate, personaId];
    if (topicsForPair(mId, mtId).length > 0) return candidate;
  }
  let fallback = pick(POOL);
  while (fallback === personaId) fallback = pick(POOL);
  return fallback;
}

let pastForDemo = 0;
const seedPastMeeting = (mentorId, menteeId, daysAgo) => {
  if (mentorId === menteeId) return;
  const scheduledAt = rIso(-daysAgo);
  insertSession.run(
    mentorId,
    menteeId,
    pick(PAST_TITLES),
    scheduledAt,
    'completed',
    pick([
      'What would you do differently if you started this role over?',
      'How did you decide it was time to move on from your last team?',
      'When have you had to push back hardest on a stakeholder?',
      'What is the unglamorous skill you wish more people on your team had?',
    ]),
    pick(REFLECTIONS),
    JSON.stringify(topicsForPair(mentorId, menteeId)),
  );
  pastForDemo++;
};

for (let i = 0; i < Math.min(DEMO_PERSONAS, employeeIds.length); i++) {
  const personaId = employeeIds[i];
  // 2 meetings as mentee, 1 as mentor — pair with someone who has skill overlap
  seedPastMeeting(pickOverlappingCounterpart(personaId, 'mentee'), personaId, 5 + i);
  seedPastMeeting(pickOverlappingCounterpart(personaId, 'mentee'), personaId, 18 + i);
  seedPastMeeting(personaId, pickOverlappingCounterpart(personaId, 'mentor'), 12 + i);
}
console.log(`✓ Seeded ${pastForDemo} past meetings across the first ${DEMO_PERSONAS} demo personas`);

// ---------- Upcoming meetings for the demo personas ----------
let upcomingForDemo = 0;
const seedUpcomingMeeting = (mentorId, menteeId, daysAhead) => {
  if (mentorId === menteeId) return;
  // Pick a time around mid-day that day so it's a sensible meeting slot
  const dt = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  dt.setUTCHours(12 + Math.floor(rand() * 5), 0, 0, 0);
  insertSession.run(
    mentorId,
    menteeId,
    pick([
      'Career growth chat', 'Skill ramp-up plan', 'Strategy sounding board',
      'Cross-team perspective', 'Mentoring intro session',
    ]),
    dt.toISOString(),
    'scheduled',
    pick([
      'How would you sequence the next three months of my development?',
      'What is the biggest blind spot in how I am approaching this?',
      'Who else should I be learning from across the org?',
    ]),
    '',
    JSON.stringify(topicsForPair(mentorId, menteeId)),
  );
  upcomingForDemo++;
};

for (let i = 0; i < Math.min(DEMO_PERSONAS, employeeIds.length); i++) {
  const personaId = employeeIds[i];
  // One upcoming as mentee (in 2-9 days), and for half the personas a mentor one too
  seedUpcomingMeeting(pickOverlappingCounterpart(personaId, 'mentee'), personaId, 2 + i);
  if (i % 2 === 0) {
    seedUpcomingMeeting(personaId, pickOverlappingCounterpart(personaId, 'mentor'), 4 + Math.floor(i / 2));
  }
}
console.log(`✓ Seeded ${upcomingForDemo} upcoming meetings across the first ${DEMO_PERSONAS} demo personas`);

// ---------- "Awaiting mark-as-complete" sessions ----------
// One scheduled-with-past-time session per demo persona so the
// orange "Awaiting your mark-as-complete" badge has something to show.
let awaitingCount = 0;
const seedAwaitingMeeting = (mentorId, menteeId, hoursAgo) => {
  if (mentorId === menteeId) return;
  const scheduledAt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  insertSession.run(
    mentorId,
    menteeId,
    pick(['Skill ramp-up plan', 'Career pivot conversation', 'Stuck-on-a-tradeoff chat', 'Deep-dive coaching']),
    scheduledAt,
    'scheduled',
    pick([
      'How would you sequence the next three months given my goals?',
      'What is one habit I should adopt this quarter?',
      'Where do you see the biggest blind spot in how I am approaching this?',
    ]),
    '',  // no reflection yet — it has not been marked complete
    JSON.stringify(topicsForPair(mentorId, menteeId)),
  );
  awaitingCount++;
};
for (let i = 0; i < Math.min(DEMO_PERSONAS, employeeIds.length); i++) {
  const personaId = employeeIds[i];
  // Persona was the mentee — they're the one expected to mark it complete
  seedAwaitingMeeting(pick(POOL), personaId, 6 + i * 2);
  // Persona was the mentor for one — both sides see "awaiting"
  if (i < 4) seedAwaitingMeeting(personaId, pick(POOL), 3 + i);
}
console.log(`✓ Seeded ${awaitingCount} scheduled-but-past sessions ("awaiting mark-as-complete")`);

// ---------- Compute matches ----------
console.log('Computing match scores (this may take a few seconds for 300+ users)…');
const t0 = Date.now();
computeAllMatches();
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const matchCount = db.prepare('SELECT COUNT(*) as cnt FROM match_scores').get().cnt;
console.log(`✓ ${matchCount} match pairs computed in ${elapsed}s`);

console.log(`\nTemporary password for all seeded users (change on first login): ${demoPassword}`);
console.log('Admin login:                   admin@ment.io');
const samples = db.prepare(`
  SELECT email FROM users WHERE is_admin = 0 ORDER BY id LIMIT 5
`).all();
console.log('Sample employee emails:        ' + samples.map(s => s.email).join(', '));
