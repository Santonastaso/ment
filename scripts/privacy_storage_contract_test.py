#!/usr/bin/env python3
"""Real Storage/consent contract on the disposable local Supabase stack only."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid


def run():
    base = os.environ.get('SUPABASE_URL', '').rstrip('/')
    parsed = urllib.parse.urlsplit(base)
    if (os.environ.get('PRIVACY_LOCAL_CONTRACT') != 'true'
            or parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1')
            or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
        raise RuntimeError('local_stack_required')
    anon = os.environ['SUPABASE_ANON_KEY']
    service = os.environ['SUPABASE_SERVICE_ROLE_KEY']

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    opener = urllib.request.build_opener(NoRedirect())

    def api(path, token, body=None, method='POST', raw=False):
        payload = body if raw else json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(base + path, data=payload, method=method, headers={
            'apikey': service if token == service else anon,
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/pdf' if raw else 'application/json',
            'Prefer': 'return=representation',
        })
        try:
            with opener.open(request, timeout=20) as response:
                data = response.read()
                return response.status, json.loads(data) if data else None
        except urllib.error.HTTPError as error:
            try:
                data = json.loads(error.read())
            except (ValueError, UnicodeDecodeError):
                data = None
            return error.code, data

    def ok(result):
        assert 200 <= result[0] < 300, 'local_contract_request_failed'
        return result[1]

    login = ok(api('/auth/v1/token?grant_type=password', anon, {
        'email': os.environ['MENT_EMP_EMAIL'], 'password': os.environ['MENT_EMP_PASSWORD']}))
    token, user_id = login['access_token'], str(uuid.UUID(login['user']['id']))
    marker = 'privacy-contract-' + str(uuid.uuid4())
    paths = [user_id + '/' + marker + '-' + str(index) + '.pdf' for index in range(3)]

    def consent():
        return ok(api('/rest/v1/rpc/record_consent', token, {
            'p_purpose': 'ai_profile_import', 'p_text_version': 'local-contract-v1', 'p_locale': 'en'}))

    def upload(path):
        return api('/storage/v1/object/profile-uploads/' + path, token, b'%PDF-1.4\n% synthetic\n%%EOF', raw=True)

    def exists(path):
        files = ok(api('/storage/v1/object/list/profile-uploads', service, {
            'prefix': user_id, 'search': path.rsplit('/', 1)[1], 'limit': 100, 'offset': 0}))
        return any(row.get('id') and row['name'] == path.rsplit('/', 1)[1] for row in files)

    try:
        consent()
        ok(upload(paths[0]))
        draft = ok(api('/rest/v1/profile_drafts', service, {
            'user_id': user_id, 'source': 'cv', 'raw_text': marker, 'proposed_json': {}}))[0]
        exported = ok(api('/rest/v1/rpc/export_my_data', token, {}))
        assert exported['format'] == 'ment-export-2' and exported['profile']['id'] == user_id
        ok(api('/rest/v1/rpc/withdraw_cv_import_consent', token, {}))
        assert upload(paths[1])[0] in (400, 401, 403, 409, 500) and not exists(paths[1])
        rejected = api('/rest/v1/profile_drafts', service, {
            'user_id': user_id, 'source': 'cv', 'proposed_json': {}})
        assert rejected[0] >= 400 and rejected[1].get('message') == 'cv_consent_required'
        assert not ok(api('/rest/v1/profile_drafts?id=eq.' + str(draft['id']) + '&select=id', service, method='GET'))
        # Actual Storage deletion must work even after the metadata guard rejects writes.
        ok(api('/storage/v1/object/profile-uploads', service, {'prefixes': [paths[0]]}, method='DELETE'))
        assert not exists(paths[0])
        consent()
        ok(upload(paths[2]))
        assert exists(paths[2])
    finally:
        # Exact newly generated paths only. Never scan/delete another account's files.
        ok(api('/storage/v1/object/profile-uploads', service, {'prefixes': paths}, method='DELETE'))
        ok(api('/rest/v1/rpc/withdraw_cv_import_consent', token, {}))
    print('PASS local privacy export, consent and Storage contracts')


if __name__ == '__main__':
    try:
        run()
    except Exception:
        # Keep passwords, tokens, IDs, URLs and response bodies out of CI logs.
        print('FAIL local privacy Storage contract; inspect disposable local fixture')
        raise SystemExit(1)
