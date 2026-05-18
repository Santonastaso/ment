const { setupTestDb, truncateAll, teardownTestDb } = require('./helpers');

let dbPath;
let db;
let matching;

beforeAll(() => {
  ({ dbPath, db } = setupTestDb());
  matching = require('../utils/matching');
});
afterAll(() => teardownTestDb(dbPath));
beforeEach(() => truncateAll(db));

describe('matching', () => {
  test('computeScore: skill overlap only', () => {
    const a = { id: 1, department: 'Engineering' };
    const b = { id: 2, department: 'Engineering' };
    const { score, reasons } = matching.computeScore(
      a, b,
      [{ type: 'wants_to_learn', skill: 'React' }],
      [{ type: 'can_teach', skill: 'React' }],
      [], []
    );
    expect(score).toBe(10);
    expect(reasons.some(r => r.type === 'teach_overlap')).toBe(true);
  });

  test('computeScore: department diversity adds 25', () => {
    const a = { id: 1, department: 'Engineering' };
    const b = { id: 2, department: 'Finance' };
    const { score } = matching.computeScore(a, b, [], [], [], []);
    expect(score).toBe(25);
  });

  test('computeScore: career bridge adds 20', () => {
    const a = { id: 1, department: 'Engineering' };
    const b = { id: 2, department: 'Engineering' };
    const { score } = matching.computeScore(a, b, [], [], [], [{ department: 'Engineering' }]);
    expect(score).toBe(20);
  });

  test('isMentorLeaning: other teaches viewer = true', () => {
    const structured = [{ type: 'teach_overlap', teacher_id: 2, learner_id: 1, skills: ['React'] }];
    expect(matching.isMentorLeaning(structured, 1, 2)).toBe(true);
  });

  test('isMentorLeaning: viewer teaches other = false', () => {
    const structured = [
      { type: 'teach_overlap', teacher_id: 1, learner_id: 2, skills: ['React'] },
      { type: 'teach_overlap', teacher_id: 1, learner_id: 2, skills: ['SQL'] },
    ];
    expect(matching.isMentorLeaning(structured, 1, 2)).toBe(false);
  });

  test('viewerAdjustment: rating floor at n>=2 suppresses single bad rating', () => {
    const prefs = {
      declines: { dept: {} },
      accepts: { dept: {} },
      ratings: { dept: { Finance: { sum: 2, count: 1, avg: 2 } } },
    };
    const { adjustment } = matching.viewerAdjustment(prefs, { department: 'Finance' });
    expect(adjustment).toBe(0);
  });

  test('viewerAdjustment: decline penalty caps at -8', () => {
    const prefs = {
      declines: { dept: { Finance: 50 } },
      accepts: { dept: {} },
      ratings: { dept: {} },
    };
    const { adjustment } = matching.viewerAdjustment(prefs, { department: 'Finance' });
    expect(adjustment).toBe(-8);
  });
});
