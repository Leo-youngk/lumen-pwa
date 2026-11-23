/** Three dots that rise in sequence, matching the iOS activity idiom. */
export function TypingIndicator() {
  return (
    <div className="flex h-6 items-center gap-1" role="status" aria-label="正在生成回答">
      {[0, 1, 2].map(index => (
        <span
          key={index}
          className="size-[6px] rounded-full bg-quiet"
          style={{
            animation: 'lumen-bounce 1.15s ease-in-out infinite',
            animationDelay: `${index * 0.14}s`,
          }}
        />
      ))}
    </div>
  )
}
