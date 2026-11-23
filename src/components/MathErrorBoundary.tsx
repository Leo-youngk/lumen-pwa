import { Component, type ReactNode } from 'react'

/**
 * Keeps a malformed formula from taking the message down.
 *
 * rehype-katex already runs with `throwOnError: false`, so this is a backstop
 * for anything the parser still lets through — a half-streamed `$$` at the end
 * of a chunk, for instance. Falling back to the raw text is always better than
 * an empty box where an answer should be.
 */
export class MathErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    // Swallowed on purpose: the fallback below is the entire recovery path.
  }

  render() {
    if (this.state.failed) {
      return <div className="text-[13px] text-quiet">公式无法渲染</div>
    }
    return this.props.children
  }
}
