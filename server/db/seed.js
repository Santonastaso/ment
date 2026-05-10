const path = require('path');
// Ensure DB is created relative to this file's location
process.chdir(path.join(__dirname, '..'));

const db = require('./database');
const { runSchema } = require('./schema');
const bcrypt = require('bcryptjs');
const { computeAllMatches } = require('../utils/matching');

runSchema();

// Clear existing data
db.exec(`
  DELETE FROM match_scores;
  DELETE FROM sessions;
  DELETE FROM connections;
  DELETE FROM skills;
  DELETE FROM career_history;
  DELETE FROM users;
`);

const hash = bcrypt.hashSync('ment2026', 10);

const insertUser = db.prepare(`
  INSERT INTO users (email, password_hash, name, department, seniority, current_role, tenure_years, location, bio, shadow_role_response, onboarding_complete, is_admin)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
`);

const users = [
  // Engineering
  { email: 'alice.chen@ment.io',     name: 'Alice Chen',      dept: 'Engineering', seniority: 'lead',   role: 'Principal Engineer',     tenure: 12, location: 'San Francisco', bio: 'Building scalable systems for 12 years. Passionate about mentoring the next generation of engineers.', shadow: '', admin: 1 },
  { email: 'bob.taylor@ment.io',     name: 'Bob Taylor',      dept: 'Engineering', seniority: 'senior', role: 'Senior Frontend Engineer', tenure: 6, location: 'London', bio: 'React specialist with a love for clean UIs and great developer experience.', shadow: 'A day with a UX researcher running real user interviews — I want to see what good qualitative discovery looks like end to end.', admin: 0 },
  { email: 'carol.smith@ment.io',    name: 'Carol Smith',     dept: 'Engineering', seniority: 'mid',    role: 'Data Engineer',            tenure: 4, location: 'New York', bio: 'Turning raw data into insights. Previously worked in finance which gives me a unique perspective.', shadow: '', admin: 0 },
  { email: 'david.park@ment.io',     name: 'David Park',      dept: 'Engineering', seniority: 'junior', role: 'Junior Software Engineer', tenure: 1, location: 'Seoul', bio: 'Eager to grow my skills in modern web development and system architecture.', shadow: 'A staff engineer during architecture review week — I want to learn how big technical decisions actually get made.', admin: 0 },
  { email: 'eva.jones@ment.io',      name: 'Eva Jones',       dept: 'Engineering', seniority: 'mid',    role: 'DevOps Engineer',          tenure: 5, location: 'Berlin', bio: 'Keeping the infrastructure humming. Working toward principal-level system design skills.', shadow: '', admin: 0 },
  // Finance
  { email: 'frank.wu@ment.io',       name: 'Frank Wu',        dept: 'Finance', seniority: 'lead',   role: 'Head of Finance',          tenure: 10, location: 'Singapore', bio: 'Started my career as a software engineer before moving into finance. I bridge both worlds.', shadow: '', admin: 0 },
  { email: 'grace.lee@ment.io',      name: 'Grace Lee',       dept: 'Finance', seniority: 'senior', role: 'Senior Financial Analyst',  tenure: 7, location: 'New York', bio: 'Deep expertise in compliance and financial modeling. Happy to share what I know.', shadow: '', admin: 0 },
  { email: 'henry.brown@ment.io',    name: 'Henry Brown',     dept: 'Finance', seniority: 'mid',    role: 'Financial Analyst',         tenure: 3, location: 'London', bio: 'Looking to add technical skills to complement my finance background.', shadow: 'A data engineer building a pipeline from scratch — I want to feel what it is like to think in systems, not spreadsheets.', admin: 0 },
  { email: 'iris.davis@ment.io',     name: 'Iris Davis',      dept: 'Finance', seniority: 'junior', role: 'Junior Analyst',            tenure: 1, location: 'Dublin', bio: 'Fresh out of university. Excited to learn from experienced colleagues.', shadow: '', admin: 0 },
  // Marketing
  { email: 'jack.wilson@ment.io',    name: 'Jack Wilson',     dept: 'Marketing', seniority: 'senior', role: 'SEO & Content Lead',     tenure: 8, location: 'Remote', bio: 'Built SEO strategies that drove 10x organic growth. Love teaching the craft.', shadow: '', admin: 0 },
  { email: 'kate.moore@ment.io',     name: 'Kate Moore',      dept: 'Marketing', seniority: 'mid',    role: 'Content Strategist',     tenure: 4, location: 'Toronto', bio: 'Words are my craft. Now learning to back them up with data.', shadow: 'An analytics lead during a quarterly review — I want to understand which numbers actually drive decisions.', admin: 0 },
  { email: 'leo.martinez@ment.io',   name: 'Leo Martinez',    dept: 'Marketing', seniority: 'junior', role: 'Marketing Coordinator',  tenure: 1, location: 'Mexico City', bio: 'Just getting started. Keen to learn SEO, strategy, and storytelling.', shadow: '', admin: 0 },
  // Operations
  { email: 'mia.white@ment.io',      name: 'Mia White',       dept: 'Operations', seniority: 'lead',   role: 'VP of Operations',     tenure: 11, location: 'Amsterdam', bio: 'Spent 5 years in marketing before ops. I have a broad view of how organizations work.', shadow: '', admin: 0 },
  { email: 'noah.garcia@ment.io',    name: 'Noah Garcia',     dept: 'Operations', seniority: 'senior', role: 'Supply Chain Manager', tenure: 9, location: 'São Paulo', bio: 'Vendor management and supply chain optimization specialist.', shadow: '', admin: 0 },
  { email: 'olivia.thomas@ment.io',  name: 'Olivia Thomas',   dept: 'Operations', seniority: 'mid',    role: 'Operations Analyst',   tenure: 4, location: 'Sydney', bio: 'Streamlining processes. Aspiring future operations leader.', shadow: 'An operations VP for a day during planning — I want to see how priorities get traded off across teams.', admin: 0 },
];

