import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPlaceholderName, onboardingErrorKey } from '../client/src/lib/onboarding.mjs';

test('student identifiers and email-derived names can be corrected', () => {
  assert.equal(hasPlaceholderName('B00810548'), true);
  assert.equal(hasPlaceholderName('martina', 'martina@example.org'), true);
  assert.equal(hasPlaceholderName('Martina Micheli', 'martina@example.org'), false);
});

test('onboarding translates authentication and schema errors without exposing backend details', () => {
  assert.equal(onboardingErrorKey({ response: { data: { error: 'invalid_token' } } }), 'onboarding.error.session');
  assert.equal(onboardingErrorKey({ response: { status: 401, data: { error: 'Function returned an error' } } }, true), 'onboarding.error.session');
  assert.equal(onboardingErrorKey({ message: 'Could not find public.save_onboarding in the schema cache' }), 'onboarding.error.unavailable');
  assert.equal(onboardingErrorKey({ message: 'unknown_internal_failure' }, true), 'onboarding.import.error');
  assert.equal(onboardingErrorKey({ response: { status: 502, data: { error: 'ai_invalid_response' } } }, true), 'onboarding.import.unavailable');
  assert.equal(onboardingErrorKey({ response: { status: 400, data: { error: 'text_too_short' } } }, true), 'onboarding.import.unreadable');
});
