/**
 * Carta Técnica Operacional: análise de interferências espaciais.
 * O mapa é dominante; o painel organiza consulta, camadas, atributos e exportação.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, Layers3, LoaderCircle, MapPinned, Play, Settings2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  InterferenceLayerInfo,
  InterferenceRecord,
  createInterferenceRuntime,
  portalRoot,
} from '@/lib/interference-analysis'

const storageKey = 'dflegal-interferencia-settings-v1'
const defaultSettings = {
  portalUrl: portalRoot,
  webMapId: 'c69b4e4458c94c8193210e7aa97d24a4',
  clientId: '',
}

const slug = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const downloadDataUrl = (dataUrl: string, filename: string) => {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}
const geometryLabel = (type?: string) => type === 'point' ? 'Ponto' : type === 'polyline' ? 'Linha' : 'Polígono'

export default function Home() {
  const mapRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<Awaited<ReturnType<typeof createInterferenceRuntime>> | null>(null)
  const [settings, setSettings] = useState(() => {
    try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem(storageKey) || '{}') } } catch { return defaultSettings }
  })
  const [showSettings, setShowSettings] = useState(true)
  const [status, setStatus] = useState('Configure o Client ID OAuth e carregue o Web Map de interferências.')
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [layers, setLayers] = useState<InterferenceLayerInfo[]>([])
  const [activeLayerIds, setActiveLayerIds] = useState<string[]>([])
  const [records, setRecords] = useState<InterferenceRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [studyAreaReady, setStudyAreaReady] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)

  const groupedLayers = useMemo(() => {
    const groups = new Map<string, InterferenceLayerInfo[]>()
    layers.forEach((layer) => {
      const prefix = layer.title.includes(' - ') ? layer.title.split(' - ')[0] : layer.title
      groups.set(prefix, [...(groups.get(prefix) || []), layer])
    })
    return Array.from(groups.entries())
  }, [layers])

  useEffect(() => () => runtimeRef.current?.destroy(), [])

  const loadMap = async () => {
    setLoading(true)
    setErrors([])
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings))
      const runtime = await createInterferenceRuntime(mapRef.current!, settings)
      runtimeRef.current = runtime
      setLayers(runtime.layers)
      setActiveLayerIds(runtime.layers.filter((entry) => entry.visible).map((entry) => entry.id))
      setShowSettings(false)
      setStatus(`Web Map carregado. ${runtime.layers.length} camadas vetoriais disponíveis para análise.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível carregar o Web Map.'
      setStatus(message)
      setErrors([message.includes('redirect') ? `${message} Cadastre exatamente a URL atual do GitHub Pages nas Redirect URLs do Client ID OAuth.` : message])
    } finally { setLoading(false) }
  }

  const drawAndAnalyze = async () => {
    if (!runtimeRef.current) { setShowSettings(true); return }
    setAnalyzing(true)
    setErrors([])
    try {
      setStatus('Desenhe o polígono da área de estudo no mapa.')
      const studyArea = await runtimeRef.current.drawStudyArea()
      if (!studyArea) throw new Error('A área de estudo não foi concluída.')
      setStudyAreaReady(true)
      setStatus('Analisando interseções nas camadas selecionadas…')
      const result = await runtimeRef.current.analyzeStudyArea(studyArea, activeLayerIds)
      setRecords(result.records)
      setErrors(result.errors)
      setStatus(`${result.records.length} interferência(s) encontrada(s) em ${new Set(result.records.map((record) => record.layerId)).size} camada(s).`)
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Falha na análise espacial.'])
      setStatus('A análise não foi concluída.')
    } finally { setAnalyzing(false) }
  }

  const selectRecord = async (record: InterferenceRecord) => {
    setSelectedId(record.id)
    await runtimeRef.current?.highlightRecord(record)
  }

  const exportRecord = async (record: InterferenceRecord) => {
    if (!runtimeRef.current) return
    setExportingId(record.id)
    try {
      const dataUrl = await runtimeRef.current.captureRecord(record)
      downloadDataUrl(dataUrl, `interferencia-${slug(record.layerTitle)}-${slug(record.id)}.png`)
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Não foi possível gerar o PNG desta interferência.'])
    } finally { setExportingId(null) }
  }

  const clear = () => {
    runtimeRef.current?.clearAnalysis()
    setRecords([]); setErrors([]); setSelectedId(null); setStudyAreaReady(false)
    setStatus('Área de estudo e resultados temporários removidos.')
  }

  return (
    <main className="relative h-screen overflow-hidden bg-[#071E27] text-[#F4F0E8]">
      <div ref={mapRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(7,30,39,.96)_0%,rgba(7,30,39,.78)_22%,transparent_48%)]" />
      <aside className="relative z-10 flex h-full w-[390px] flex-col border-r border-[#31515A] bg-[#0B303A]/95 shadow-2xl backdrop-blur-md">
        <header className="border-b border-[#31515A] px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.28em] text-[#F2B134]">DF Legal · inteligência territorial</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight">Análise de<br /><span className="text-[#F2B134]">Interferências</span></h1>
            </div>
            <MapPinned className="mt-1 text-[#F2B134]" size={28} />
          </div>
          <p className="mt-3 text-xs leading-5 text-[#B8C9CC]">Cruze uma área de estudo com as camadas do Web Map e identifique conflitos de pontos, linhas e polígonos.</p>
        </header>

        <section className="border-b border-[#31515A] px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#F2B134]">Status</p><p className="mt-1 text-sm text-[#DCE7E8]">{status}</p></div>
            {loading || analyzing ? <LoaderCircle className="shrink-0 animate-spin text-[#F2B134]" size={20} /> : <span className="h-2.5 w-2.5 rounded-full bg-[#F2B134]" />}
          </div>
          {errors.length > 0 && <div className="mt-3 space-y-2 rounded border border-[#D62D35]/50 bg-[#D62D35]/15 p-3 text-xs text-[#FFD6D8]"><AlertTriangle size={15} className="mb-1" />{errors.slice(0, 3).map((error) => <p key={error}>{error}</p>)}</div>}
        </section>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex items-center justify-between"><h2 className="text-xs font-bold uppercase tracking-[.2em] text-[#B8C9CC]">Camadas para consulta</h2><Layers3 size={16} className="text-[#F2B134]" /></div>
          <p className="mt-2 text-xs leading-5 text-[#8FA9AE]">Selecione as camadas que devem participar da análise. O mapa operacional não é alterado.</p>
          {!layers.length && <div className="mt-4 rounded border border-dashed border-[#55747B] p-4 text-xs text-[#B8C9CC]">Carregue o Web Map para listar as camadas vetoriais.</div>}
          <div className="mt-4 space-y-4">
            {groupedLayers.map(([group, entries]) => <div key={group}>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[.18em] text-[#F2B134]">{group}</p>
              <div className="space-y-1.5">{entries.map((entry: InterferenceLayerInfo) => <label key={entry.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs text-[#DCE7E8] transition hover:bg-white/5">
                <input type="checkbox" checked={activeLayerIds.includes(entry.id)} onChange={(event) => setActiveLayerIds((current) => event.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id))} className="mt-0.5 accent-[#F2B134]" />
                <span className="min-w-0"><span className="block truncate">{entry.title}</span><span className="text-[10px] text-[#8FA9AE]">{geometryLabel(entry.geometryType)}</span></span>
              </label>)}</div>
            </div>)}
          </div>

          {records.length > 0 && <section className="mt-6 border-t border-[#31515A] pt-4"><div className="flex items-center justify-between"><h2 className="text-xs font-bold uppercase tracking-[.2em] text-[#B8C9CC]">Interferências detectadas</h2><span className="rounded-full bg-[#F2B134] px-2 py-0.5 text-[10px] font-bold text-[#172B30]">{records.length}</span></div><p className="mt-2 text-[11px] text-[#8FA9AE]">Clique em um resultado para destacar no mapa e exportar sua prancha individual.</p><div className="mt-3 space-y-2">{records.map((record) => <article key={record.id} className={`rounded border p-3 transition ${selectedId === record.id ? 'border-[#F2B134] bg-[#F2B134]/15' : 'border-[#31515A] bg-[#0B303A]/70'}`}><button className="w-full text-left" onClick={() => selectRecord(record)}><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-bold text-[#F4F0E8]">{record.layerTitle}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-[#F2B134]">{geometryLabel(record.geometryType)}</p></div><span className="text-[10px] text-[#8FA9AE]">{Object.keys(record.attributes).length} atributos</span></div><p className="mt-2 line-clamp-2 text-[11px] text-[#B8C9CC]">{Object.entries(record.attributes).slice(0, 2).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</p></button><Button size="sm" variant="outline" className="mt-3 h-7 w-full border-[#55747B] bg-transparent text-[11px] text-[#F4F0E8] hover:bg-[#F2B134] hover:text-[#172B30]" disabled={exportingId === record.id} onClick={() => exportRecord(record)}>{exportingId === record.id ? <LoaderCircle className="mr-2 animate-spin" size={13} /> : <Download className="mr-2" size={13} />}Baixar PNG da interferência</Button></article>)}</div></section>}
        </div>

        <footer className="space-y-2 border-t border-[#31515A] px-5 py-4"><div className="grid grid-cols-2 gap-2"><Button onClick={drawAndAnalyze} disabled={analyzing || !runtimeRef.current} className="bg-[#F2B134] text-[#172B30] hover:bg-[#FFD166]"><Play className="mr-2" size={15} />{analyzing ? 'Analisando…' : 'Desenhar e analisar'}</Button><Button onClick={clear} variant="outline" className="border-[#55747B] bg-transparent text-[#F4F0E8] hover:bg-white/10"><Trash2 className="mr-2" size={15} />Limpar</Button></div><Button onClick={() => setShowSettings((value) => !value)} variant="ghost" className="w-full justify-start text-[#B8C9CC] hover:bg-white/5 hover:text-white"><Settings2 className="mr-2" size={15} />Configuração do Portal e Web Map</Button></footer>
      </aside>

      {showSettings && <div className="absolute right-6 top-6 z-20 w-[420px] rounded-lg border border-[#55747B] bg-[#F4F0E8] p-5 text-[#173C46] shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#B06D1D]">Conexão sem alterar o mapa</p><h2 className="mt-1 text-xl font-black">Web Map de interferências</h2></div><Settings2 className="text-[#B06D1D]" size={20} /></div><p className="mt-2 text-xs leading-5 text-[#526166]">A aplicação consulta o item operacional e cria somente gráficos temporários para a área de estudo e os destaques.</p><div className="mt-4 space-y-3"><label className="block text-xs font-bold">Portal Enterprise<Input value={settings.portalUrl} onChange={(event) => setSettings({ ...settings, portalUrl: event.target.value })} className="mt-1 bg-white" /></label><label className="block text-xs font-bold">ID do Web Map<Input value={settings.webMapId} onChange={(event) => setSettings({ ...settings, webMapId: event.target.value })} className="mt-1 bg-white" /></label><label className="block text-xs font-bold">Client ID OAuth<Input value={settings.clientId} onChange={(event) => setSettings({ ...settings, clientId: event.target.value })} placeholder="credencial OAuth do Portal" className="mt-1 bg-white" /></label></div><p className="mt-3 text-[11px] leading-4 text-[#526166]">A Redirect URL desta aplicação é <strong>{window.location.origin}{window.location.pathname}</strong>. Ela precisa estar cadastrada na credencial OAuth; caso contrário, o Portal retorna <strong>Invalid redirect_uri</strong>.</p><Button onClick={loadMap} disabled={loading} className="mt-4 w-full bg-[#173C46] text-white hover:bg-[#0B303A]">{loading ? <LoaderCircle className="mr-2 animate-spin" size={16} /> : <MapPinned className="mr-2" size={16} />}Entrar e carregar Web Map</Button></div>}

      <div className="absolute bottom-4 right-5 z-10 rounded bg-[#F4F0E8]/90 px-3 py-2 text-[10px] text-[#526166] shadow"><strong>Legenda:</strong> área de estudo em vermelho · ponto destacado em azul · linha em ocre · polígono em vermelho · seleção em amarelo</div>
    </main>
  )
}