const userIds = {};
for (const u of users) {
  const result = insertUser.run(u.email, hash, u.name, u.dept, u.seniority, u.role, u.tenure, u.location, u.bio, u.shadow, u.admin);
  userIds[u.email] = result.lastInsertRowid;
}

// Manager relationships — leads manage seniors+mids, seniors manage juniors in same dept.
// Skipped for some users so we have realistic mix of managed/unmanaged employees.
const setManager = db.prepare('UPDATE users SET manager_id = ? WHERE id = ?');
const managerships = [
  // Engineering — Alice (lead) manages Bob, Carol, Eva; Bob (senior) manages David
  ['alice.chen@ment.io',  ['bob.taylor@ment.io', 'carol.smith@ment.io', 'eva.jones@ment.io']],
  ['bob.taylor@ment.io',  ['david.park@ment.io']],
  // Finance — Frank (lead) manages Grace, Henry, Iris
  ['frank.wu@ment.io',    ['grace.lee@ment.io', 'henry.brown@ment.io', 'iris.davis@ment.io']],
  // Marketing — Jack (senior) manages Kate, Leo (no Marketing lead in seed)
  ['jack.wilson@ment.io', ['kate.moore@ment.io', 'leo.martinez@ment.io']],
  // Operations — Mia (lead) manages Noah, Olivia
  ['mia.white@ment.io',   ['noah.garcia@ment.io', 'olivia.thomas@ment.io']],
];
for (const [managerEmail, reportEmails] of managerships) {
  const managerId = userIds[managerEmail];
  for (const reportEmail of reportEmails) {
    setManager.run(managerId, userIds[reportEmail]);
  }
}

// Career history (cross-department — critical for Signal 2 matching)
const insertCareer = db.prepare(
  'INSERT INTO career_history (user_id, role, department, company, start_year, end_year) VALUES (?, ?, ?, ?, ?, ?)'
);

insertCareer.run(userIds['frank.wu@ment.io'],    'Software Engineer',      'Engineering', 'TechCorp',     2012, 2016);
insertCareer.run(userIds['frank.wu@ment.io'],    'Senior Software Engineer','Engineering','TechCorp',     2016, 2018);
insertCareer.run(userIds['carol.smith@ment.io'], 'Financial Analyst',      'Finance',     'FinanceGroup', 2018, 2020);
insertCareer.run(userIds['mia.white@ment.io'],   'Marketing Manager',      'Marketing',   'BrandCo',      2013, 2018);
insertCareer.run(userIds['mia.white@ment.io'],   'Senior Marketing Lead',  'Marketing',   'BrandCo',      2018, 2019);
insertCareer.run(userIds['alice.chen@ment.io'],  'Engineering Manager',    'Engineering', 'StartupXYZ',   2015, 2019);
insertCareer.run(userIds['grace.lee@ment.io'],   'Compliance Officer',     'Finance',     'RegulatoryCo', 2017, 2020);

// Skills — can_teach entries can be either a string or [skill, example_project]
const insertSkill = db.prepare('INSERT INTO skills (user_id, skill, type, example_project) VALUES (?, ?, ?, ?)');

