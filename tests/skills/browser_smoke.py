"""Local API fixture and browser tests. No production credentials or pupil data."""
import copy,json,os,re,threading,unittest
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
SEED=json.loads((ROOT/'backend/src/main/resources/db/migration/V65__add_skill_boards.sql').read_text().split('$seed$')[1])
STATE={'id':'grade-6','revision':1,'updatedAt':'2026-10-04T12:00:00Z','data':copy.deepcopy(SEED)}
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT/'frontend/public'),**kw)
    def log_message(self,*a):pass
    def json(self,data,status=200):
        payload=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(payload)
    def do_GET(self):
        if self.path.startswith('/fixture'):
            readonly='readonly' in self.path
            body=f'''<!doctype html><html><body style="margin:0"><iframe id="board" src="/skills-board/index.html" style="width:100vw;height:100vh;border:0" onload="this.contentWindow.postMessage({{type:'mindcrafti-skills-config',apiBase:location.origin+'/api/v1',token:'test-only',canEdit:{str(not readonly).lower()},userId:'fixture'}},location.origin)"></iframe></body></html>'''.encode()
            self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.end_headers();self.wfile.write(body);return
        if self.path=='/api/v1/skill-boards/grade-6':
            if self.headers.get('Authorization')!='Bearer test-only':self.json({},401)
            else:self.json(STATE)
            return
        super().do_GET()
    def do_PUT(self):
        if self.headers.get('Authorization')!='Bearer test-only':self.json({},401);return
        incoming=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if incoming['expectedRevision']!=STATE['revision']:self.json({'message':'Conflict'},409);return
        STATE['data']=incoming['data'];STATE['revision']+=1;self.json(STATE)
class BrowserSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        threading.Thread(target=cls.server.serve_forever,daemon=True).start()
        cls.base=f'http://127.0.0.1:{cls.server.server_port}'
        cls.pw=sync_playwright().start();opts={'headless':True}
        if os.path.exists('/usr/bin/chromium'):opts.update(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        cls.browser=cls.pw.chromium.launch(**opts)
    @classmethod
    def tearDownClass(cls):cls.browser.close();cls.pw.stop();cls.server.shutdown();cls.server.server_close()
    def setUp(self):
        STATE.update(revision=1,data=copy.deepcopy(SEED))
        self.context=self.browser.new_context(viewport={'width':1500,'height':1000})
        self.page=self.context.new_page();self.errors=[]
        self.page.on('pageerror',lambda e:self.errors.append(str(e)))
        self.page.on('dialog',lambda d:d.accept())
        self.page.goto(self.base+'/fixture');self.frame=self.page.frame_locator('#board')
        self.frame.locator('#count').filter(has_text='61').wait_for()
    def tearDown(self):self.context.close()
    def fractions(self):self.frame.locator('#sections').get_by_role('button',name=re.compile('Обыкновенные')).click()
    def test_edit_connect_archive_save_reload(self):
        self.page.screenshot(path=str(ROOT/'skills-overview.png'))
        self.fractions();self.frame.locator('#add').click()
        self.frame.locator('#field-title').fill('Проверочный навык')
        self.frame.locator('#field-description').fill('Объясняет способ решения')
        self.frame.locator(".node[data-id='skill-7-1']").click()
        self.assertEqual(self.frame.locator('.node').filter(has_text='Проверочный навык').count(),1)
        created=self.frame.locator('.node').filter(has_text='Проверочный навык').get_attribute('data-id')
        self.frame.locator('#connect').click()
        self.frame.locator(".node[data-id='skill-7-1']").click()
        self.frame.locator(f".node[data-id='{created}']").click()
        self.frame.locator('#save').click();self.frame.locator('#save-state').filter(has_text='версия 2').wait_for()
        self.assertTrue(any(e['source']=='skill-7-1' and e['target']==created and e['kind']=='prerequisite' for e in STATE['data']['edges']))
        self.page.reload();self.frame.locator('#save-state').filter(has_text='версия 2').wait_for();self.fractions()
        self.frame.locator('#search').fill('Проверочный навык')
        self.frame.locator('#results').get_by_role('button',name='Проверочный навык').click()
        self.frame.get_by_role('button',name='В архив',exact=True).click()
        self.assertEqual(self.frame.locator('#archive-count').inner_text(),'1')
        self.frame.locator('#undo').click();self.assertEqual(self.frame.locator('#archive-count').inner_text(),'0')
        self.frame.locator('#save').click();self.frame.locator('#save-state').filter(has_text='версия 3').wait_for()
        self.assertFalse(self.errors,self.errors)
    def test_drag_and_zoom_and_conflict(self):
        self.fractions();self.frame.locator('#fit').click()
        card=self.frame.locator(".node[data-id='skill-7-1']");box=card.bounding_box()
        old=card.evaluate('(el)=>parseFloat(el.style.left)')
        self.page.mouse.move(box['x']+60,box['y']+45);self.page.mouse.down()
        self.page.mouse.move(box['x']+110,box['y']+85,steps=5);self.page.mouse.up()
        self.assertNotEqual(card.evaluate('(el)=>parseFloat(el.style.left)'),old)
        oldzoom=self.frame.locator('#zoom').inner_text();self.frame.locator('#zoom-in').click()
        self.assertNotEqual(self.frame.locator('#zoom').inner_text(),oldzoom)
        STATE['revision']=2;self.frame.locator('#save').click()
        self.frame.locator('#notice').filter(has_text='другой вкладке').wait_for()
        self.assertEqual(STATE['revision'],2);self.assertFalse(self.errors,self.errors)
    def test_teacher_readonly(self):
        self.page.goto(self.base+'/fixture?readonly');self.frame.locator('#count').filter(has_text='61').wait_for()
        self.assertTrue(self.frame.locator('#add').is_disabled());self.assertTrue(self.frame.locator('#save').is_disabled())
        self.fractions();self.frame.locator(".node[data-id='skill-7-1']").click()
        self.assertTrue(self.frame.locator('#field-title').is_disabled());self.assertFalse(self.errors,self.errors)
if __name__=='__main__':unittest.main()
