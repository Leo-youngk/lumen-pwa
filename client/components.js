// The recovered application supplies the React runtime, conversation store, and Markdown renderer.
function LumenIcon({ name, size = 21, strokeWidth = 1.7 }) {
  return V.jsx('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    focusable: 'false',
    'aria-hidden': true,
    dangerouslySetInnerHTML: { __html: LumenPaths[name] },
  })
}

function LumenButton({ icon, label, onClick, variant = 'glass', className = '', disabled, expanded, hasPopup, autoFocus }) {
  return V.jsx('button', {
    type: 'button',
    className: `lmn-icon-button lmn-icon-button--${variant} ${className}`,
    'aria-label': label,
    'aria-expanded': expanded,
    'aria-haspopup': hasPopup,
    title: label,
    onClick,
    disabled,
    autoFocus,
    children: V.jsx(LumenIcon, { name: icon }),
  })
}

function LumenTile({ icon, tone = 'violet', children }) {
  return V.jsx('span', {
    className: `lmn-tile lmn-tile--${tone}`,
    'aria-hidden': true,
    children: children || V.jsx(LumenIcon, { name: icon }),
  })
}

function LumenOrb({ className = '' }) {
  return V.jsx('img', {
    alt: '',
    src: '/assets/lumen-orb-v56.svg',
    width: 148,
    height: 144,
    className: `lmn-orb ${className}`,
    decoding: 'async',
    draggable: false,
  })
}

function LumenNavigation({ title, wideTitle, onHistory, trailing, kind = 'chat' }) {
  return V.jsxs('header', {
    className: `lmn-navigation lmn-navigation--${kind}`,
    children: [
      V.jsx(LumenButton, { icon: 'history', label: '打开历史', className: 'lmn-mobile-history', onClick: onHistory }),
      V.jsx('div', { className: 'lmn-nav-title', children: title }),
      V.jsx('div', { className: 'lmn-nav-wide-title', children: wideTitle || title }),
      trailing,
    ],
  })
}

function LumenPageNav({ onBack, trailing }) {
  return V.jsxs('header', {
    className: 'lmn-navigation lmn-page-navigation',
    children: [V.jsx(LumenButton, { icon: 'left', label: '返回', onClick: onBack }), trailing],
  })
}

function LumenUsage({ detailed = false }) {
  const usage = f.useSyncExternalStore(subscribeUsage, usageSnapshot)
  const total = usage.total || !usage.unreported ? tokenLabel(usage.total) : '—'
  const input = tokenLabel(usage.input)
  const output = tokenLabel(usage.output)
  const note = usage.unreported ? `${usage.unreported} 次请求未返回用量` : ''
  if (!detailed) {
    return V.jsx('output', {
      className: 'lmn-token-count',
      title: [`本设备累计，输入 ${input}，输出 ${output}`, note].filter(Boolean).join('。'),
      'aria-label': '本设备累计 Token',
      children: `${total} tokens`,
    })
  }
  return V.jsxs('section', {
    className: 'lmn-card lmn-usage-card',
    'aria-label': '本设备累计 Token 用量',
    children: [
      V.jsxs('h2', {
        className: 'lmn-usage-label',
        children: [V.jsx(LumenTile, { icon: 'usage', tone: 'teal' }), 'Token 用量'],
      }),
      V.jsxs('div', {
        className: 'lmn-usage-total',
        children: [V.jsx('strong', { children: total }), V.jsx('span', { children: 'tokens' })],
      }),
      V.jsxs('dl', {
        className: 'lmn-usage-breakdown',
        children: [
          V.jsxs('div', { children: [V.jsx('dt', { children: '输入' }), V.jsx('dd', { children: input })] }),
          V.jsxs('div', { children: [V.jsx('dt', { children: '输出' }), V.jsx('dd', { children: output })] }),
        ],
      }),
      note && V.jsx('p', { className: 'lmn-usage-note', children: note }),
    ],
  })
}

