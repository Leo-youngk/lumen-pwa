import json
from pathlib import Path

client = Path('base/index-CnP54MM8.js').read_text()

def replace(old, new, count=1):
    global client
    assert client.count(old) == count, (client.count(old), old)
    client = client.replace(old, new)

client = """import { uploadEpub, downloadBook, bookContext, loadModelList, recordUsage, subscribeUsage, usageSnapshot, tokenLabel } from './lumen-features-v56.js';\n""" + client

# Attach book contents to the same local IndexedDB records used by older sessions.
replace('let t=await Xe(e,e=>O(e));await at(t);', 'const originatingId = ie.current.id; let t=await uploadEpub(e); if (ie.current.id !== originatingId) return; await at(t); if (ie.current.id !== originatingId) { Be(); return; }')
replace('charCount:t.charCount,chapterCount:t.chapterCount},updatedAt:', 'charCount:t.charCount,chapterCount:t.chapterCount,markdown:t.markdown,unreadable:t.unreadable},updatedAt:')
replace('He(`已添加《${t.title}》，可以开始提问了`),it(t.id,n.model)', 'He(t.unreadable ? `已转换 ${t.chapterCount} 章，另有 ${t.unreadable} 节无法提取正文` : `已转 Markdown · ${t.chapterCount} 章`)')
start = client.index('async function vf(e,t,n,r,i,a)')
end = client.index('function yf(){let[e,t]', start)
client = client[:start] + """
async function vf(book, question, model, api, knownContext, maxOutput, history, signal, progress) {
  const [meta, stored] = await Promise.all([ot(book.id), st(book.id)]);
  if (!meta || !stored?.chapters.length) throw new Error(`《${book.title}》的正文不在这台设备上，请重新上传 EPUB。`);
  return bookContext({
    meta, chapters: stored.chapters, focus: book.focusChapter, question, history,
    knownContext, maxOutput, signal, progress,
    callModel: (question, options, signal) => Ae(question, model, { ...options, api }, signal),
  });
}
""" + client[end:]
start = client.index('if(c.book){let e=await vf(')
end = client.index('await je(o,c.model', start)
client = client[:start] + """
if (c.book) {
  const context = await vf(c.book, r, c.model, Pe, e, t, o.map(message => message.content + (message.reasoning || '')).join('\\n'), _.signal, A);
  s = context.system;
}
A(null);
""" + client[end:]
replace('let v=!1,y=(e=!1)=>{let t=', 'let v=!1,y=(e=!1)=>{A(null);let t=')
replace('if(!r||C||Ie!==`authenticated`)return', 'if(!r||C||T||Ie!==`authenticated`)return')
replace('k&&k.total>0?`正在建立目录索引 ${k.done}/${k.total} 章…`', 'k&&k.total>0?(k.stage===`merge`?`正在汇总 ${k.done}/${k.total}…`:k.stage===`direct`?`正在发送完整正文…`:`正在读原文 ${k.done}/${k.total} 段…`)')

# Capture provider-reported usage for the chat and its background requests.
replace('let c=s.body.getReader(),l=new TextDecoder,u=``', 'let providerUsage=null, completed=false;let c=s.body.getReader(),l=new TextDecoder,u=``')
replace('if(r.type===`text`&&r.text&&f.push(r.text)', 'if(r.type===`usage`)providerUsage=r;if(r.type===`done`)completed=true;if(r.type===`text`&&r.text&&f.push(r.text)')
replace('}finally{c.releaseLock()}await f.flush()', '}finally{c.releaseLock();recordUsage(providerUsage)}if(!completed)throw Error(`连接中断，回答未完整返回。请重试。`);await f.flush()')

