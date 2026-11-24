import type { Conversation } from './store'

const DAY = 86_400_000

/**
 * Bucket conversations into the day ranges an iOS list uses.
 *
 * Lives here rather than next to the drawer: a component module that also
 * exports a plain function breaks React Fast Refresh for the whole file, and
 * this one is shared with the history screen anyway.
 */
export function groupByDay(items: Conversation[]) {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const today: Conversation[] = []
  const yesterday: Conversation[] = []
  const week: Conversation[] = []
  const older: Conversation[] = []

  for (const item of items) {
    const age = startOfToday - item.updatedAt
    if (item.updatedAt >= startOfToday) today.push(item)
    else if (age < DAY) yesterday.push(item)
    else if (age < 7 * DAY) week.push(item)
    else older.push(item)
  }

  return [
    { label: '今天', items: today },
    { label: '昨天', items: yesterday },
    { label: '7 天内', items: week },
    { label: '更早', items: older },
  ].filter((group) => group.items.length > 0)
}
