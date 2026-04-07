import { useState, useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useProviderStore } from '../stores/providerStore'
import { useUIStore } from '../stores/uiStore'
import { Modal } from '../components/shared/Modal'
import { Input } from '../components/shared/Input'
import { Button } from '../components/shared/Button'
import type { PermissionMode, EffortLevel } from '../types/settings'
import { PROVIDER_PRESETS } from '../config/providerPresets'
import type { SavedProvider, UpdateProviderInput, ProviderTestResult, ModelMapping } from '../types/provider'

type SettingsTab = 'providers' | 'permissions' | 'general'

export function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers')
  const setActiveView = useUIStore((s) => s.setActiveView)

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-surface)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--color-border)]">
        <button
          onClick={() => setActiveView('code')}
          className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors text-[var(--color-text-secondary)]"
        >
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        </button>
        <h1 className="text-lg font-bold text-[var(--color-text-primary)]">Settings</h1>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Tab navigation */}
        <div className="w-48 border-r border-[var(--color-border)] py-3 flex-shrink-0">
          <TabButton icon="dns" label="Providers" active={activeTab === 'providers'} onClick={() => setActiveTab('providers')} />
          <TabButton icon="shield" label="Permissions" active={activeTab === 'permissions'} onClick={() => setActiveTab('permissions')} />
          <TabButton icon="tune" label="General" active={activeTab === 'general'} onClick={() => setActiveTab('general')} />
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {activeTab === 'providers' && <ProviderSettings />}
          {activeTab === 'permissions' && <PermissionSettings />}
          {activeTab === 'general' && <GeneralSettings />}
        </div>
      </div>
    </div>
  )
}

function TabButton({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors ${
        active
          ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] font-medium'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      {label}
    </button>
  )
}

// ─── Provider Settings ──────────────────────────────────────