# Reload whenever the selected provider or stored connection changes.
replace('[u,d]=(0,f.useState)(he),[p,m]', '[u,d]=(0,f.useState)(he),[modelStatus,setModelStatus]=f.useState(`loading`),[modelRefresh,setModelRefresh]=f.useState(0),[p,m]')
start = client.index('(0,f.useEffect)(()=>{Ie===`authenticated`&&fetch(`/api/models`')
end = client.index('(0,f.useEffect)', start + len('(0,f.useEffect)'))
client = client[:start] + """
f.useEffect(() => {
  if (Ie !== 'authenticated') return;
  const controller = new AbortController();
  setModelStatus('loading');
  const fallback = o.apiBaseUrl.trim() ? [] : he;
  d(fallback);
  loadModelList({ headers: Fe, signal: controller.signal }).then(entries => {
    if (controller.signal.aborted) return;
    const options = entries.map((entry, index) => {
      const match = he.find(model => model.id === entry.id);
      const context = [entry.context_length, entry.context_window, entry.max_context_tokens, entry.top_provider?.context_length]
        .find(value => Number.isSafeInteger(value) && value > 0);
      return { ...(match || { id: entry.id, family: '服务端', note: '可用模型',
        accent: ['#659b88','#718eb0','#a386bd'][index % 3], endpoint: 'chat' }),
        name: entry.name || match?.name || entry.id, capacity: context ? Ce(context) : match?.capacity || '' };
    });
    d(options);
    setModelStatus('ready');
    if (!options.some(model => model.id === ie.current.model) && !ie.current.messages.length) {
      const first = options.find(model => model.id === o.defaultModel) || options[0];
      const next = { ...ie.current, model: first.id };
      ie.current = next;
      a(first.id);
      ee(first.id);
      m(next);
    }
  }).catch(error => {
    if (!controller.signal.aborted) setModelStatus(error.message || '模型列表获取失败。');
  });
  return () => controller.abort();
}, [Ie, o.apiBaseUrl, o.apiKey, modelRefresh]),
""" + client[end:]
# Adapt the recovered controller to the editable iOS-style components.
replace('[y,b]=(0,f.useState)(`chat`)', '[settingsBack,setSettingsBack]=f.useState(`new`),[showModelSheet,setShowModelSheet]=f.useState(false)')
replace('ct=()=>{g(h===`models`?y:_)},lt=()=>{v(h),g(`history`)},ut=()=>{h!==`history`&&v(h),g(`settings`)},ft=(e=`current`)=>{S(e),b(h),g(`models`)}',
        'ct=()=>{g(h===`settings`?settingsBack:_)},lt=()=>{v(h),g(`history`)},ut=()=>{setSettingsBack(h),g(`settings`)},ft=(e=`current`)=>{S(e),setShowModelSheet(true)}')
replace('}else et(e);g(y)},mt=()=>', '}else et(e);setShowModelSheet(false)},mt=()=>')

replace('Qe=()=>{B.current?.abort(),w(!1),P(null),re.current=``,m(ff(i)),g(`new`)}',
        '''defaultForNewChat = () => u.some(model => model.id === Se.current.defaultModel) ? Se.current.defaultModel : i,
Qe=()=>{
  B.current?.abort();
  w(false);
  P(null);
  re.current='';
  const draft = ff(defaultForNewChat());
  ie.current=draft;
  m(draft);
  g('new');
}''')
replace('document.documentElement.dataset.theme=o.theme,Se.current=o,L(o)',
        '''document.documentElement.dataset.theme=o.theme,Se.current=o,L(o),
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',
    getComputedStyle(document.documentElement).getPropertyValue('--lmn-canvas').trim() || '#f7f5ee')''')
replace('if(t.style.getPropertyValue(`--vv-bottom`)!==a&&t.style.setProperty(`--vv-bottom`,a),t.style.getPropertyValue(`--vv-height`)!==o&&t.style.setProperty(`--vv-height`,o),!n()&&i===0){',
        '''if(t.style.getPropertyValue('--vv-bottom')!==a) t.style.setProperty('--vv-bottom',a);
  if(t.style.getPropertyValue('--vv-height')!==o) t.style.setProperty('--vv-height',o);
  const restingHeight = Number.parseFloat(t.style.getPropertyValue('--vv-base-height')) || window.innerHeight;
  t.toggleAttribute('data-lmn-keyboard', n() && (i > 65 || restingHeight - e.height > 85));
  if(!n()&&i===0){''')

# Preserve the existing advanced controls and their handlers.
start = client.index('function cf({settings:e,')
end = client.index('function lf({', start)
settings = client[start:end]
advanced = settings.index('(0,V.jsxs)(`div`,{className:`settings-group`,children:[(0,V.jsx)(`div`,{className:`settings-group-title`,children:`生成参数`}') 
first_view = settings.index('return(0,V.jsxs)(`div`,{className:`settings-screen')
signature = settings[:first_view].replace('onBack:c,onOpenModels:l}', 'onBack:c,onOpenModels:l,status}')
assert settings.endswith(']})}')
advanced_view = settings[advanced:-4]
client = client[:start] + signature + '''return V.jsx(LumenSettings, {
  settings:e,onChange:t,models:r,onModel:l,onBack:c,status,children:[
''' + advanced_view + ']})}' + client[end:]

replace('className:`message-assistant`,children:(0,V.jsx)(tf,{startedAt:e.createdAt})',
        'className:`message-assistant`,children:V.jsxs(V.Fragment,{children:[V.jsx(LumenAssistantLabel,{}),V.jsx(tf,{startedAt:e.createdAt})]})')
