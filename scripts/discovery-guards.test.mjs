import assert from 'node:assert/strict';
import test from 'node:test';
import { canHelpWithCareerGoal, hasGroundedExpertise } from '../supabase/functions/_shared/discovery-guards.mjs';

const candidate = { job_title: 'Brand Director', department: 'Marketing', skills: ['Content strategy'] };

test('rejects adjacent roles even when the evidence exists on the profile', () => {
  assert.equal(hasGroundedExpertise(candidate, {
    matched_expertise: ['Marketing'],
    reasons: ['No direct consulting expertise, but adjacent executive roles may include it.'],
  }), false);
});

test('rejects invented evidence', () => {
  assert.equal(hasGroundedExpertise(candidate, { matched_expertise: ['Management consulting'], reasons: ['Direct work'] }), false);
});

test('keeps directly evidenced candidates', () => {
  assert.equal(hasGroundedExpertise(candidate, { matched_expertise: ['Content strategy'], reasons: ['Lists content strategy'] }), true);
});

test('an internship seeker needs a helper, not another unrelated applicant', () => {
  assert.equal(canHelpWithCareerGoal({ job_title: 'Luxury marketing intern', skills: ['Marketing'] }, 'Help finding a finance internship'), false);
  assert.equal(canHelpWithCareerGoal({ job_title: 'Finance intern', skills: ['Financial modelling'] }, 'Je cherche un stage en finance'), false);
  assert.equal(canHelpWithCareerGoal({ job_title: 'Finance Analyst', skills: ['Financial modelling'] }, 'Help finding a finance internship'), true);
  assert.equal(canHelpWithCareerGoal({ job_title: 'Recruitment intern', skills: ['Interview preparation'] }, 'Cerco un tirocinio'), true);
  assert.equal(canHelpWithCareerGoal({ job_title: 'Finance intern', skills: ['Financial modelling'] }, 'Learn financial modelling'), true);
});
