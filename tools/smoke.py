import os
from base64 import b64encode
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

from playwright.sync_api import sync_playwright

markers = ['首章蓝鲸标记', '中篇代号草稿纸', '终章火星标记']

def book(repeats, missing=False):
    output = BytesIO()
    with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('mimetype', 'application/epub+zip')
        archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/content.opf" /></rootfiles></container>')
        archive.writestr('OPS/content.opf', '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>三章测试书</dc:title><dc:creator>测试作者</dc:creator></metadata><manifest>' +
          ''.join('<item id="c%d" href="c%d.xhtml" media-type="application/xhtml+xml" />' % (i, i) for i in range(3)) +
          '</manifest><spine>' + ''.join('<itemref idref="c%d" />' % i for i in range(3)) + '</spine></package>')
        for i, marker in enumerate(markers):
            if missing and i == 2:
                continue
            archive.writestr(f'OPS/c{i}.xhtml',
                f'<html><body><h1>章节 {i+1}</h1><div>容器直接正文</div><p>小节 <em>强调</em> 与 <strong>重点</strong></p>' +
                ('<p>这是一段用于检查上下文过程和覆盖率的正文，里面包含普通文字。</p>' * repeats) +
                f'<p>{marker}</p></body></html>')
    return output.getvalue()

screenshots = Path('screenshots')
screenshots.mkdir(exist_ok=True)
origin = 'http://127.0.0.1:4173'

def open_page(context):
    response = context.request.post(origin + '/api/auth', data={'token': 'local-test-only'})
    assert response.ok
    page = context.new_page()
    page.set_default_timeout(9000)
    errors = []
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    page.goto(origin)
    page.get_by_role('heading', name='今天想聊什么？').wait_for()
    return page, errors

def screenshot(page, name):
    return page.screenshot(path=str(screenshots / (name + '.png')), animations='disabled')

def assert_in_view(page, selector, target_width):
    bounds = page.locator(selector).bounding_box()
    assert bounds and bounds['x'] >= -1 and bounds['x'] + bounds['width'] <= target_width + 1, (selector, bounds, target_width)
    assert bounds['y'] >= -1 and bounds['y'] + bounds['height'] <= page.viewport_size['height'] + 1, (selector, bounds)

