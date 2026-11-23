import { Component, type ReactNode } from 'react'

/** Preserve the answer text if a rendering plugin fails. */
export class MathErrorBoundary extends Component<
  { children: ReactNode; fallback: string },
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
      return <div className="whitespace-pre-wrap">{this.props.fallback}</div>
    }
    return this.props.children
  }
}
