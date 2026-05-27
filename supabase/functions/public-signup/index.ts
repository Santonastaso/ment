// Public org self-signup.
//
// Body: { company_name: string, admin_name: string, admin_email: string,
//         admin_password: string, org_type?: 'intra'|'inter', slug?: string }
// Returns: { organization: { id, name, slug, type }, user: { id, email } }
//
// Anyone on the internet can hit this. We rate-limit by IP at the edge
// (not implemented here — left to platform-level WAF / Supabase rate
// limits). We DO enforce:
//   * email format
//   * password length >= 8
//   * slug uniqueness
//   * company name presence
// And we always commit org + user atomically.

import {
  corsHeaders,
  jsonError,
  jsonOk,
  adminClient,
} from '../_shared/index.ts';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `org-${Math.random().toString(36).slice(2, 8)}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);

  const body = await req.json().catch(() => ({}));
  const companyName = (body.company_name || '').toString().trim();
  const adminName = (body.admin_name || '').toString().trim();
  const adminEmail = (body.admin_email || '').toString().trim().toLowerCase();
  const adminPassword = (body.admin_password || '').toString();
  const orgType = body.org_type === 'intra' || body.org_type === 'inter' ? body.org_type : 'inter';

  if (!companyName) return jsonError('company_name_required');
  if (companyName.length > 80) return jsonError('company_name_too_long');
  if (!adminName) return jsonError('admin_name_required');
  if (!EMAIL_RE.test(adminEmail)) return jsonError('admin_email_invalid');
  if (!adminPassword || adminPassword.length < 8) return jsonError('password_too_short');
  if (adminPassword.length > 200) return jsonError('password_too_long');

  const sb = adminClient();

  // Slug: prefer caller-supplied (slugified) else derived from company name.
  // Ensure uniqueness by appending a small random suffix if it collides.
  let baseSlug = slugify(body.slug || companyName);
  let slug = baseSlug;
  for (let i = 0; i < 5; i++) {
    const { data: existing } = await sb
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  // Refuse if the email already exists in auth.users to avoid hijacking.
  const { data: existingUser } = await sb.auth.admin.listUsers();
  const collide = (existingUser?.users || []).find((u: { email?: string }) =>
    (u.email || '').toLowerCase() === adminEmail
  );
  if (collide) return jsonError('email_taken', 409);

  // Create the organization first so the new auth-user trigger can attach
  // the right organization_id from the user metadata.
  const { data: org, error: orgErr } = await sb
    .from('organizations')
    .insert({ name: companyName, slug, type: orgType })
    .select('id, name, slug, type')
    .single();
  if (orgErr) return jsonError(`org_create_failed: ${orgErr.message}`, 500);

  // Provision the admin auth user. `handle_new_user` will create the
  // matching profile row using the metadata we pass.
  const { data: created, error: userErr } = await sb.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: {
      name: adminName,
      is_admin: true,
      organization_id: org.id,
      onboarding_complete: true,
      must_change_password: false,
      department: '',
      seniority: 'lead',
      job_title: '',
    },
  });

  if (userErr || !created.user) {
    // Roll back the org row so we don't leave half-state.
    await sb.from('organizations').delete().eq('id', org.id);
    return jsonError(`user_create_failed: ${userErr?.message ?? 'unknown'}`, 500);
  }

  // Belt-and-suspenders: ensure the profile points at the new org and is
  // marked as an org admin. The trigger should have done this from metadata,
  // but we update explicitly so the row is consistent regardless of the
  // metadata defaults applied by handle_new_user.
  await sb
    .from('profiles')
    .update({
      organization_id: org.id,
      is_admin: true,
      admin_scope: 'org',
      onboarding_complete: true,
      must_change_password: false,
    })
    .eq('id', created.user.id);

  return jsonOk({
    organization: org,
    user: { id: created.user.id, email: created.user.email },
  }, 201);
});
