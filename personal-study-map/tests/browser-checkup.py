"""Chromium/WebKit regression for authenticated quiz-v2, using isolated data.

The mock owns schedules; browsers send answer events and metadata, never
replacement progress. No production requests or user data.
"""
import copy
import datetime
import functools
import http.server
import json
import os
import threading
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

P = 'personal-study-map:quiz-card-progress:v1'
H = 'personal-study-map:quiz-session-history:v1'
A = 'personal-study-map:account-session:v2'
M = 'personal-study-map:account-enabled:v2'
OUTBOX = 'personal-study-map:account-outbox:v2'
META = 'personal-study-map:account-meta-outbox:v2'
QUEUE = 'personal-study-map:server-queue:v2'
TOKEN = 'a' * 64
FIXTURE = {'updatedAt': '2026-10-20', 'sessions': [], 'semesters': [
    {'id': 'qa-semester', 'title': 'QA', 'exams': [
        {'id': 'qa-exam', 'title': 'Checkup', 'topics': [], 'relations': [], 'skills': [
            {'id': 'qa-skill', 'title': 'Checkup skill', 'topicId': 'all', 'mastery': 0,
             'flashcards': [{'id': 'qa-one', 'question': 'One plus one?', 'answer': '2'},
                           {'id': 'qa-two', 'question': 'Two plus two?', 'answer': '4'}]}]}]}]}