function LumenComposer({
  onSend, onStop, onPickBook, onModel, onScope, model, scopeLabel,
  parsing, streaming, statusText, editorRef, uploadRef, draft, onDraftChange, enterToSend = true, placeholder = '问 Lumen…',
}) {
  const [localDraft, setLocalDraft] = f.useState('')
  const message = draft ?? localDraft
  const setMessage = onDraftChange || setLocalDraft
  const internalEditor = f.useRef(null)
  const internalUpload = f.useRef(null)
  const editor = editorRef || internalEditor
  const upload = uploadRef || internalUpload
  const [fileError, setFileError] = f.useState('')
  const [fileHover, setFileHover] = f.useState(false)
  const dragDepth = f.useRef(0)
  const ready = Boolean(message.trim()) && !parsing && !streaming
  const canAttach = Boolean(onPickBook) && !parsing && !streaming

  function attach(files) {
    if (!canAttach || !files?.length) return
    const file = files[0]
    if (files.length !== 1 || !(/\.epub$/i.test(file.name) || file.type === 'application/epub+zip')) {
      setFileError('请选择一本 EPUB 书籍。')
      return
    }
    setFileError('')
    onPickBook(file)
  }

  function onFileDrag(event) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    if (!canAttach) return
    if (event.type === 'dragenter') {
      dragDepth.current += 1
      setFileHover(true)
    } else if (event.type === 'dragleave') {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (!dragDepth.current) setFileHover(false)
    }
  }

  function onFileDrop(event) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    dragDepth.current = 0
    setFileHover(false)
    attach(event.dataTransfer.files)
  }

  f.useLayoutEffect(() => {
    const field = editor.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = Math.min(112, Math.max(24, field.scrollHeight)) + 'px'
  }, [message, editor])

  function submit(event) {
    event?.preventDefault()
    if (!ready) return
    onSend(message.trim())
    setMessage('')
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && enterToSend) submit(event)
  }

  return V.jsxs('div', {
    className: 'lmn-dock',
    children: [
      V.jsxs('form', {
        className: 'lmn-composer',
        'data-file-hover': fileHover && canAttach ? 'true' : undefined,
        onDragEnter: onPickBook ? onFileDrag : undefined,
        onDragLeave: onPickBook ? onFileDrag : undefined,
        onDragOver: onPickBook ? onFileDrag : undefined,
        onDrop: onPickBook ? onFileDrop : undefined,
        onSubmit: submit,
        children: [
          fileHover && canAttach && V.jsx('div', { className: 'lmn-drop-hint', role: 'status', children: '松开以上传 EPUB' }),
          fileError && V.jsx('p', { className: 'lmn-status-error', role: 'status', children: fileError }),
          onScope && V.jsxs('button', {
            type: 'button', className: 'lmn-scope-pill', onClick: onScope, 'aria-haspopup': 'dialog',
            'aria-label': '切换讨论范围',
            children: [
              V.jsx(LumenIcon, { name: 'book', size: 16 }),
              V.jsx('span', { children: scopeLabel }),
              V.jsx(LumenIcon, { name: 'down', size: 14 }),
            ],
          }),
          statusText && V.jsxs('div', {
            className: 'lmn-composer-status', role: 'status',
            children: [V.jsx('span', { className: 'lmn-spinner', 'aria-hidden': true }), statusText],
          }),
          V.jsx('textarea', {
            ref: editor, rows: 1, value: message, 'aria-label': '输入消息',
            placeholder, onKeyDown, onChange: event => setMessage(event.target.value),
            autoComplete: 'off', enterKeyHint: enterToSend ? 'send' : 'enter',
          }),
          V.jsxs('div', {
            className: 'lmn-composer-tools',
            children: [
              onPickBook ? V.jsxs(V.Fragment, {
                children: [
                  V.jsx('input', {
                    type: 'file', ref: upload, hidden: true, accept: '.epub,application/epub+zip',
                    onChange: event => {
                      attach(event.target.files)
                      event.target.value = ''
                    },
                  }),
                  V.jsx(LumenButton, { icon: 'plus', label: '上传书籍', disabled: parsing || streaming, onClick: () => upload.current?.click() }),
                ],
              }) : V.jsx('span', { className: 'lmn-composer-left' }),
              onModel && V.jsxs('button', {
                type: 'button', className: 'lmn-model-pill', 'aria-haspopup': 'dialog', onClick: onModel, title: model,
                children: [
                  V.jsx('span', { className: 'lmn-model-dot', 'aria-hidden': true }),
                  V.jsx('span', { className: 'lmn-model-name', children: model }),
                  V.jsx(LumenIcon, { name: 'down', size: 13 }),
                ],
              }),
              V.jsx('button', {
                type: streaming ? 'button' : 'submit', className: 'lmn-send',
                'aria-label': streaming ? '停止生成' : '发送', disabled: !streaming && !ready,
                onClick: streaming ? onStop : undefined,
                children: V.jsx(LumenIcon, { name: streaming ? 'stop' : 'send', size: 22, strokeWidth: 2 }),
              }),
            ],
          }),
        ],
      }),
      onModel && V.jsx(LumenUsage, {}),
    ],
  })
}

function LumenAction({ icon, title, detail, tone, onClick, disabled }) {
  return V.jsxs('button', {
    type: 'button', className: 'lmn-action lmn-card', onClick, disabled,
    children: [
      V.jsx(LumenTile, { icon, tone }),
      V.jsxs('span', {
        className: 'lmn-action-label',
        children: [V.jsx('strong', { children: title }), V.jsx('small', { children: detail })],
      }),
      V.jsx(LumenIcon, { name: 'right', size: 16 }),
    ],
  })
}

