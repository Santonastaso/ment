const db = require('../db/database');

// Matching is intentionally seniority-agnostic — the platform classifies
// people by their capabilities, not their position in the org hierarchy.
// Signals: skill overlap (40pts), career cross-pollination (20pts), and
// department diversity (25pts). Max score = 85.
function computeScore(userA, userB, skillsA, skillsB, careerA, careerB) {
  let score = 0;
  const reasons = [];

  // Signal 1 — Skill overlap (max 40pts, 10pts per matching skill)
  const aTeachesArr = skillsA.filter(s => s.type === 'can_teach').map(s => s.skill);
  const aLearnsArr  = skillsA.filter(s => s.type === 'wants_to_learn').map(s => s.skill);
  const bTeachesArr = skillsB.filter(s => s.type === 'can_teach').map(s => s.skill);
  const bLearnsArr  = skillsB.filter(s => s.type === 'wants_to_learn').map(s => s.skill);

  const lc = arr => arr.map(s => s.toLowerCase().trim());
  const aTeaches = lc(aTeachesArr);
  const aLearns  = lc(aLearnsArr);
  const bTeaches = lc(bTeachesArr);
  const bLearns  = lc(bLearnsArr);

  const bTeachesALearns = aLearns.filter(s => bTeaches.includes(s));
  const aTeachesBLearns = bLearns.filter(s => aTeaches.includes(s));
  const matchingSkills = [...new Set([...bTeachesALearns, ...aTeachesBLearns])];
  score += Math.min(matchingSkills.length * 10, 40);

  if (bTeachesALearns.length > 0) {
    reasons.push({
      type: 'teach_overlap',
      teacher_id: userB.id,
      learner_id: userA.id,
      skills: bTeachesALearns.slice(0, 3),
    });
  }
  if (aTeachesBLearns.length > 0) {
    reasons.push({
      type: 'teach_overlap',
      teacher_id: userA.id,
      learner_id: userB.id,
      skills: aTeachesBLearns.slice(0, 3),
    });
  }

  // Signal 2 — Career cross-pollination (max 20pts)
  const bWorkedInADept = careerB.some(c => c.department === userA.department);
  const aWorkedInBDept = careerA.some(c => c.department === userB.department);

  if (bWorkedInADept) {
    score += 20;
    reasons.push({ type: 'career_bridge', who_id: userB.id, into_dept: userA.department });
  } else if (aWorkedInBDept) {
    score += 20;
    reasons.push({ type: 'career_bridge', who_id: userA.id, into_dept: userB.department });
  }

  // Signal 3 — Department diversity (25pts)
  if (userA.department !== userB.department) {
    score += 25;
    reasons.push({
      type: 'dept_diversity',
      a_id: userA.id, a_dept: userA.department,
      b_id: userB.id, b_dept: userB.department,
    });
  }

  return { score, reasons };
}

// Render structured reasons to short, personal text from the viewer's
// perspective. Always uses the *other* person's first name and never
// confuses "you" with "them".
//
// When opts.mentorOnly is true, mentee-direction signals (things the viewer
// could teach the candidate, places where the viewer is more senior) are
// suppressed so the dashboard tells a single, coherent story:
// "here is someone who can help you grow".
function renderReasons(structured, viewer, other, opts = {}) {
  if (!Array.isArray(structured)) return [];
  const mentorOnly = opts.mentorOnly === true;
  const them = (other.name || '').split(' ')[0] || other.name || 'They';
  const out = [];
  for (const r of structured) {
    if (r.type === 'teach_overlap') {
      const skills = (r.skills || []).slice(0, 3).join(', ');
      if (r.teacher_id === other.id) {
        out.push(`${them} can teach ${skills} — areas you're growing in`);
      } else if (r.teacher_id === viewer.id) {
        if (mentorOnly) continue;
        out.push(`You can teach ${skills} — and ${them} wants to learn it`);
      }
    } else if (r.type === 'career_bridge') {
      if (r.who_id === other.id) {
        out.push(`${them} has worked in ${r.into_dept} before — they understand your world`);
      } else if (r.who_id === viewer.id) {
        if (mentorOnly) continue;
        out.push(`You've worked in ${other.department} — common ground with ${them}`);
      }
    } else if (r.type === 'dept_diversity') {
      const otherDept = r.a_id === other.id ? r.a_dept : r.b_dept;
      const yourDept = r.a_id === viewer.id ? r.a_dept : r.b_dept;
      out.push(`${them} works in ${otherDept} — a fresh angle from ${yourDept}`);
    }
  }
  return out;
}