with sync_playwright() as playwright:
    def launch():
        engine = os.getenv('LUMEN_BROWSER', 'chromium')
        if engine == 'webkit':
            return playwright.webkit.launch()
        return playwright.chromium.launch(
            executable_path=os.getenv('LUMEN_CHROME', '/usr/bin/chromium'),
            args=['--no-sandbox','--disable-dev-shm-usage','--single-process','--no-zygote','--in-process-gpu'],
        )

    browser = launch()
    mobile = browser.new_context(
        viewport={'width':430,'height':900}, is_mobile=True, has_touch=True,
        device_scale_factor=1, locale='zh-CN', accept_downloads=True,
    )
    assert mobile.request.post(origin + '/api/epub', data=book(0)).status == 401
    login = mobile.new_page()
    login.goto(origin)
    login.get_by_role('heading', name='进入 Lumen').wait_for()
    screenshot(login, 'native-login')
    login.get_by_label('访问令牌').fill('local-test-only')
    login.get_by_role('button', name='进入', exact=True).click()
    login.get_by_role('heading', name='今天想聊什么？').wait_for()
    login.close()
    page, errors = open_page(mobile)
    response = mobile.request.post(origin + '/api/epub', data=book(0))
    assert response.ok, response.text()
    valid = response.json()
    assert valid['chapterCount'] == 3 and '**重点**' in valid['chapters'][0]['text']
    assert '容器直接正文' in valid['chapters'][0]['text']
    assert mobile.request.post(origin + '/api/epub', data=book(0, missing=True)).status == 422
    page.wait_for_function("document.querySelector('.lmn-orb')?.naturalWidth === 148")
    assert page.get_by_role('button', name='DeepSeek V4 Pro').is_visible()
    screenshot(page, 'native-mobile')

    # An open model picker keeps the current conversation and draft in place.
    field = page.get_by_role('textbox', name='输入消息')
    page.get_by_role('button', name='梳理想法', exact=False).click()
    assert field.input_value().startswith('帮我梳理')
    trigger = page.locator('.lmn-model-pill')
    trigger.click()
    sheet = page.get_by_role('dialog', name='选择模型')
    sheet.get_by_text('来自 OpenCode Go').wait_for()
    assert sheet.evaluate('(node) => node.open')
    assert sheet.evaluate('(node) => getComputedStyle(node).animationName') == 'lmn-sheet-in'
    assert sheet.get_by_role('button', name='DeepSeek V4 Pro', exact=False).get_attribute('aria-pressed') == 'true'
    screenshot(page, 'native-model-sheet')
    page.keyboard.press('Escape')
    sheet.wait_for(state='detached')
    assert field.input_value().startswith('帮我梳理')
    assert trigger.evaluate('(node) => node === document.activeElement')
    trigger.click()
    sheet.wait_for()
    grab = sheet.locator('.lmn-sheet-grab')
    page.wait_for_function("!document.querySelector('.lmn-sheet').getAnimations().some(animation => animation.playState === 'running')")
    box = grab.bounding_box()
    x, y = box['x'] + box['width']/2, box['y'] + box['height']/2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x, y + 105, steps=7)
    page.mouse.up()
    sheet.wait_for(state='detached')

    # A changed visual viewport keeps the controls inside the visible area.
    field.focus()
    page.set_viewport_size({'width':430,'height':520})
    page.wait_for_function("Math.round(document.querySelector('#root').getBoundingClientRect().height) <= 521")
    assert_in_view(page, '.lmn-send', 430)
    page.set_viewport_size({'width':430,'height':900})
    field.fill('')

    page.locator('input[type=file]').set_input_files({
        'name': 'unsupported.txt', 'mimeType': 'text/plain', 'buffer': b'not an EPUB'})
    page.get_by_text('请选择一本 EPUB 书籍。', exact=True).wait_for()
    page.locator('.lmn-composer').evaluate('''(form, base64) => {
        const zip = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(new File([zip], 'full.epub', {type:'application/epub+zip'}))
        form.dispatchEvent(new DragEvent('dragenter', {bubbles:true, cancelable:true, dataTransfer}))
    }''', b64encode(book(330)).decode())
    page.get_by_text('松开以上传 EPUB', exact=True).wait_for()
    page.locator('.lmn-composer').evaluate('''(form, base64) => {
        const zip = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(new File([zip], 'full.epub', {type:'application/epub+zip'}))
        form.dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer}))
    }''', b64encode(book(330)).decode())
    page.get_by_text('Markdown · 3 章', exact=True).wait_for()
    with page.expect_download() as saved:
        page.get_by_role('button', name='下载 Markdown').click()
    markdown = saved.value.path().read_text()
    assert all(marker in markdown for marker in markers)
    assert markdown.count('容器直接正文') == 3

    page.get_by_role('button', name='切换讨论范围').click()
    chapters = page.get_by_role('dialog', name='阅读范围')
    chapters.get_by_role('searchbox', name='搜索章节').fill('章节 3')
    chapters.get_by_role('button', name='章节 3', exact=False).click()
    chapters.wait_for(state='detached')
    assert page.get_by_role('button', name='切换讨论范围').inner_text().strip() == '章节 3'
    page.get_by_role('button', name='切换讨论范围').click()
    chapters.get_by_role('button', name='整本分析', exact=False).click()
    chapters.wait_for(state='detached')

    field.fill('请整本分析')
    page.get_by_role('button', name='发送').click()
    page.get_by_text('全书证据：' + '、'.join(markers)).wait_for(timeout=15000)
    assert page.get_by_text('覆盖不足', exact=False).count() == 0
    assert int(page.evaluate("JSON.parse(localStorage.getItem('lumen.usage.v1')).total")) >= 172
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.locator('.lmn-toast').wait_for(state='detached')
    screenshot(page, 'native-book-chat')

    page.get_by_role('button', name='打开历史').click()
    page.get_by_role('heading', name='对话', exact=True).wait_for()
    screenshot(page, 'native-history')
    page.get_by_role('button', name='设置', exact=True).click()
    page.get_by_text('已连接', exact=True).wait_for()
    screenshot(page, 'native-settings')
    page.get_by_text('高级设置', exact=True).click()
    page.get_by_role('button', name='深色', exact=True).click()
    page.get_by_role('button', name='完成').click()
    page.get_by_role('heading', name='对话', exact=True).wait_for()
    page.get_by_role('button', name='返回').click()
    screenshot(page, 'native-dark-chat')

    page.get_by_role('button', name='更多').click()
    choices = page.get_by_role('dialog', name='对话选项')
    choices.get_by_role('button', name='设置', exact=True).click()
    page.get_by_role('heading', name='设置', exact=True).wait_for()
    page.get_by_text('自定义接口', exact=True).click()
    page.get_by_role('textbox', name='接口地址').fill('https://models.example.com/v1')
    page.get_by_text('API Key', exact=True).locator('input').fill('sample-client-key')
    page.get_by_role('button', name='保存并获取模型').click()
    page.get_by_role('button', name='默认模型', exact=False).click()
    sheet.get_by_role('button', name='Custom Test Model', exact=False).wait_for()
    assert sheet.get_by_role('button', name='DeepSeek V4 Pro', exact=False).count() == 0
    assert not errors, errors
    browser.close()

    browser = launch()
    desktop = browser.new_context(viewport={'width':1280,'height':846}, device_scale_factor=1, locale='zh-CN')
    page, errors = open_page(desktop)
    assert page.locator('.lmn-sidebar').is_visible()
    screenshot(page, 'native-desktop')
    for width in [320, 375, 390, 430, 768, 1024, 1280]:
        page.set_viewport_size({'width':width,'height':750})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), ('page width', width)
        assert_in_view(page, '.lmn-send', width)
        assert_in_view(page, '.lmn-model-pill', width)
        assert_in_view(page, '.lmn-navigation button:last-child', width)

    page.locator('.lmn-model-pill').click()
    sheet = page.get_by_role('dialog', name='选择模型')
    sheet.wait_for()
    page.mouse.click(20, 20)
    sheet.wait_for(state='detached')
    for model in ['GPT 6 Luna', 'Qwen 3.6 Plus']:
        page.get_by_role('button', name='新对话', exact=True).click()
        page.locator('.lmn-model-pill').click()
        sheet.get_by_role('button', name=model, exact=False).click()
        sheet.wait_for(state='detached')
        page.get_by_role('textbox', name='输入消息').fill('验证 ' + model)
        page.get_by_role('button', name='发送').click()
        page.get_by_text('已收到：验证 ' + model, exact=False).wait_for()
    assert int(page.evaluate("JSON.parse(localStorage.getItem('lumen.usage.v1')).total")) >= 86

    page.emulate_media(reduced_motion='reduce')
    page.locator('.lmn-model-pill').click()
    sheet.wait_for()
    assert sheet.evaluate('(node) => getComputedStyle(node).animationDuration') == '0s'
    sheet.get_by_role('button', name='关闭', exact=True).click()
    sheet.wait_for(state='detached')
    assert not errors, errors
    browser.close()
print('PASS: login, viewport layout, keyboard, motion and reduced motion, accessible sheets, chapter selection, EPUB drop and coverage, usage, model providers')
