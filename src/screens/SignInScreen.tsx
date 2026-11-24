import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { useLumen } from '@/state/LumenContext'
import { cn } from '@/lib/cn'

export function SignInScreen() {
  const { signIn } = useLumen()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!token.trim() || working) return
    setWorking(true)
    setError('')
    const failure = await signIn(token.trim())
    if (failure) setError(failure)
    setWorking(false)
  }

  return (
    <div className="scroll-pane flex h-full flex-col px-6 py-5">
      <form onSubmit={submit} className="m-auto w-full max-w-[380px] shrink-0">
        <div
          aria-hidden="true"
          className="mb-6 grid size-[64px] place-items-center rounded-[18px] bg-ink text-brand-contrast"
        >
          <Icon name="logo" size={30} strokeWidth={1.6} />
        </div>
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em]">进入 Lumen</h1>
        <p className="mt-2 mb-7 text-[15px] leading-relaxed text-quiet">
          输入访问令牌，打开你的个人对话与书库。
        </p>

        <label className="block">
          <span className="section-label mb-1.5 block">访问令牌</span>
          <input
            type="password"
            value={token}
            onChange={event => setToken(event.target.value)}
            autoComplete="current-password"
            enterKeyHint="go"
            className="h-12 w-full rounded-[12px] bg-field px-3.5 text-[16px] outline-none focus:ring-2 focus:ring-brand/25"
          />
        </label>

        {error ? (
          <p role="alert" className="mt-3 rounded-[10px] bg-accent-orange px-3 py-2 text-[13.5px] text-accent-orange-ink">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={working || !token.trim()}
          className={cn(
            'mt-5 h-12 w-full rounded-[12px] bg-brand text-[17px] font-medium text-brand-contrast',
            'transition-[opacity,transform] duration-150 ease-(--ease-tap) active:scale-[0.985]',
            'disabled:opacity-40',
          )}
        >
          {working ? '正在连接…' : '进入'}
        </button>
      </form>
    </div>
  )
}