const skillData = [
  // Alice Chen — Engineering lead
  ['alice.chen@ment.io', 'can_teach',      [
    ['system design', 'Led the redesign of our payment service from a monolith to four bounded services in 2024.'],
    ['microservices', 'Owned the platform-wide migration off the legacy job runner.'],
    'engineering leadership', 'mentoring', 'technical roadmapping']],
  // Bob Taylor — Engineering senior
  ['bob.taylor@ment.io', 'can_teach',      [
    ['React', 'Built the design-system migration that cut UI bug reports in half.'],
    ['TypeScript', 'Rolled out strict mode across a 200k LOC frontend codebase.'],
    'CI/CD', 'frontend architecture', 'code review']],
  // Carol Smith — Engineering mid
  ['carol.smith@ment.io','can_teach',      ['Python', 'data pipelines', 'SQL', 'ETL workflows']],
  ['carol.smith@ment.io','wants_to_learn', ['machine learning', 'system design']],
  // David Park — Engineering junior
  ['david.park@ment.io', 'wants_to_learn', ['system design', 'React', 'CI/CD', 'TypeScript', 'code review']],
  // Eva Jones — Engineering mid
  ['eva.jones@ment.io',  'can_teach',      [
    ['Kubernetes', 'Migrated all production workloads to a multi-region cluster last spring.'],
    'DevOps', 'Docker', 'cloud infrastructure']],
  ['eva.jones@ment.io',  'wants_to_learn', ['system design', 'engineering leadership', 'technical roadmapping']],
  // Frank Wu — Finance lead
  ['frank.wu@ment.io',   'can_teach',      [
    ['financial modeling', 'Built the three-statement model that anchored our Series C raise.'],
    'leadership', 'budgeting', 'Python', 'data analysis', 'system design']],
  // Grace Lee — Finance senior
  ['grace.lee@ment.io',  'can_teach',      [
    ['compliance', 'Led the SOX-readiness rollout across two business units.'],
    'Excel', 'financial analysis', 'risk management', 'financial reporting']],
  // Henry Brown — Finance mid
  ['henry.brown@ment.io','wants_to_learn', ['financial modeling', 'Python', 'data pipelines', 'SQL']],
  // Iris Davis — Finance junior
  ['iris.davis@ment.io', 'wants_to_learn', ['Excel', 'financial analysis', 'compliance', 'budgeting']],
  // Jack Wilson — Marketing senior
  ['jack.wilson@ment.io','can_teach',      [
    ['SEO', 'Took our blog from 30k to 300k monthly organic visits in 18 months.'],
    'content strategy', 'analytics', 'growth marketing', 'copywriting']],
  // Kate Moore — Marketing mid
  ['kate.moore@ment.io', 'can_teach',      ['social media', 'copywriting', 'brand storytelling']],
  ['kate.moore@ment.io', 'wants_to_learn', ['analytics', 'data pipelines', 'SQL', 'growth marketing']],
  // Leo Martinez — Marketing junior
  ['leo.martinez@ment.io','wants_to_learn',['SEO', 'content strategy', 'social media', 'copywriting', 'brand storytelling']],
  // Mia White — Operations lead
  ['mia.white@ment.io',  'can_teach',      [
    ['process optimization', 'Cut onboarding time from 6 weeks to 10 days by reworking the ramp playbook.'],
    'project management', 'leadership', 'change management', 'content strategy']],
  // Noah Garcia — Operations senior
  ['noah.garcia@ment.io','can_teach',      ['supply chain', 'vendor management', 'procurement', 'operations analytics']],
  // Olivia Thomas — Operations mid
  ['olivia.thomas@ment.io','wants_to_learn',['project management', 'leadership', 'process optimization', 'change management']],
];

for (const [email, type, skills] of skillData) {
  for (const entry of skills) {
    const [skill, example] = Array.isArray(entry) ? entry : [entry, ''];
    insertSkill.run(userIds[email], skill, type, example);
  }
}

// Pre-seeded sessions
const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

const insertSession = db.prepare(`
  INSERT INTO sessions (mentor_id, mentee_id, title, scheduled_at, status, pre_session_question, reflection, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
`);

// Session 1: pending — bob mentors david
insertSession.run(
  userIds['bob.taylor@ment.io'],
  userIds['david.park@ment.io'],
  'TypeScript Fundamentals',
  null,
  'pending',
  'How do I structure a large TypeScript project without the types becoming a maintenance burden?',
  ''
);

// Session 2: scheduled — alice mentors eva
insertSession.run(
  userIds['alice.chen@ment.io'],
  userIds['eva.jones@ment.io'],
  'System Design Patterns',
  threeDaysFromNow,
  'scheduled',
  'What are the most important trade-offs to consider when designing a distributed system from scratch?',
  ''
);

// Session 3: completed — jack mentors leo
insertSession.run(
  userIds['jack.wilson@ment.io'],
  userIds['leo.martinez@ment.io'],
  'SEO Strategy & Keyword Research',
  twoDaysAgo,
  'completed',
  'What is the single most impactful SEO tactic a small team can implement in under a week?',
  'I will start by auditing our top 10 pages for keyword cannibalization this week, and set up a simple content calendar using the cluster strategy Jack described.'
);

// Compute all match scores
console.log('Computing match scores...');
computeAllMatches();
const matchCount = db.prepare('SELECT COUNT(*) as cnt FROM match_scores').get().cnt;

console.log(`✓ Seeded ${users.length} users across 4 departments`);
console.log(`✓ ${matchCount} match pairs computed`);
console.log(`✓ 3 sample sessions created (pending, scheduled, completed)`);
console.log(`\nTest credentials (all passwords: ment2026):`);
console.log(`  Admin:    alice.chen@ment.io`);
console.log(`  Employee: bob.taylor@ment.io, frank.wu@ment.io, jack.wilson@ment.io, mia.white@ment.io`);