// Decide whether `other` is leaning "mentor" rather than "mentee" from the
// viewer's perspective. Used by the Dashboard's mentor-only filter.
// Capability-based: only skill teaching direction and career-bridge experience
// count — seniority is intentionally ignored.
function isMentorLeaning(structured, viewerId, otherId) {
  if (!Array.isArray(structured)) return true;
  let mentor = 0;
  let mentee = 0;
  for (const r of structured) {
    if (r.type === 'teach_overlap') {
      if (r.teacher_id === otherId) mentor += 2;
      else if (r.teacher_id === viewerId) mentee += 2;
    } else if (r.type === 'career_bridge') {
      if (r.who_id === otherId) mentor += 1;
      else if (r.who_id === viewerId) mentee += 1;
    }
  }
  // Tie goes to mentor (they may still have something to share via dept diversity)
  return mentor >= mentee;
}

function computeMatchesForUser(userId) {
  const allUsers = db.prepare('SELECT * FROM users WHERE is_admin = 0').all();
  const targetUser = allUsers.find(u => u.id === userId);
  if (!targetUser) return;

  const targetSkills = db.prepare('SELECT * FROM skills WHERE user_id = ?').all(userId);
  const targetCareer = db.prepare('SELECT * FROM career_history WHERE user_id = ?').all(userId);

  const insertOrReplace = db.prepare(`
    INSERT OR REPLACE INTO match_scores (user_a_id, user_b_id, score, reasons, computed_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  const deleteBelow = db.prepare('DELETE FROM match_scores WHERE user_a_id = ? AND user_b_id = ? AND score < 30');

  for (const other of allUsers) {
    if (other.id === userId) continue;

    const otherSkills = db.prepare('SELECT * FROM skills WHERE user_id = ?').all(other.id);
    const otherCareer = db.prepare('SELECT * FROM career_history WHERE user_id = ?').all(other.id);

    const [a, b] = userId < other.id ? [targetUser, other] : [other, targetUser];
    const [sA, sB] = userId < other.id ? [targetSkills, otherSkills] : [otherSkills, targetSkills];
    const [cA, cB] = userId < other.id ? [targetCareer, otherCareer] : [otherCareer, targetCareer];

    const { score, reasons } = computeScore(a, b, sA, sB, cA, cB);

    if (score >= 30) {
      insertOrReplace.run(a.id, b.id, score, JSON.stringify(reasons));
    } else {
      deleteBelow.run(a.id, b.id);
    }
  }
}

function computeAllMatches() {
  const allUsers = db.prepare('SELECT * FROM users WHERE is_admin = 0').all();

  // Pre-fetch all skills and career histories
  const allSkills = db.prepare('SELECT * FROM skills').all();
  const allCareer = db.prepare('SELECT * FROM career_history').all();

  const skillsByUser = {};
  const careerByUser = {};
  for (const u of allUsers) {
    skillsByUser[u.id] = allSkills.filter(s => s.user_id === u.id);
    careerByUser[u.id] = allCareer.filter(c => c.user_id === u.id);
  }

  const insertOrReplace = db.prepare(`
    INSERT OR REPLACE INTO match_scores (user_a_id, user_b_id, score, reasons, computed_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);

  db.prepare('DELETE FROM match_scores').run();

  const insertMany = db.transaction(() => {
    for (let i = 0; i < allUsers.length; i++) {
      for (let j = i + 1; j < allUsers.length; j++) {
        const a = allUsers[i];
        const b = allUsers[j];
        const { score, reasons } = computeScore(
          a, b,
          skillsByUser[a.id], skillsByUser[b.id],
          careerByUser[a.id], careerByUser[b.id]
        );
        if (score >= 30) {
          insertOrReplace.run(a.id, b.id, score, JSON.stringify(reasons));
        }
      }
    }
  });

  insertMany();
}

// Aggregate the viewer's accept/decline history into a department-only bias
// signal. Used by getMatchesForUser to personalize the order of stored match
// scores without changing the underlying base score.
function getViewerPreferences(userId) {
  const declined = db.prepare(`
    SELECT u.department FROM connections c
    JOIN users u ON u.id = c.addressee_id
    WHERE c.requester_id = ? AND c.status = 'declined'
  `).all(userId);

  const accepted = db.prepare(`
    SELECT u.department FROM sessions s
    JOIN users u ON u.id = CASE WHEN s.mentor_id = ? THEN s.mentee_id ELSE s.mentor_id END
    WHERE (s.mentor_id = ? OR s.mentee_id = ?) AND s.status IN ('scheduled', 'completed')
  `).all(userId, userId, userId);

  const tally = (rows, key) => rows.reduce((acc, r) => {
    const v = r[key];
    if (v) acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});

  return {
    declines: { dept: tally(declined, 'department') },
    accepts: { dept: tally(accepted, 'department') },
  };
}

// Compute the per-match adjustment (positive or negative) and any extra
// reasons to surface. Caps are tight so signal never dominates the base score.
function viewerAdjustment(prefs, candidate) {
  const declinesDept = prefs.declines.dept[candidate.department] || 0;
  const acceptsDept  = prefs.accepts.dept[candidate.department]  || 0;

  // Each completed/scheduled session = +2 (cap +6); each decline = -1 (cap -8)
  const deptBoost   = Math.min(acceptsDept * 2, 6);
  const deptPenalty = -Math.min(declinesDept, 8);

  const adjustment = deptBoost + deptPenalty;
  const reasons = [];
  if (acceptsDept >= 1) {
    reasons.push(
      `Past mentoring with ${candidate.department} colleagues has gone well — extra weight added.`
    );
  }
  return { adjustment, reasons };
}

function getMatchesForUser(userId, { limit, offset = 0, role = null } = {}) {
  const viewer = db.prepare(
    'SELECT id, name, department, seniority FROM users WHERE id = ?'
  ).get(userId);
  if (!viewer) return [];

  const rows = db.prepare(`
    SELECT ms.*,
      CASE WHEN ms.user_a_id = ? THEN ms.user_b_id ELSE ms.user_a_id END as other_id
    FROM match_scores ms
    WHERE ms.user_a_id = ? OR ms.user_b_id = ?
  `).all(userId, userId, userId);

  const dismissed = db.prepare(`
    SELECT addressee_id FROM connections WHERE requester_id = ? AND status = 'declined'
  `).all(userId).map(r => r.addressee_id);

  const prefs = getViewerPreferences(userId);

  // Augment, filter, re-rank
  const augmented = [];
  for (const row of rows) {
    if (dismissed.includes(row.other_id)) continue;
    const candidate = db.prepare(
      'SELECT id, name, department, seniority FROM users WHERE id = ?'
    ).get(row.other_id);
    if (!candidate) continue;

    let structured;
    try { structured = JSON.parse(row.reasons); } catch { structured = []; }
    // Backwards-compat: any string entries in reasons (from older seeds) get dropped
    structured = Array.isArray(structured) ? structured.filter(r => r && typeof r === 'object') : [];

    // Mentor-only filter for the dashboard view — exclude pairs where the
    // viewer is more of a mentor than mentee. Suggestions should always be
    // someone the viewer could *learn from*, not the other way round.
    if (role === 'mentor' && !isMentorLeaning(structured, userId, candidate.id)) continue;

    const { adjustment, reasons: extraStructured } = viewerAdjustment(prefs, candidate);
    const renderedBase = renderReasons(structured, viewer, candidate, { mentorOnly: role === 'mentor' });
    const reasons = [...renderedBase, ...extraStructured];

    augmented.push({
      ...row,
      adjustedScore: Math.max(0, Math.min(100, row.score + adjustment)),
      baseScore: row.score,
      adjustment,
      reasons,
    });
  }
  augmented.sort((a, b) => b.adjustedScore - a.adjustedScore);

  const start = offset;
  const end = limit ? offset + limit : augmented.length;
  const slice = augmented.slice(start, end);

  const results = [];
  for (const row of slice) {
    const user = db.prepare(
      'SELECT id, name, department, seniority, current_role, location, bio FROM users WHERE id = ?'
    ).get(row.other_id);
    if (!user) continue;
    // Surface only "can_teach" skills on the candidate card — wants_to_learn
    // is private (matches the profile-page privacy rule).
    const skills = db.prepare(
      "SELECT skill, type, example_project FROM skills WHERE user_id = ? AND type = 'can_teach'"
    ).all(row.other_id);
    results.push({
      matchId: row.id,
      score: row.adjustedScore,
      baseScore: row.baseScore,
      adjustment: row.adjustment,
      reasons: row.reasons,
      user: { ...user, skills }
    });
  }
  return results;
}

function countMatchesForUser(userId, { role = null } = {}) {
  const rows = db.prepare(`
    SELECT ms.reasons,
      CASE WHEN ms.user_a_id = ? THEN ms.user_b_id ELSE ms.user_a_id END as other_id
    FROM match_scores ms
    WHERE ms.user_a_id = ? OR ms.user_b_id = ?
  `).all(userId, userId, userId);
  const dismissed = new Set(db.prepare(
    `SELECT addressee_id FROM connections WHERE requester_id = ? AND status = 'declined'`
  ).all(userId).map(r => r.addressee_id));

  let count = 0;
  for (const r of rows) {
    if (dismissed.has(r.other_id)) continue;
    if (role === 'mentor') {
      let structured;
      try { structured = JSON.parse(r.reasons); } catch { structured = []; }
      structured = Array.isArray(structured) ? structured.filter(x => x && typeof x === 'object') : [];
      if (!isMentorLeaning(structured, userId, r.other_id)) continue;
    }
    count++;
  }
  return count;
}

module.exports = { computeMatchesForUser, computeAllMatches, getMatchesForUser, countMatchesForUser };