replace('className:`message-assistant`,children:[e.reasoning', 'className:`message-assistant`,children:[V.jsx(LumenAssistantLabel,{}),e.reasoning')

start = client.index('return Ie===`checking`')
end = client.index('function bf(){', start)
client = client[:start] + '''
const isConversation = h === 'new' || h === 'chat';
const bookActions = {
  onPickBook:rt,onRemoveBook:ot,onSelectChapter:st,parsing:T,statusText:wt,
};
const modelActions = {
  onModel: () => ft('current'), model: ge(p.model,u),
};
const currentScreen = h === 'new' ? V.jsx(LumenHome,{
  onSend:gt,onHistory:lt,onSettings:ut,book:p.book,enterToSend:o.enterToSend,...modelActions,...bookActions,
}) : h === 'chat' ? V.jsx(LumenChat,{
  conversation:p,streaming:C,error:N,onSend:gt,onStop:vt,onRetry:_t,onCopy:St,onHistory:lt,
  onToggleReasoning:tt,onDelete:()=>bt(p.id),onNew:Qe,onSettings:ut,
  reasoningSupported:_e(p.model),enterToSend:o.enterToSend,compact:o.compactMode,
  fontSize:o.fontSize,lineHeight:o.lineHeight,paragraphSpacing:o.paragraphSpacing,
  ...modelActions,...bookActions,
}) : h === 'history' ? V.jsx(LumenHistory,{
  conversations:Re,onBack:ct,onNew:Qe,onOpen:$e,onSettings:ut,onSend:text=>void gt(text,ff(defaultForNewChat())),
  onDelete:bt,onStar:yt,onClear:xt,
}) : V.jsx(cf,{
  settings:o,onChange:nt,conversations:Re,models:u,model:p.model,syncCode:c,
  onChangeSyncCode:Je,onExport:mt,onBack:ct,onOpenModels:()=>ft('default'),status:modelStatus,
});
return V.jsxs('div',{className:'app-shell lmn-app',children:[
  Ie === 'authenticated' && isConversation && V.jsx(LumenSidebar,{
    conversations:Re,current:p.id,onNew:Qe,onOpen:$e,onHistory:lt,onSettings:ut,
  }),
  V.jsx('main',{className:'main-panel',children:
    Ie === 'checking' ? V.jsxs('div',{className:'lmn-auth-loading',role:'status',children:[
      V.jsx('span',{className:'lmn-spinner','aria-hidden':true}),'正在确认会话',
    ]}) : Ie === 'unauthenticated' ? V.jsx(LumenSignIn,{onLogin:ht}) : currentScreen,
  }),
  Ie === 'authenticated' && showModelSheet && V.jsx(LumenModelSheet,{
    model:x === 'default' ? o.defaultModel : p.model,models:u,status:modelStatus,
    provider:o.apiBaseUrl.trim() || o.apiKey.trim() ? '自定义服务' : 'OpenCode Go',
    onRefresh:()=>setModelRefresh(value=>value+1),onSelect:pt,onClose:()=>setShowModelSheet(false),
  }),
  R && V.jsxs('div',{className:'lmn-toast',role:'status',children:[V.jsx(LumenIcon,{name:'check',size:15}),R]}),
]});
}
''' + client[end:]
replace('bf(),(0,p.createRoot)', '(0,p.createRoot)')

# Retain the bundle exports for the original Markdown and code highlighting chunks.
entry = client.index('(0,p.createRoot)(document.getElementById')
icons = json.dumps(json.loads(Path('client/design-assets/icons.json').read_text()), ensure_ascii=False)
components = Path('client/components.js').read_text()
client = client[:entry] + '\nconst LumenPaths=' + icons + ';\n' + components + '\n' + client[entry:]
output = Path('built')
output.mkdir(exist_ok=True)
(output/'lumen-editorial-v57.js').write_text(client)

html = Path('base/index.html').read_text()
html = html.replace('initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no', 'initial-scale=1')
html = html.replace('#1d1c1a', '#f7f5ee')
import_map = json.dumps({'imports': {'/assets/index-CnP54MM8.js': '/assets/lumen-editorial-v57.js'}})
html = html.replace('    <script type="module"', '    <script type="importmap">' + import_map + '</script>\n    <script type="module"')
html = html.replace('src="/assets/index-CnP54MM8.js"', 'src="/assets/lumen-editorial-v57.js"')
html = html.replace('  </head>', '    <link rel="stylesheet" href="/assets/lumen-editorial-v57.css">\n  </head>')
(output/'index.html').write_text(html)