function LumenHome({
  onSend, onHistory, onSettings, onModel, model, book, onPickBook, onRemoveBook, onSelectChapter, parsing, statusText, enterToSend,
}) {
  const editor = f.useRef(null)
  const upload = f.useRef(null)
  const [showShelf, setShowShelf] = f.useState(false)
  const [draft, setDraft] = f.useState('')
  const { meta, status } = Jd(book?.id)

  function startIdea() {
    const field = editor.current
    if (!field) return
    if (!draft.trim()) setDraft('帮我梳理这个想法：')
    field.focus()
    requestAnimationFrame(() => {
      field.setSelectionRange(field.value.length, field.value.length)
    })
  }

  return V.jsxs('section', {
    className: 'page-screen lmn-page lmn-home',
    children: [
      V.jsx(LumenNavigation, {
        title: 'Lumen', wideTitle: '新对话', kind: 'home', onHistory,
        trailing: V.jsx(LumenButton, { icon: 'settings', label: '设置', onClick: onSettings }),
      }),
      V.jsx('div', {
        className: 'lmn-home-scroll',
        children: book ? V.jsxs('div', {
          className: 'lmn-home-book',
          children: [
            V.jsx('h1', { children: '聊聊这本书' }),
            V.jsx(LumenBookCard, { book, meta, status, onScope: () => setShowShelf(true) }),
            V.jsx('div', {
              className: 'lmn-book-suggestions',
              children: ['梳理全书结构', '这本书的核心观点是什么？', '哪些部分最值得重读？'].map(text =>
                V.jsx('button', { type: 'button', onClick: () => onSend(text), disabled: parsing, children: text }, text)),
            }),
          ],
        }) : V.jsxs('div', {
          className: 'lmn-home-hero',
          children: [
            V.jsx(LumenOrb, {}),
            V.jsx('h1', { children: '今天想聊什么？' }),
            V.jsx('p', { children: '从一个问题、一段思路或一本书开始。' }),
            V.jsxs('div', {
              className: 'lmn-actions',
              children: [
                V.jsx(LumenAction, { icon: 'book', title: '读一本书', detail: '上传 EPUB，开始问答', onClick: () => upload.current?.click(), disabled: parsing }),
                V.jsx(LumenAction, { icon: 'idea', tone: 'blue', title: '梳理想法', detail: '从一个思路开始', onClick: startIdea }),
              ],
            }),
          ],
        }),
      }),
      V.jsx(LumenComposer, {
        onSend, onPickBook, onModel, model, parsing, statusText, editorRef: editor, uploadRef: upload, draft, onDraftChange: setDraft, enterToSend,
        placeholder: book ? '向这本书提问…' : '问 Lumen…',
        onScope: book ? () => setShowShelf(true) : undefined,
        scopeLabel: book ? LumenScopeLabel(book, meta, status) : undefined,
      }),
      showShelf && book && V.jsx(LumenChapterSheet, { book, meta, status, onSelect: onSelectChapter, onRemove: onRemoveBook, onClose: () => setShowShelf(false) }),
    ],
  })
}

function LumenScopeLabel(book, meta, status) {
  if (status === 'missing') return '正文不在本机'
  if (book.focusChapter == null) return '整本分析'
  return meta?.chapterTitles[book.focusChapter] || `第 ${book.focusChapter + 1} 章`
}

function LumenBookCard({ book, meta, status, onScope }) {
  const [error, setError] = f.useState('')
  const detail = status === 'missing' ? '正文不在本机，请重新上传 EPUB'
    : [
        book.markdown ? 'Markdown' : book.author,
        `${book.chapterCount} 章`,
        book.unreadable ? `${book.unreadable} 节未提取正文` : '',
      ].filter(Boolean).join(' · ')

  async function save() {
    try {
      const stored = await st(book.id)
      if (!stored?.chapters?.length) throw new Error('正文已不在本机。')
      setError('')
      downloadBook(book, stored.chapters)
    } catch (failure) {
      setError(failure.message || '下载失败。')
    }
  }

  return V.jsxs('div', {
    className: 'lmn-book-card-wrap',
    children: [
      V.jsxs('div', {
        className: 'lmn-book-card lmn-card',
        children: [
          V.jsxs('button', {
            type: 'button', className: 'lmn-book-open', onClick: onScope, 'aria-haspopup': 'dialog',
            children: [
              V.jsx(LumenTile, { icon: 'book', children: meta?.cover && V.jsx('img', { alt: '', src: meta.cover }) }),
              V.jsxs('span', {
                className: 'lmn-book-label',
                children: [V.jsx('strong', { children: book.title }), V.jsx('small', { children: detail })],
              }),
            ],
          }),
          status === 'ready' && V.jsx(LumenButton, { icon: 'download', label: '下载 Markdown', variant: 'quiet', onClick: save }),
        ],
      }),
      error && V.jsx('p', { className: 'lmn-status-error', role: 'status', children: error }),
    ],
  })
}