server = http.server.ThreadingHTTPServer(
    ('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory='personal-study-map'))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = 'http://127.0.0.1:' + str(server.server_port) + '/'


def plus_days(day, count):
    return (datetime.date.fromisoformat(day) + datetime.timedelta(days=count)).isoformat()


def run(browser, label):
    cloud = {'snapshot': {'progress': {}, 'invalid': {}, 'deleted': {}, 'overrides': {}, 'custom': []}, 'sessions': []}
    calls = {'writes': 0, 'reads': 0, 'legacy': 0, 'fail': False, 'bad_ack': False}
    accepted_events = set()
    device_days = {'desktop': '2026-10-20', 'phone': '2026-10-21'}
    errors = []

    def handler(device):
        def api(route):
            req = route.request
            path = urlparse(req.url).path
            headers = {'access-control-allow-origin': req.headers.get('origin', '*'),
                       'access-control-allow-methods': 'GET,POST,OPTIONS',
                       'access-control-allow-headers': 'authorization,content-type',
                       'access-control-max-age': '600'}

            def reply(payload, status=200):
                route.fulfill(headers=headers, status=status, content_type='application/json', body=json.dumps(payload))

            if req.method == 'OPTIONS':
                route.fulfill(headers=headers, status=204)
                return
            if path == '/api/study-sessions':
                reply({'sessions': [], 'nextCursor': None})
                return
            if path == '/api/quiz-sync':
                calls['legacy'] += 1
                reply({'error': 'The v2 regression must not use legacy sync'}, 400)
                return
            if not path.startswith('/api/quiz-v2/'):
                reply([])
                return
            assert req.headers.get('authorization') == 'Bearer ' + TOKEN
            if calls['fail']:
                reply({'error': 'Injected temporary outage'}, 503)
                return
            day = device_days[device]
            if path == '/api/quiz-v2/state':
                calls['reads'] += 1
                reply(copy.deepcopy(cloud))
            elif path == '/api/quiz-v2/queue':
                ids = req.post_data_json['cardIds']
                progress = cloud['snapshot']['progress']
                reply({'serverDay': day,
                       'newCards': [card for card in ids if card not in progress],
                       'due': [card for card in ids if card in progress and progress[card]['dueDate'] <= day],
                       'upcomingTomorrow': [card for card in ids if card in progress and progress[card]['dueDate'] <= plus_days(day, 1)],
                       'trackedCount': len(progress)})
            elif path == '/api/quiz-v2/answer':
                calls['writes'] += 1
                body = req.post_data_json
                previous = cloud['snapshot']['progress'].get(body['cardId'], {})
                duplicate = body['eventId'] in accepted_events
                if not duplicate:
                    accepted_events.add(body['eventId'])
                    # Fixtures run at daytime UTC, which is also the Berlin date.
                    answered_day = body['occurredAt'][:10]
                    assert not previous.get('dueDate') or previous['dueDate'] <= answered_day
                    stage = min(6, previous.get('repetitionNumber', 0) + 1) if body['correct'] else 0
                    delay = [1, 2, 3, 7, 14, 30][min(5, max(1, stage))] if body['correct'] else 1
                    cloud['snapshot']['progress'][body['cardId']] = {
                        'repetitionNumber': stage, 'dueDate': plus_days(answered_day, delay),
                        'status': 'ACTIVE' if body['correct'] else 'RESET', 'scheduleVersion': 2,
                        'lastCorrect': body['correct'], 'updatedAt': body['occurredAt']}
                reply({'accepted': False, 'duplicate': False} if calls['bad_ack'] else {
                    'accepted': not duplicate, 'duplicate': duplicate,
                    'state': cloud['snapshot']['progress'][body['cardId']]})
            elif path == '/api/quiz-v2/sync':
                calls['writes'] += 1
                body = req.post_data_json
                assert 'progress' not in body, 'Account sync must not upload browser schedules'
                for key in ('invalid', 'deleted', 'overrides', 'custom'):
                    if key in body:
                        cloud['snapshot'][key] = copy.deepcopy(body[key])
                sessions = {row['id']: row for row in cloud['sessions']}
                sessions.update({row['id']: copy.deepcopy(row) for row in body.get('sessions', [])})
                cloud['sessions'] = list(sessions.values())
                reply({'ok': True})
            else:
                raise AssertionError('Unexpected quiz-v2 endpoint: ' + path)
        return api

    def new_device(device, viewport, moment):
        context = browser.new_context(timezone_id='Europe/Berlin', viewport=viewport, service_workers='block')
        context.add_init_script('localStorage.setItem(' + json.dumps(A) + ',' + json.dumps(TOKEN) + ');'
                                'localStorage.setItem(' + json.dumps(M) + ',"true");')
        context.route('https://personal-life-api-production.up.railway.app/**', handler(device))
        context.route('**/data/study.json*', lambda route: route.fulfill(content_type='application/json', body=json.dumps(FIXTURE)))
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(device + ': ' + str(error)))
        page.clock.set_fixed_time(moment)
        page.goto(url)
        page.wait_for_function('window.studyBoardCards?.allExams?.().length>0 && window.CardQuizEngine')
        page.wait_for_function('(key)=>JSON.parse(localStorage.getItem(key)||"null")?.newCards?.length!==undefined', arg=QUEUE)
        return context, page

    def settled(page):
        page.wait_for_function('([outbox,meta])=>!JSON.parse(localStorage.getItem(outbox)||"[]").length && !localStorage.getItem(meta)',
                               arg=[OUTBOX, META], timeout=20000)

    context, page = new_device('desktop', {'width': 1440, 'height': 1000}, '2026-10-20T12:00:00Z')
    other = None
    try:
        page.locator('#flashcard-toggle').click(force=True)
        page.wait_for_selector('[data-action="new-cards"]')
        assert page.locator('[data-action="sync-now"]').count() == 0, 'Synchronization is automatic'
        assert 'Модуль карточек не запустился' not in page.locator('#flashcard-app').inner_text()
        page.locator('[data-action="new-cards"]').click()
        page.locator('[data-action="quick-known"]').click()
        page.locator('[data-action="quick-unknown"]').click()
        settled(page)
        saved = page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', P)
        assert saved['qa-one']['dueDate'] == '2026-10-22', saved
        assert saved['qa-two']['dueDate'] == '2026-10-21', saved
        assert cloud['snapshot']['progress'] == saved
        assert len(cloud['sessions']) == 1 and cloud['sessions'][0]['correctFirstTry'] == 1
        assert page.locator('#overall-readiness').inner_text() == '50%'
        writes = calls['writes']
        page.wait_for_timeout(1800)
        assert calls['writes'] == writes, ('upload loop', calls)
        print('PASS ' + label + ' authenticated boot, automatic answer/history save, first-attempt scoring and mastery', flush=True)

        other, phone = new_device('phone', {'width': 390, 'height': 844}, '2026-10-21T07:00:00Z')
        phone.wait_for_function('(key)=>Object.keys(JSON.parse(localStorage.getItem(key)||"{}")).length===2', arg=P)
        phone.locator('#flashcard-toggle').click(force=True)
        assert phone.locator('#flashcard-count').inner_text() == '1'
        phone.locator('[data-action="scheduled"]').click()
        assert 'Two plus two?' in phone.locator('.quiz-question').inner_text()
        calls['fail'] = True
        phone.locator('[data-action="quick-known"]').click()
        phone.wait_for_function('(key)=>JSON.parse(localStorage.getItem(key)||"[]").length===1', arg=OUTBOX)
        offline = phone.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', P)
        phone.reload()
        phone.wait_for_function('window.CardQuizEngine')
        assert phone.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', P) == offline
        calls['fail'] = False
        phone.evaluate("window.dispatchEvent(new Event('online'))")
        settled(phone)
        assert cloud['snapshot']['progress']['qa-two']['dueDate'] == '2026-10-23'
        page.evaluate("window.dispatchEvent(new Event('online'))")
        page.wait_for_function('(key)=>JSON.parse(localStorage.getItem(key))["qa-two"].dueDate==="2026-10-23"', arg=P)
        assert page.locator('#overall-readiness').inner_text() == '100%'
        print('PASS ' + label + ' second device/server queue, offline reload, reconnect and stale-tab recovery', flush=True)

        page.locator('[data-action="home"]').first.click()
        before = page.evaluate('(key)=>localStorage.getItem(key)', P)
        answers = len(accepted_events)
        page.locator('[data-action="practice"]').click()
        page.locator('[data-action="quick-known"]').click()
        page.locator('[data-action="quick-known"]').click()
        settled(page)
        assert page.evaluate('(key)=>localStorage.getItem(key)', P) == before
        assert len(accepted_events) == answers, 'Practice must not send scheduled-review events'
        assert page.locator('#overall-readiness').inner_text() == '100%'

        # Browser-edited schedules cannot overwrite canonical server dates.
        page.evaluate("""(key)=>{const states=JSON.parse(localStorage.getItem(key));states['qa-one'].dueDate='2099-01-01';localStorage.setItem(key,JSON.stringify(states));window.dispatchEvent(new Event('study-reviews-updated'));}""", P)
        page.wait_for_function('(key)=>JSON.parse(localStorage.getItem(key))["qa-one"].dueDate==="2026-10-22"', arg=P)
        settled(page)
        assert cloud['snapshot']['progress']['qa-one']['dueDate'] == '2026-10-22'
        print('PASS ' + label + ' practice leaves schedule/mastery unchanged; server state repairs browser edits', flush=True)

        # HTTP 200 without accepted/duplicate acknowledgement is not a save.
        device_days['desktop'] = '2026-10-22'
        page.clock.set_fixed_time('2026-10-22T09:00:00Z')
        page.evaluate("window.dispatchEvent(new Event('online'))")
        page.wait_for_function('(key)=>JSON.parse(localStorage.getItem(key)).due.includes("qa-one")', arg=QUEUE)
        page.locator('[data-action="home"]').first.click()
        page.locator('[data-action="scheduled"]').click()
        calls['bad_ack'] = True
        page.locator('[data-action="quick-known"]').click()
        page.wait_for_function('(key)=>JSON.parse(localStorage.getItem(key)||"[]").length===1', arg=OUTBOX)
        page.wait_for_timeout(250)
        assert page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))["qa-one"].dueDate', P) == '2026-10-25'
        calls['bad_ack'] = False
        page.evaluate("window.dispatchEvent(new Event('online'))")
        settled(page)
        assert cloud['snapshot']['progress']['qa-one']['dueDate'] == '2026-10-25'
        assert cloud['snapshot']['progress']['qa-one']['repetitionNumber'] == 2, 'Idempotent retry must not advance twice'
        assert calls['legacy'] == 0
        assert not errors, errors
        print('PASS ' + label + ' negative 200 acknowledgement stays pending; idempotent retry recovers; no JS errors', flush=True)
    finally:
        context.close()
        if other:
            other.close()


try:
    with sync_playwright() as p:
        for kind in ('chromium', 'webkit'):
            options = {'channel': os.environ['PLAYWRIGHT_CHROMIUM_CHANNEL']} if kind == 'chromium' and os.environ.get('PLAYWRIGHT_CHROMIUM_CHANNEL') else {}
            browser = getattr(p, kind).launch(**options)
            try:
                run(browser, kind)
            finally:
                browser.close()
    print('BROWSER_CHECKUP_PASS', flush=True)
finally:
    server.shutdown()
