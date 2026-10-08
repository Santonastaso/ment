export function onboardingErrorKey(error, importing = false) {
  const code = error?.response?.data?.error || error?.message || '';
  if (error?.response?.status === 401) return 'onboarding.error.session';
  if (/invalid_token|auth_required|jwt|session.*expired/i.test(code)) return 'onboarding.error.session';
  if (/save_onboarding|schema cache|PGRST202/i.test(code)) return 'onboarding.error.unavailable';
  if (/text_too_short/i.test(code)) return 'onboarding.import.unreadable';
  if (/document_too|unsupported_document|document_read/i.test(code)) return 'onboarding.import.error';
  if (/ai_not_configured|ai_provider_auth|ai_model_not_found/i.test(code)) return 'onboarding.import.unavailable';
  if (/rate_limit|ai_temporarily|ai_provider_unreachable/i.test(code)) return 'onboarding.error.busy';
  if (importing && error?.response?.status >= 500) return 'onboarding.import.unavailable';
  return importing ? 'onboarding.import.error' : 'onboarding.error.generic';
}

export function hasPlaceholderName(name, email = '') {
  const value = String(name || '').trim();
  return !value || /^b\d{6,}$/i.test(value) || value.toLowerCase() === email.split('@')[0].toLowerCase();
}