function ProviderSettings() {
  const { providers, activeId, isLoading, fetchProviders, deleteProvider, activateProvider, activateOfficial, testProvider } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const [editingProvider, setEditingProvider] = useState<SavedProvider | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; result?: ProviderTestResult }>>({})

  useEffect(() => { fetchProviders() }, [fetchProviders])

  const handleDelete = async (provider: SavedProvider) => {
    if (activeId === provider.id) return
    if (!window.confirm(`Delete provider "${provider.name}"? This cannot be undone.`)) return
    await deleteProvider(provider.id).catch(console.error)
  }

  const handleTest = async (provider: SavedProvider) => {
    setTestResults((r) => ({ ...r, [provider.id]: { loading: true } }))
    try {
      const result = await testProvider(provider.id)
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result } }))
    } catch {
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result: { success: false, latencyMs: 0, error: 'Request failed' } } }))
    }
  }

  const handleActivate = async (id: string) => {
    await activateProvider(id)
    await fetchSettings()
  }

  const handleActivateOfficial = async () => {
    await activateOfficial()
    await fetchSettings()
  }

  const isOfficialActive = activeId === null

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Providers</h2>
          <p className="text-sm text-[var(--color-text-tertiary)] mt-0.5">Manage API providers for model access.</p>
        </div>
        <Button size="sm" onClick={() => setShowCreateModal(true)}>
          <span className="material-symbols-outlined text-[16px]">add</span>
          Add Provider
        </Button>
      </div>

      {/* Official provider — always visible at top */}
      <div
        className={`relative flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all mb-2 ${
          isOfficialActive
            ? 'border-[var(--color-brand)] bg-[var(--color-primary-fixed)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-border-focus)] cursor-pointer'
        }`}
        onClick={() => !isOfficialActive && handleActivateOfficial()}
      >
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isOfficialActive ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">Claude Official</span>
            {isOfficialActive && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[var(--color-brand)] text-white leading-none">ACTIVE</span>
            )}
          </div>
          <div className="text-xs text-[var(--color-text-tertiary)] mt-0.5">Anthropic native — no API key required</div>
        </div>
      </div>

      {/* Saved providers */}
      {isLoading && providers.length === 0 ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {providers.map((provider) => {
            const isActive = activeId === provider.id
            const test = testResults[provider.id]
            const preset = PROVIDER_PRESETS.find((p) => p.id === provider.presetId)
            return (
              <div
                key={provider.id}
                className={`relative flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all group ${
                  isActive
                    ? 'border-[var(--color-brand)] bg-[var(--color-primary-fixed)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-border-focus)]'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isActive ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{provider.name}</span>
                    {preset && preset.id !== 'custom' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)] leading-none">{preset.name}</span>
                    )}
                    {isActive && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[var(--color-brand)] text-white leading-none">ACTIVE</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-text-tertiary)] truncate mt-0.5">
                    {provider.baseUrl} &middot; {provider.models.main}
                  </div>
                  {test && !test.loading && test.result && (
                    <div className={`text-xs mt-1 ${test.result.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                      {test.result.success ? `Connected (${test.result.latencyMs}ms)` : `Failed: ${test.result.error}`}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  {!isActive && (
                    <Button variant="ghost" size="sm" onClick={() => handleActivate(provider.id)}>Activate</Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => handleTest(provider)} loading={test?.loading}>Test</Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingProvider(provider)}>Edit</Button>
                  {!isActive && (
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(provider)} className="text-[var(--color-error)] hover:text-[var(--color-error)]">Delete</Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Modal — conditionally rendered so state resets on close */}
      {showCreateModal && (
        <ProviderFormModal open={true} onClose={() => setShowCreateModal(false)} mode="create" />
      )}

      {/* Edit Modal */}
      {editingProvider && (
        <ProviderFormModal key={editingProvider.id} open={true} onClose={() => setEditingProvider(null)} mode="edit" provider={editingProvider} />
      )}
    </div>
  )
}

// ─── Provider Form Modal ──────────────────────────────────────

type ProviderFormProps = {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  provider?: SavedProvider
}

function ProviderFormModal({ open, onClose, mode, provider }: ProviderFormProps) {
  const { createProvider, updateProvider, testConfig } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)

  const availablePresets = PROVIDER_PRESETS.filter((p) => p.id !== 'official')
  const initialPreset = provider ? availablePresets.find((p) => p.id === provider.presetId) || availablePresets.at(-1)! : availablePresets[0]

  const [selectedPreset, setSelectedPreset] = useState(initialPreset)
  const [name, setName] = useState(provider?.name ?? initialPreset.name)
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? initialPreset.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [notes, setNotes] = useState(provider?.notes ?? '')
  const [models, setModels] = useState<ModelMapping>(provider?.models ?? { ...initialPreset.defaultModels })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [settingsJson, setSettingsJson] = useState('')
  const [settingsJsonError, setSettingsJsonError] = useState<string | null>(null)

  // Load current settings.json and merge provider env vars
  useEffect(() => {
    import('../api/settings').then(({ settingsApi }) => {
      settingsApi.getUser().then((settings) => {
        const merged = {
          ...settings,
          env: {
            ...((settings.env as Record<string, string>) || {}),
            ANTHROPIC_BASE_URL: baseUrl,
            ANTHROPIC_AUTH_TOKEN: apiKey || '(your API key)',
            ANTHROPIC_MODEL: models.main,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: models.haiku,
            ANTHROPIC_DEFAULT_SONNET_MODEL: models.sonnet,
            ANTHROPIC_DEFAULT_OPUS_MODEL: models.opus,
          },
        }
        setSettingsJson(JSON.stringify(merged, null, 2))
      }).catch(() => {
        setSettingsJson(JSON.stringify({}, null, 2))
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPreset.id])

  const handlePresetChange = (preset: typeof initialPreset) => {
    setSelectedPreset(preset)
    setName(preset.name)
    setBaseUrl(preset.baseUrl)
    setModels({ ...preset.defaultModels })
    setTestResult(null)
  }

  const isCustom = selectedPreset.id === 'custom'
  const canSubmit = name.trim() && baseUrl.trim() && (mode === 'edit' || apiKey.trim()) && models.main.trim() && !settingsJsonError

  const handleSubmit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      // Write the edited settings.json first (for all presets including official)
      if (settingsJson.trim()) {
        try {
          const parsed = JSON.parse(settingsJson)
          const { settingsApi } = await import('../api/settings')
          await settingsApi.updateUser(parsed)
        } catch {
          // JSON validation already prevents this
        }
      }

      if (mode === 'create') {
        await createProvider({
          presetId: selectedPreset.id,
          name: name.trim(),
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim(),
          models,
          notes: notes.trim() || undefined,
        })
      } else if (provider) {
        const input: UpdateProviderInput = {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          models,
          notes: notes.trim() || undefined,
        }
        if (apiKey.trim()) input.apiKey = apiKey.trim()
        await updateProvider(provider.id, input)
      }
      await fetchSettings()
      onClose()
    } catch (err) {
      console.error('Failed to save provider:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleTest = async () => {
    if (!baseUrl.trim() || !models.main.trim()) return
    setIsTesting(true)
    setTestResult(null)
    try {
      let result: ProviderTestResult
      if (mode === 'edit' && provider && !apiKey.trim()) {
        result = await useProviderStore.getState().testProvider(provider.id)
      } else {
        if (!apiKey.trim()) return
        result = await testConfig({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), modelId: models.main.trim() })
      }
      setTestResult(result)
    } catch {
      setTestResult({ success: false, latencyMs: 0, error: 'Request failed' })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'create' ? 'Add Provider' : 'Edit Provider'}
      width={720}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={isSubmitting}>
            {mode === 'create' ? 'Add' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Preset chips */}
        {mode === 'create' && (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">Preset</label>
            <div className="flex flex-wrap gap-2">
              {availablePresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handlePresetChange(preset)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                    selectedPreset.id === preset.id
                      ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-focus)]'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Provider name" />

        <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes..." />

        {/* Base URL */}
        {isCustom || mode === 'edit' ? (
          <Input label="Base URL" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/anthropic" />
        ) : (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-1 block">Base URL</label>
            <div className="text-xs text-[var(--color-text-tertiary)] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] border border-[var(--color-border)]">
              {baseUrl}
            </div>
          </div>
        )}

        <Input
          label={mode === 'edit' ? 'API Key (leave blank to keep current)' : 'API Key'}
          required={mode === 'create'}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={mode === 'edit' ? '****' : 'sk-...'}
        />

        {/* Model Mapping */}
        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">Model Mapping</label>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Main Model" required value={models.main} onChange={(e) => setModels({ ...models, main: e.target.value })} placeholder="Model ID" />
            <Input label="Haiku Model" value={models.haiku} onChange={(e) => setModels({ ...models, haiku: e.target.value })} placeholder="Same as main" />
            <Input label="Sonnet Model" value={models.sonnet} onChange={(e) => setModels({ ...models, sonnet: e.target.value })} placeholder="Same as main" />
            <Input label="Opus Model" value={models.opus} onChange={(e) => setModels({ ...models, opus: e.target.value })} placeholder="Same as main" />
          </div>
        </div>

        {/* Test connection */}
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleTest} loading={isTesting} disabled={!baseUrl.trim() || !models.main.trim()}>
            Test Connection
          </Button>
          {testResult && (
            <span className={`text-xs ${testResult.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
              {testResult.success ? `Connected (${testResult.latencyMs}ms)` : `Failed: ${testResult.error}`}
            </span>
          )}
        </div>

        {/* Settings JSON — editable, shown for all presets including official */}
        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">Settings JSON</label>
          <textarea
            value={settingsJson}
            onChange={(e) => {
              setSettingsJson(e.target.value)
              try {
                JSON.parse(e.target.value)
                setSettingsJsonError(null)
              } catch (err) {
                setSettingsJsonError(err instanceof Error ? err.message : 'Invalid JSON')
              }
            }}
            rows={16}
            spellCheck={false}
            className={`w-full text-xs px-3 py-3 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] border font-mono leading-relaxed resize-y text-[var(--color-text-secondary)] outline-none ${
              settingsJsonError
                ? 'border-[var(--color-error)] focus:border-[var(--color-error)]'
                : 'border-[var(--color-border)] focus:border-[var(--color-border-focus)]'
            }`}
          />
          {settingsJsonError && (
            <p className="text-[11px] text-[var(--color-error)] mt-1">JSON syntax error: {settingsJsonError}</p>
          )}
          <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">~/.claude/settings.json — edit directly, will be written on save.</p>
        </div>
      </div>
    </Modal>
  )
}


// ─── Permission Settings ──────────────────────────────────────

function PermissionSettings() {
  const { permissionMode, setPermissionMode } = useSettingsStore()

  const MODES: Array<{ mode: PermissionMode; icon: string; label: string; desc: string }> = [
    { mode: 'default', icon: 'verified_user', label: 'Ask permissions', desc: 'Ask before executing tools' },
    { mode: 'acceptEdits', icon: 'edit_note', label: 'Accept edits', desc: 'Auto-approve file edits, ask for others' },
    { mode: 'plan', icon: 'architecture', label: 'Plan mode', desc: 'Think and plan without executing' },
    { mode: 'bypassPermissions', icon: 'bolt', label: 'Bypass all', desc: 'Skip all permission checks (dangerous)' },
  ]

  return (
    <div className="max-w-xl">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">Permission Mode</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-4">Controls how tool execution permissions are handled.</p>

      <div className="flex flex-col gap-2">
        {MODES.map(({ mode, icon, label, desc }) => {
          const isSelected = permissionMode === mode
          return (
            <button
              key={mode}
              onClick={() => setPermissionMode(mode)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                isSelected
                  ? 'border-[var(--color-brand)] bg-[var(--color-primary-fixed)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <span className="material-symbols-outlined text-[20px] text-[var(--color-text-secondary)]">{icon}</span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">{label}</div>
                <div className="text-xs text-[var(--color-text-tertiary)]">{desc}</div>
              </div>
              {isSelected && (
                <span className="material-symbols-outlined text-[18px] text-[var(--color-brand)]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  check_circle
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── General Settings ──────────────────────────────────────

function GeneralSettings() {
  const { effortLevel, setEffort } = useSettingsStore()

  const EFFORT_LABELS: Record<EffortLevel, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    max: 'Max',
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">Effort Level</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">Controls how much computation the model uses.</p>
      <div className="flex gap-2">
        {(['low', 'medium', 'high', 'max'] as EffortLevel[]).map((level) => (
          <button
            key={level}
            onClick={() => setEffort(level)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
              effortLevel === level
                ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            {EFFORT_LABELS[level]}
          </button>
        ))}
      </div>
    </div>
  )
}
