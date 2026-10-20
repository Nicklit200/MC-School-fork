"""Real Chromium and WebKit UI tests with an isolated mock API, never user data."""
import json, copy, threading, functools, http.server
from playwright.sync_api import sync_playwright
P='personal-study-map:quiz-card-progress:v1'
H='personal-study-map:quiz-session-history:v1'
O='personal-study-map:owner-token:v1'
Q='personal-study-map:pending-sync:v1'
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory='personal-study-map'))
threading.Thread(target=server.serve_forever,daemon=True).start()
url='http://127.0.0.1:'+str(server.server_port)+'/'

def run(browser,label):
    cloud={'snapshot':{'progress':{},'invalid':{},'deleted':{},'overrides':{},'custom':[]},'sessions':[]}
    calls={'post':0,'get':0,'fail':False,'bad_readback':False,'corrupt_next':False}
    def api(route):
        req=route.request
        cors_headers={'access-control-allow-origin':req.headers.get('origin','*'),'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'authorization,content-type','access-control-max-age':'600'}
        if '/api/quiz-sync' not in req.url:
            route.fulfill(headers=cors_headers,status=200,content_type='application/json',body='[]');return
        if req.method=='OPTIONS':route.fulfill(headers=cors_headers,status=204);return
        if calls['fail']:route.fulfill(headers=cors_headers,status=503,body='unavailable');return
        if req.method=='POST':
            calls['post']+=1
            body=req.post_data_json
            for k in ('invalid','deleted','overrides','custom'):
                if k in body:cloud['snapshot'][k]=copy.deepcopy(body[k])
            for k,v in body.get('progress',{}).items():
                old=cloud['snapshot']['progress'].get(k)
                if old is None or (v.get('updatedAt',''),v.get('scheduleVersion',0))>(old.get('updatedAt',''),old.get('scheduleVersion',0)):
                    cloud['snapshot']['progress'][k]=copy.deepcopy(v)
            sessions={x['id']:x for x in cloud['sessions']}
            for x in body.get('sessions',[]):
                if x.get('id'):sessions[x['id']]=copy.deepcopy(x)
            cloud['sessions']=list(sessions.values())
            calls['corrupt_next']=calls['bad_readback']
            route.fulfill(headers=cors_headers,status=200,content_type='application/json',body=json.dumps({'ok':True}));return
        calls['get']+=1
        payload=copy.deepcopy(cloud)
        if calls['corrupt_next']:
            for v in payload['snapshot']['progress'].values():v['dueDate']='2099-01-01'
            calls['corrupt_next']=False
        route.fulfill(headers=cors_headers,status=200,content_type='application/json',body=json.dumps(payload))
    context=browser.new_context(timezone_id='Europe/Berlin',viewport={'width':1440,'height':1000},service_workers='block')
    context.route('https://personal-life-api-production.up.railway.app/**',api)
    page=context.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.clock.set_fixed_time('2026-10-20T12:00:00Z')
    page.goto(url);page.wait_for_function('window.studyBoardCards?.allExams?.().length>0 && window.CardQuizEngine')
    page.locator('#flashcard-toggle').click(force=True)
    page.wait_for_selector('[data-action="sync-now"]',state='attached')
    assert 'Модуль карточек не запустился' not in page.locator('#flashcard-app').inner_text()
    page.locator('#close-flashcards').click(force=True)
    fixture="""(()=>{const skills=[{id:'qa-skill',title:'Checkup',topicId:'all',flashcards:[{id:'qa-one',question:'One plus one?',answer:'2'},{id:'qa-two',question:'Two plus two?',answer:'4'}]}];const exam={id:'qa-exam',title:'Checkup',skills};window.studyBoardCards={context:()=>({exam,semesterId:'qa-semester',topicId:'all'}),allExams:()=>[exam],learningSessions:()=>[]};window.dispatchEvent(new Event('study-context-updated'));})()"""
    page.evaluate(fixture);page.locator('#flashcard-toggle').click(force=True)
    page.locator('[data-action="new-cards"]').click()
    page.locator('[data-action="quick-known"]').click();page.locator('[data-action="quick-unknown"]').click()
    page.wait_for_function('(key)=>localStorage.getItem(key)===null',arg=Q,timeout=20000)
    saved=page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))',P)
    assert saved['qa-one']['dueDate']=='2026-10-22',saved
    assert saved['qa-two']['dueDate']=='2026-10-21',saved
    assert cloud['snapshot']['progress']==saved
    assert len(cloud['sessions'])==1 and cloud['sessions'][0]['correctFirstTry']==1
    assert not errors,errors
    print('PASS '+label+' boot, button, correct/error answers, automatic field+history readback',flush=True)
    posts=calls['post'];page.wait_for_timeout(1800);assert calls['post']==posts,('upload loop',calls)
    key=page.evaluate('(key)=>localStorage.getItem(key)',O)
    other=browser.new_context(timezone_id='Europe/Berlin',viewport={'width':390,'height':844},service_workers='block')
    other.route('https://personal-life-api-production.up.railway.app/**',api)
    other.add_init_script('localStorage.setItem('+json.dumps(O)+','+json.dumps(key)+');')
    phone=other.new_page();phone.on('pageerror',lambda e: print('EXPECTED injected network interruption:',str(e),flush=True) if calls.get('fault_window') and '/api/quiz-sync' in str(e) and 'access control checks' in str(e) else errors.append('phone: '+str(e)));phone.clock.set_fixed_time('2026-10-21T07:00:00Z');phone.goto(url)
    phone.wait_for_function('window.studyBoardCards?.allExams?.().length>0 && window.CardQuizEngine')
    phone.wait_for_function('(key)=>Object.keys(JSON.parse(localStorage.getItem(key)||"{}")).length===2',arg=P,timeout=20000)
    phone.evaluate(fixture);phone.locator('#flashcard-toggle').click(timeout=10000)
    assert phone.locator('#flashcard-count').inner_text()=='1'
    phone.locator('[data-action="scheduled"]').click()
    assert 'qa-two' in phone.locator('.quiz-question').inner_text()
    print('PASS '+label+' fresh second device: tomorrow only error is due, stable ID retained',flush=True)
    calls['fault_window']=True;calls['fail']=True;phone.locator('[data-action="quick-known"]').click();phone.wait_for_timeout(200)
    assert phone.evaluate('(key)=>localStorage.getItem(key)',Q)
    offline=phone.evaluate('(key)=>JSON.parse(localStorage.getItem(key))',P)
    phone.reload();phone.wait_for_function('window.CardQuizEngine')
    assert phone.evaluate('(key)=>JSON.parse(localStorage.getItem(key))',P)==offline
    calls['fail']=False;phone.evaluate("window.dispatchEvent(new Event('online'))")
    phone.wait_for_function('(key)=>localStorage.getItem(key)===null',arg=Q,timeout=20000)
    assert cloud['snapshot']['progress']['qa-two']['dueDate']=='2026-10-23'
    page.evaluate("window.dispatchEvent(new Event('online'))")
    page.wait_for_function('(key)=>JSON.parse(localStorage.getItem(key))["qa-two"].dueDate==="2026-10-23"',arg=P,timeout=20000)
    print('PASS '+label+' offline/reload/reconnect and stale-tab synchronization',flush=True)
    calls['fault_window']=False
    page.evaluate(fixture);page.locator('[data-action="home"]').first.click()
    before=page.evaluate('(key)=>localStorage.getItem(key)',P)
    page.locator('[data-action="practice"]').click()
    page.locator('[data-action="quick-known"]').click();page.locator('[data-action="quick-known"]').click()
    assert page.evaluate('(key)=>localStorage.getItem(key)',P)==before
    page.wait_for_function('(key)=>localStorage.getItem(key)===null',arg=Q,timeout=20000)
    assert not errors,errors
    print('PASS '+label+' free practice, no schedule advancement, no JavaScript exceptions',flush=True)
    # A 200 response containing the wrong due date is not a successful save.
    calls['bad_readback']=True
    page.evaluate("""(key)=>{const states=JSON.parse(localStorage.getItem(key));states['qa-one']={...states['qa-one'],updatedAt:'2026-10-21T09:00:00.000Z',dueDate:'2026-10-24',repetitionNumber:2};localStorage.setItem(key,JSON.stringify(states));window.dispatchEvent(new Event('study-reviews-updated'));}""",P)
    page.wait_for_timeout(2300)
    assert page.evaluate('(key)=>!!localStorage.getItem(key)',Q)
    assert page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))["qa-one"].dueDate',P)=='2026-10-24'
    calls['bad_readback']=False;calls['corrupt_next']=False
    page.evaluate("window.dispatchEvent(new Event('online'))")
    page.wait_for_function('(key)=>localStorage.getItem(key)===null',arg=Q,timeout=20000)
    print('PASS '+label+' incorrect server readback stays pending, retry recovers',flush=True)
    context.close();other.close()

try:
    with sync_playwright() as p:
        for kind in ('chromium','webkit'):
            browser=getattr(p,kind).launch()
            try:run(browser,kind)
            finally:browser.close()
    print('BROWSER_CHECKUP_PASS',flush=True)
finally:server.shutdown()
