import { create } from 'zustand'
import { sessionsApi } from '../api/sessions'

const TAB_STORAGE_KEY = 'cc-haha-open-tabs'

export type Tab = {
  sessionId: string
  title: string
  status: 'idle' | 'running' | 'error'
}

type TabPersistence = {
  openTabs: Array<{ sessionId: string; title: string }>
  activeTabId: string | null
}

type TabStore = {
  tabs: Tab[]
  activeTabId: string | null

  openTab: (sessionId: string, title: string) => void
  closeTab: (sessionId: string) => void
  setActiveTab: (sessionId: string) => void
  updateTabTitle: (sessionId: string, title: string) => void
  updateTabStatus: (sessionId: string, status: Tab['status']) => void

  saveTabs: () => void
  restoreTabs: () => Promise<void>
}

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (sessionId, title) => {
    const { tabs } = get()
    const existing = tabs.find((t) => t.sessionId === sessionId)
    if (existing) {
      set({ activeTabId: sessionId })
    } else {
      set({
        tabs: [...tabs, { sessionId, title, status: 'idle' }],
        activeTabId: sessionId,
      })
    }
    get().saveTabs()
  },

  closeTab: (sessionId) => {
    const { tabs, activeTabId } = get()
    const index = tabs.findIndex((t) => t.sessionId === sessionId)
    if (index < 0) return

    const newTabs = tabs.filter((t) => t.sessionId !== sessionId)
    let newActiveId = activeTabId

    if (activeTabId === sessionId) {
      if (newTabs.length === 0) {
        newActiveId = null
      } else if (index >= newTabs.length) {
        newActiveId = newTabs[newTabs.length - 1]!.sessionId
      } else {
        newActiveId = newTabs[index]!.sessionId
      }
    }

    set({ tabs: newTabs, activeTabId: newActiveId })
    get().saveTabs()
  },

  setActiveTab: (sessionId) => {
    set({ activeTabId: sessionId })
    get().saveTabs()
  },

  updateTabTitle: (sessionId, title) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.sessionId === sessionId ? { ...t, title } : t)),
    }))
    get().saveTabs()
  },

  updateTabStatus: (sessionId, status) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.sessionId === sessionId ? { ...t, status } : t)),
    }))
  },

  saveTabs: () => {
    const { tabs, activeTabId } = get()
    const data: TabPersistence = {
      openTabs: tabs.map((t) => ({ sessionId: t.sessionId, title: t.title })),
      activeTabId,
    }
    try {
      localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(data))
    } catch { /* noop */ }
  },

  restoreTabs: async () => {
    try {
      const raw = localStorage.getItem(TAB_STORAGE_KEY)
      if (!raw) return

      const data = JSON.parse(raw) as TabPersistence
      if (!data.openTabs || data.openTabs.length === 0) return

      const { sessions } = await sessionsApi.list({ limit: 200 })
      const existingIds = new Set(sessions.map((s) => s.id))

      const validTabs: Tab[] = data.openTabs
        .filter((t) => existingIds.has(t.sessionId))
        .map((t) => ({
          sessionId: t.sessionId,
          title: sessions.find((s) => s.id === t.sessionId)?.title || t.title,
          status: 'idle' as const,
        }))

      if (validTabs.length === 0) return

      const activeId = data.activeTabId && validTabs.some((t) => t.sessionId === data.activeTabId)
        ? data.activeTabId
        : validTabs[0]!.sessionId

      set({ tabs: validTabs, activeTabId: activeId })
    } catch { /* noop */ }
  },
}))
