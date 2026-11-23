import { useState } from 'react'
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
          className={cn(
            'mb-6 size-[76px] rounded-[23px]',
            'bg-[radial-gradient(120%_120%_at_28%_18%,#d9e9df_0%,#a9c9b8_38%,#4f7f6c_74%,#2b4f42_100%)]',
            'shadow-[0_1px_0_rgb(255_255_255/50%)_inset,0_16px_40px_-18px_rgb(36_80_68/55%)]',
          )}
        />
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
            className="h-12 w-full rounded-[12px] bg-surface px-3.5 text-[16px] hairline-t hairline-b outline-none focus:ring-2 focus:ring-brand/30"
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
            'mt-5 h-12 w-full rounded-[12px] bg-brand text-[17px] font-medium text-white',
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