function LumenAssistantLabel() {
  return V.jsxs('div', {
    className: 'lmn-assistant-label',
    children: [V.jsx(LumenTile, { icon: 'logo', tone: 'brand' }), 'Lumen'],
  })
}

function LumenChat({
  conversation, streaming, error, onSend, onStop, onRetry, onCopy, onHistory, onModel, onToggleReasoning, onDelete,
  onSettings, onNew, model, reasoningSupported, enterToSend, compact, fontSize, lineHeight, paragraphSpacing,
  onPickBook, onRemoveBook, onSelectChapter, parsing, statusText,
}) {
  const [showOptions, setShowOptions] = f.useState(false)
  const [showShelf, setShowShelf] = f.useState(false)
  const [belowFold, setBelowFold] = f.useState(false)
  const feed = f.useRef(null)
  const stickToBottom = f.useRef(true)
  const copy = f.useRef(onCopy)
  copy.current = onCopy
  const copyMessage = f.useCallback(text => copy.current(text), [])
  const { book, messages, reasoning } = conversation
  const { meta, status } = Jd(book?.id)
  const last = messages.at(-1)
  const userTurns = messages.filter(message => message.role === 'user').length

  f.useLayoutEffect(() => {
    stickToBottom.current = true
    setBelowFold(false)
  }, [conversation.id, userTurns])

  f.useLayoutEffect(() => {
    if (feed.current && stickToBottom.current) feed.current.scrollTop = feed.current.scrollHeight
  }, [conversation.id, messages.length, last?.content, last?.reasoning, statusText, book?.id])

  function onScroll() {
    const element = feed.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    stickToBottom.current = distance < 82
    setBelowFold(distance > 150)
  }

  function jumpToLatest() {
    if (!feed.current) return
    stickToBottom.current = true
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    feed.current.scrollTo({ top: feed.current.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  return V.jsxs('section', {
    className: 'page-screen lmn-page lmn-chat',
    children: [
      V.jsx(LumenNavigation, {
        onHistory, title: conversation.title, trailing: V.jsx(LumenButton, {
          icon: 'more', label: '更多', onClick: () => setShowOptions(true), hasPopup: 'dialog',
        }),
      }),
      V.jsx('div', {
        className: 'lmn-feed-scroll', onScroll, ref: feed,
        children: V.jsxs('div', {
          className: `lmn-feed ${compact ? 'is-compact' : ''}`,
          style: {
            '--chat-font-size': fontSize + 'px',
            '--chat-line-height': lineHeight,
            '--chat-paragraph-spacing': paragraphSpacing + 'px',
          },
          children: [
            book && V.jsx(LumenBookCard, { book, meta, status, onScope: () => setShowShelf(true) }),
            ...messages.map(message => V.jsx(ef, { message, onCopy: copyMessage }, message.id)),
            error && V.jsxs('div', {
              className: 'lmn-error-card', role: 'alert',
              children: [
                V.jsx('span', { children: error }),
                V.jsx('button', { type: 'button', onClick: onRetry, children: '重试' }),
              ],
            }),
          ],
        }),
      }),
      V.jsxs('div', {
        className: 'lmn-chat-bottom',
        children: [
          belowFold && V.jsx(LumenButton, { variant: 'glass', icon: 'down', label: '滚动到最新消息', className: 'lmn-jump', onClick: jumpToLatest }),
          V.jsx(LumenComposer, {
            onSend, onStop, onModel, onPickBook, model, streaming, parsing, statusText, enterToSend,
            placeholder: streaming ? '正在生成回答…' : '继续追问…',
            onScope: book ? () => setShowShelf(true) : undefined,
            scopeLabel: book ? LumenScopeLabel(book, meta, status) : undefined,
          }),
        ],
      }),
      showShelf && book && V.jsx(LumenChapterSheet, { book, meta, status, onSelect: onSelectChapter, onRemove: onRemoveBook, onClose: () => setShowShelf(false) }),
      showOptions && V.jsx(LumenSheet, {
        title: '对话选项', onClose: () => setShowOptions(false),
        children: dismiss => V.jsxs('div', {
          className: 'lmn-sheet-actions',
          children: [
            V.jsx(LumenRow, { icon: 'plus', label: '新对话', onClick: () => dismiss(onNew) }),
            V.jsx(LumenRow, {
              icon: 'chip', label: '深度思考', value: reasoningSupported ? (reasoning ? '已开启' : '已关闭') : '由模型控制',
              onClick: reasoningSupported ? () => dismiss(onToggleReasoning) : undefined,
            }),
            V.jsx(LumenRow, { icon: 'settings', label: '设置', onClick: () => dismiss(onSettings) }),
            V.jsx('button', { type: 'button', className: 'lmn-destructive', onClick: () => dismiss(onDelete), children: '删除当前对话' }),
          ],
        }),
      }),
    ],
  })
}

function LumenSheet({ title, onClose, children, variant = '' }) {
  const dialog = f.useRef(null)
  const closer = f.useRef(null)
  const result = f.useRef(null)
  const drag = f.useRef(null)
  const closing = f.useRef(false)
  const titleId = f.useId()

  f.useLayoutEffect(() => {
    const sheet = dialog.current
    if (!sheet) return
    const trigger = document.activeElement
    sheet.showModal()
    sheet.querySelector('.lmn-sheet-close')?.focus({ preventScroll: true })
    return () => {
      clearTimeout(closer.current)
      if (sheet.open) sheet.close()
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [])

  function finish() {
    clearTimeout(closer.current)
    if (!closing.current || !dialog.current?.open) return
    dialog.current.close()
    onClose()
    result.current?.()
  }

  function dismiss(action) {
    if (closing.current) return
    closing.current = true
    result.current = action
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish()
      return
    }
    dialog.current.dataset.closing = 'true'
    closer.current = setTimeout(finish, 230)
  }

  function startDrag(event) {
    if (closing.current || event.button !== 0) return
    drag.current = { id: event.pointerId, y: event.clientY, distance: 0 }
    event.currentTarget.setPointerCapture(event.pointerId)
    dialog.current.dataset.dragging = 'true'
  }

  function moveDrag(event) {
    if (drag.current?.id !== event.pointerId) return
    const distance = Math.max(0, event.clientY - drag.current.y)
    drag.current.distance = distance
    dialog.current.style.setProperty('--lmn-sheet-drag', distance + 'px')
  }

  function endDrag(event) {
    if (drag.current?.id !== event.pointerId) return
    const distance = drag.current.distance
    drag.current = null
    delete dialog.current.dataset.dragging
    if (event.type === 'pointerup' && distance >= 72) dismiss()
    else dialog.current.style.removeProperty('--lmn-sheet-drag')
  }

  return Et.createPortal(V.jsxs('dialog', {
    ref: dialog, className: variant ? 'lmn-sheet lmn-sheet--' + variant : 'lmn-sheet', 'aria-labelledby': titleId,
    onCancel: event => { event.preventDefault(); dismiss() },
    onAnimationEnd: event => {
      if (event.target === event.currentTarget && closing.current && event.animationName === 'lmn-sheet-out') finish()
    },
    onClick: event => {
      if (event.target !== event.currentTarget) return
      const box = event.currentTarget.getBoundingClientRect()
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dismiss()
    },
    children: [
      V.jsx('div', {
        className: 'lmn-sheet-grab', 'aria-hidden': true,
        onPointerDown: startDrag, onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag,
        children: V.jsx('span', {}),
      }),
      V.jsxs('header', {
        className: 'lmn-sheet-header',
        children: [
          V.jsx('h2', { id: titleId, children: title }),
          V.jsx(LumenButton, { icon: 'close', label: '关闭', variant: 'quiet', className: 'lmn-sheet-close', onClick: () => dismiss() }),
        ],
      }),
      V.jsx('div', { className: 'lmn-sheet-body', children: children(dismiss) }),
    ],
  }), document.body)
}

function LumenModelSheet({ model, models, status, provider, onRefresh, onSelect, onClose }) {
  const [search, setSearch] = f.useState('')
  const normalized = search.trim().toLowerCase()
  const visible = models.filter(item => `${item.name} ${item.id} ${item.family}`.toLowerCase().includes(normalized))
  return V.jsx(LumenSheet, {
    title: '选择模型', onClose, variant: 'models',
    children: dismiss => V.jsxs(V.Fragment, {
      children: [
        V.jsxs('div', {
          className: 'lmn-model-source',
          children: [
            V.jsx('p', {
              role: 'status',
              children: status === 'ready' ? `来自 ${provider}` : status === 'loading' ? '正在读取模型…' : status,
            }),
            V.jsx(LumenButton, { icon: 'refresh', label: '刷新模型', onClick: onRefresh, disabled: status === 'loading', variant: 'quiet' }),
          ],
        }),
        models.length > 8 && V.jsx(LumenSearch, { label: '搜索模型', value: search, onChange: setSearch }),
        V.jsx('div', {
          className: 'lmn-sheet-list', 'aria-label': '可选模型',
          children: visible.length ? visible.map(option => {
            const picked = model === option.id
            const detail = [option.family, option.capacity && `${option.capacity} 上下文`].filter(Boolean).join(' · ')
            return V.jsxs('button', {
              type: 'button', className: 'lmn-choice', 'aria-pressed': picked,
              onClick: () => dismiss(() => onSelect(option.id)),
              children: [
                V.jsx(LumenTile, { icon: 'chip', tone: picked ? 'surface' : 'blue' }),
                V.jsxs('span', {
                  className: 'lmn-choice-label',
                  children: [V.jsx('strong', { children: option.name }), V.jsx('small', { children: detail })],
                }),
                picked && V.jsx('span', { className: 'lmn-picked', children: V.jsx(LumenIcon, { name: 'check', size: 15 }) }),
              ],
            }, option.id)
          }) : V.jsx('p', { className: 'lmn-empty-message', children: normalized ? '没有匹配的模型' : status === 'loading' ? '正在连接模型服务' : '暂无可用模型' }),
        }),
      ],
    }),
  })
}

function LumenSearch({ label, value, onChange }) {
  return V.jsxs('label', {
    className: 'lmn-search',
    children: [
      V.jsx(LumenIcon, { name: 'search', size: 19 }),
      V.jsx('input', {
        type: 'search', 'aria-label': label, placeholder: label, value,
        onChange: event => onChange(event.target.value),
      }),
    ],
  })
}

function LumenChapterSheet({ book, meta, status, onSelect, onRemove, onClose }) {
  const [search, setSearch] = f.useState('')
  const chapters = meta?.chapterTitles || []
  const query = search.trim().toLowerCase()
  const visible = chapters.flatMap((title, index) => {
    return !query || `第 ${index + 1} 章 ${title}`.toLowerCase().includes(query) ? [{ title, index }] : []
  })

  return V.jsx(LumenSheet, {
    title: '阅读范围', onClose,
    children: dismiss => V.jsxs(V.Fragment, {
      children: [
        status === 'ready' && V.jsx(LumenSearch, { label: '搜索章节', value: search, onChange: setSearch }),
        status === 'missing' && V.jsx('p', { className: 'lmn-empty-message', children: '正文不在本机，请重新上传 EPUB。' }),
        status === 'loading' && V.jsx('p', { className: 'lmn-empty-message', role: 'status', children: '正在读取目录…' }),
        status === 'ready' && V.jsxs('div', {
          className: 'lmn-sheet-list',
          children: [
            V.jsx(LumenRow, {
              icon: 'book', label: '整本分析', value: `${book.chapterCount} 章`, selected: book.focusChapter == null,
              onClick: () => dismiss(() => onSelect(null)),
            }),
            ...visible.map(({ title, index }) => V.jsx(LumenRow, {
              label: title, value: `第 ${index + 1} 章`, selected: book.focusChapter === index,
              onClick: () => dismiss(() => onSelect(index)),
            }, index)),
            !visible.length && query && V.jsx('p', { className: 'lmn-empty-message', children: '没有匹配的章节' }),
          ],
        }),
        V.jsx('button', { type: 'button', className: 'lmn-destructive', onClick: () => dismiss(onRemove), children: '移除书籍' }),
      ],
    }),
  })
}

function LumenRow({ icon, tone, label, detail, value, status, selected, onClick }) {
  const tag = onClick ? 'button' : 'div'
  return V.jsxs(tag, {
    type: onClick ? 'button' : undefined, className: 'lmn-row', onClick,
    'aria-pressed': selected,
    children: [
      icon && V.jsx(LumenTile, { icon, tone }),
      V.jsxs('span', {
        className: 'lmn-row-label',
        children: [V.jsx('strong', { children: label }), detail && V.jsx('small', { children: detail })],
      }),
      status ? V.jsx('span', { className: 'lmn-connection', 'data-connected': status === 'ready', role: 'status',
        children: status === 'ready' ? '已连接' : status === 'loading' ? '连接中' : '待连接' }) :
        value && V.jsx('span', { className: 'lmn-row-value', children: value }),
      selected ? V.jsx(LumenIcon, { name: 'check', size: 17 })
        : onClick && selected === undefined && V.jsx(LumenIcon, { name: 'right', size: 15 }),
    ],
  })
}

function LumenDisclosure({ icon, tone, title, children }) {
  return V.jsxs('details', {
    className: 'lmn-disclosure',
    children: [
      V.jsxs('summary', {
        className: 'lmn-row',
        children: [
          V.jsx(LumenTile, { icon, tone }),
          V.jsx('span', { className: 'lmn-row-label', children: V.jsx('strong', { children: title }) }),
          V.jsx(LumenIcon, { name: 'down', size: 15 }),
        ],
      }),
      V.jsx('div', { className: 'lmn-disclosure-content', children }),
    ],
  })
}

function LumenSettings({ settings, onChange, models, onModel, onBack, status, children }) {
  const custom = Boolean(settings.apiBaseUrl.trim() || settings.apiKey.trim())
  return V.jsxs('section', {
    className: 'page-screen lmn-page lmn-settings-view',
    children: [
      V.jsx(LumenPageNav, {
        onBack,
        trailing: V.jsx('button', { type: 'button', className: 'lmn-done', onClick: onBack, children: '完成' }),
      }),
      V.jsx('div', {
        className: 'lmn-page-scroll',
        children: V.jsxs('div', {
          className: 'lmn-settings-body',
          children: [
            V.jsx('h1', { className: 'lmn-large-title', children: '设置' }),
            V.jsxs('section', {
              className: 'lmn-settings-group',
              children: [
                V.jsx('h2', { children: '模型与服务' }),
                V.jsxs('div', {
                  className: 'lmn-card lmn-grouped',
                  children: [
                    V.jsx(LumenRow, { icon: 'provider', label: custom ? '自定义服务' : 'OpenCode Go', detail: '模型服务', status }),
                    V.jsx(LumenRow, { icon: 'chip', tone: 'blue', label: '默认模型', value: ge(settings.defaultModel, models), onClick: onModel }),
                  ],
                }),
              ],
            }),
            V.jsx(LumenUsage, { detailed: true }),
            V.jsxs('div', {
              className: 'lmn-card lmn-grouped',
              children: [
                V.jsx(LumenDisclosure, { icon: 'provider', title: '自定义接口', children: V.jsx(LumenProviderForm, { settings, onChange }) }),
                V.jsx(LumenDisclosure, { icon: 'sliders', tone: 'orange', title: '高级设置', children }),
              ],
            }),
          ],
        }),
      }),
    ],
  })
}

function LumenProviderForm({ settings, onChange }) {
  const [base, setBase] = f.useState(settings.apiBaseUrl)
  const [key, setKey] = f.useState(settings.apiKey)
  const [message, setMessage] = f.useState('')
  function save(event) {
    event.preventDefault()
    const apiBaseUrl = base.trim()
    const apiKey = key.trim()
    if (apiBaseUrl && (!/^https:\/\//i.test(apiBaseUrl) || !apiKey)) {
      setMessage('请填写 HTTPS 接口地址和该服务的 API Key。')
      return
    }
    onChange({ ...settings, apiBaseUrl, apiKey })
    setMessage('已保存。')
  }
  return V.jsxs('form', {
    onSubmit: save, className: 'lmn-provider-form',
    children: [
      V.jsxs('label', {
        children: ['接口地址', V.jsx('input', {
          type: 'url', value: base, placeholder: 'https://服务地址/v1', onChange: event => setBase(event.target.value),
          autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, inputMode: 'url',
        })],
      }),
      V.jsxs('label', {
        children: ['API Key', V.jsx('input', { type: 'password', value: key, autoComplete: 'off', onChange: event => setKey(event.target.value) })],
      }),
      V.jsx('button', { type: 'submit', className: 'lmn-primary', children: '保存并获取模型' }),
      message && V.jsx('p', { role: 'status', children: message }),
    ],
  })
}

function LumenSidebar({ conversations, current, onNew, onOpen, onHistory, onSettings }) {
  return V.jsxs('aside', {
    className: 'lmn-sidebar', 'aria-label': '对话导航',
    children: [
      V.jsxs('div', { className: 'lmn-sidebar-brand', children: [V.jsx(LumenTile, { icon: 'logo', tone: 'brand' }), 'Lumen'] }),
      V.jsxs('button', { type: 'button', className: 'lmn-primary', onClick: onNew, children: [V.jsx(LumenIcon, { name: 'plus', size: 18 }), '新对话'] }),
      conversations.length > 0 && V.jsxs(V.Fragment, {
        children: [
          V.jsx('p', { children: '最近对话' }),
          V.jsx('nav', { children: conversations.slice(0, 12).map(chat =>
            V.jsxs('button', {
              type: 'button', title: chat.title, 'aria-current': chat.id === current ? 'page' : undefined,
              onClick: () => onOpen(chat.id),
              children: [V.jsx(LumenIcon, { name: 'chat', size: 16 }), V.jsx('span', { children: chat.title })],
            }, chat.id)) }),
        ],
      }),
      V.jsx('button', { type: 'button', className: 'lmn-sidebar-history', onClick: onHistory, children: '全部对话' }),
      V.jsxs('button', { type: 'button', className: 'lmn-sidebar-settings', onClick: onSettings, children: [V.jsx(LumenIcon, { name: 'settings', size: 19 }), '设置'] }),
    ],
  })
}

function LumenHistory({ conversations, onBack, onNew, onOpen, onSettings, onSend, onDelete, onStar, onClear }) {
  const [starred, setStarred] = f.useState(false)
  const [menu, setMenu] = f.useState(null)
  const visible = starred ? conversations.filter(chat => chat.starred) : conversations
  return V.jsxs('section', {
    className: 'page-screen lmn-page lmn-history-view',
    children: [
      V.jsx(LumenPageNav, { onBack, trailing: V.jsx(LumenButton, { icon: 'settings', label: '设置', onClick: onSettings }) }),
      V.jsx('div', {
        className: 'lmn-page-scroll',
        children: V.jsxs('div', {
          className: 'lmn-history-body',
          children: [
            V.jsx('h1', { className: 'lmn-large-title', children: '对话' }),
            V.jsxs('div', {
              className: 'lmn-history-actions',
              children: [
                V.jsxs('div', {
                  className: 'lmn-segments', 'aria-label': '筛选对话',
                  children: [
                    V.jsx('button', { type: 'button', 'aria-pressed': !starred, onClick: () => setStarred(false), children: '全部' }),
                    V.jsx('button', { type: 'button', 'aria-pressed': starred, onClick: () => setStarred(true), children: '收藏' }),
                  ],
                }),
                V.jsxs('button', { type: 'button', className: 'lmn-primary', onClick: onNew,
                  children: [V.jsx(LumenIcon, { name: 'plus', size: 18 }), '新对话'] }),
              ],
            }),
            V.jsx('div', {
              className: 'lmn-history-list',
              children: visible.length ? visible.map(chat => V.jsxs('div', {
                className: 'lmn-history-row lmn-card',
                children: [
                  V.jsxs('button', {
                    type: 'button', onClick: () => onOpen(chat.id), className: 'lmn-history-open',
                    children: [
                      V.jsx(LumenTile, { icon: 'chat' }),
                      V.jsx('span', { children: chat.title }),
                      V.jsx(LumenIcon, { name: 'right', size: 15 }),
                    ],
                  }),
                  V.jsx(LumenButton, { icon: 'more', label: `${chat.title} 的选项`, variant: 'clear', onClick: () => setMenu(chat), hasPopup: 'dialog' }),
                ],
              }, chat.id)) : V.jsx('p', { className: 'lmn-empty-message', children: starred ? '还没有收藏的对话' : '还没有对话' }),
            }),
            conversations.length > 0 && V.jsx('button', {
              type: 'button', className: 'lmn-history-clear', onClick: onClear, children: '清空全部',
            }),
          ],
        }),
      }),
      V.jsx(LumenComposer, { onSend, placeholder: '发消息开启新对话…' }),
      menu && V.jsx(LumenSheet, {
        title: menu.title, onClose: () => setMenu(null),
        children: dismiss => V.jsxs('div', {
          className: 'lmn-sheet-actions',
          children: [
            V.jsx(LumenRow, { icon: 'chat', label: menu.starred ? '取消收藏' : '收藏对话', onClick: () => dismiss(() => onStar(menu.id)) }),
            V.jsx('button', { type: 'button', className: 'lmn-destructive', onClick: () => dismiss(() => onDelete(menu.id)), children: '删除对话' }),
          ],
        }),
      }),
    ],
  })
}

function LumenSignIn({ onLogin }) {
  const [key, setKey] = f.useState('')
  const [working, setWorking] = f.useState(false)
  const [error, setError] = f.useState('')
  async function submit(event) {
    event.preventDefault()
    if (!key.trim() || working) return
    setWorking(true)
    setError('')
    try {
      setError(await onLogin(key.trim()) || '')
    } finally {
      setWorking(false)
    }
  }
  return V.jsx('section', {
    className: 'page-screen lmn-page lmn-login',
    children: V.jsxs('form', {
      className: 'lmn-login-form', onSubmit: submit,
      children: [
        V.jsx(LumenOrb, {}),
        V.jsx('h1', { children: '进入 Lumen' }),
        V.jsx('p', { children: '输入访问令牌，打开你的个人对话。' }),
        V.jsx('label', { children: ['访问令牌', V.jsx('input', { type: 'password', value: key, onChange: event => setKey(event.target.value), autoComplete: 'current-password' })] }),
        error && V.jsx('p', { className: 'lmn-status-error', role: 'alert', children: error }),
        V.jsx('button', { className: 'lmn-primary', type: 'submit', disabled: working || !key.trim(), children: working ? '正在连接…' : '进入' }),
      ],
    }),
  })
}
