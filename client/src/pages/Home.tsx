/**
 * Carta Técnica Operacional: análise de interferências espaciais.
 * O mapa é dominante; o painel organiza consulta, camadas, atributos e exportação.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Polygon from '@arcgis/core/geometry/Polygon'
import { AlertTriangle, Download, Layers3, LoaderCircle, MapPinned, Play, Settings2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  InterferenceLayerInfo,
  InterferenceRecord,
  CaptureResult,
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
const symbolColor = (symbol?: __esri.Symbol, fallback = '#E63946') => {
  const color = (symbol as any)?.color
  if (color?.toRgba) {
    const [r, g, b, a] = color.toRgba()
    return `rgba(${r},${g},${b},${a ?? 1})`
  }
  if (Array.isArray(color)) return `rgba(${color[0]},${color[1]},${color[2]},${(color[3] ?? 255) / 255})`
  return fallback
}

const loadImage = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('Não foi possível preparar a imagem do mapa.'))
  image.src = dataUrl
})

const drawCoordinateGrid = (context: CanvasRenderingContext2D, capture: CaptureResult, mapX: number, mapY: number, mapW: number, mapH: number, drawW: number, drawH: number) => {
  if (!capture.extent) return
  const { xmin, ymin, xmax, ymax } = capture.extent
  const gridCount = 5
  context.save()
  context.strokeStyle = 'rgba(23,60,70,.28)'
  context.fillStyle = '#173C46'
  context.lineWidth = 1
  context.font = '600 16px Arial'
  context.textAlign = 'center'
  for (let i = 0; i <= gridCount; i += 1) {
    const px = mapX + (drawW * i) / gridCount
    const py = mapY + (drawH * i) / gridCount
    context.beginPath(); context.moveTo(px, mapY); context.lineTo(px, mapY + drawH); context.stroke()
    context.beginPath(); context.moveTo(mapX, py); context.lineTo(mapX + drawW, py); context.stroke()
    // Topo horizontal: somente X no topo.
    const xValue = xmin + ((xmax - xmin) * i) / gridCount
    context.fillText(xValue.toFixed(0), px, mapY - 12)
    // Lado esquerdo vertical: somente Y, crescendo visualmente de baixo para cima.
    const yValue = ymax - ((ymax - ymin) * i) / gridCount
    context.textAlign = 'right'
    context.fillText(yValue.toFixed(0), mapX - 12, py + 6)
    context.textAlign = 'center'
  }
  context.restore()
}

const drawBoardChrome = (context: CanvasRenderingContext2D, title: string, subtitle: string, width: number, height: number) => {
  context.fillStyle = '#F4F0E8'; context.fillRect(0, 0, width, height)
  context.strokeStyle = '#263D42'; context.lineWidth = 5; context.strokeRect(18, 18, width - 36, height - 36)
  context.fillStyle = '#0B303A'; context.fillRect(28, 28, width - 56, 124)
  context.fillStyle = '#F2B134'; context.font = '700 38px Arial'; context.fillText('DF LEGAL · ANÁLISE DE INTERFERÊNCIAS', 62, 80)
  context.fillStyle = '#FFFFFF'; context.font = '700 26px Arial'; context.fillText(title, 62, 124)
  context.fillStyle = '#526166'; context.font = '600 18px Arial'; context.fillText(subtitle, 62, height - 28)
}

const drawLegend = (context: CanvasRenderingContext2D, records: InterferenceRecord[], x: number, y: number, maxWidth: number) => {
  const legendEntries = Array.from(new Map(records.flatMap((record) =>
    (record.involvedLayers || [{ id: record.layerId, title: record.layerTitle, symbol: record.symbol, geometryType: record.geometryType }])
      .map((entry) => [entry.id, { ...record, ...entry }] as const),
  )).values())
  context.fillStyle = '#173C46'; context.font = '700 18px Arial'; context.fillText('LEGENDA DAS CAMADAS PARTICIPANTES', x, y)
  let legendX = x
  let legendY = y + 30
  legendEntries.forEach((record) => {
    const label = record.layerTitle.slice(0, 40)
    const itemWidth = Math.min(420, 48 + label.length * 9)
    if (legendX + itemWidth > x + maxWidth) { legendX = x; legendY += 30 }
    const swatch = symbolColor(record.symbol, record.geometryType === 'point' ? '#168AAD' : record.geometryType === 'polyline' ? '#F2B134' : '#E63946')
    context.fillStyle = swatch; context.fillRect(legendX, legendY - 15, 24, 16)
    context.strokeStyle = '#526166'; context.lineWidth = 1; context.strokeRect(legendX, legendY - 15, 24, 16)
    context.fillStyle = '#526166'; context.font = '600 16px Arial'; context.fillText(label, legendX + 34, legendY)
    legendX += itemWidth
  })
}

const composeInterferenceBoard = async (capture: CaptureResult, records: InterferenceRecord[], format: 'png' | 'jpg') => {
  const image = await loadImage(capture.dataUrl)
  const canvas = document.createElement('canvas'); canvas.width = 2000; canvas.height = 1200
  const context = canvas.getContext('2d'); if (!context) throw new Error('O navegador não disponibilizou a prancha de exportação.')
  drawBoardChrome(context, 'Prancha de interferência selecionada', 'Captura isolada: somente a geometria recortada selecionada e sua camada correspondente.', canvas.width, canvas.height)
  const mapX = 82; const mapY = 220; const mapW = 1170; const mapH = 820
  context.fillStyle = '#FFFFFF'; context.fillRect(mapX - 12, mapY - 32, mapW + 24, mapH + 44)
  const ratio = Math.min(mapW / image.width, mapH / image.height); const drawW = image.width * ratio; const drawH = image.height * ratio
  context.drawImage(image, mapX, mapY, drawW, drawH); drawCoordinateGrid(context, capture, mapX, mapY, mapW, mapH, drawW, drawH)
  context.strokeStyle = '#263D42'; context.lineWidth = 3; context.strokeRect(mapX, mapY, drawW, drawH)
  const panelX = 1325; const panelW = 590
  context.fillStyle = '#FFFFFF'; context.fillRect(panelX, 220, panelW, 820)
  context.fillStyle = '#173C46'; context.font = '700 27px Arial'; context.fillText('OCORRÊNCIA', panelX + 30, 270)
  records.forEach((record, index) => {
    const y = 330 + index * 250
    context.fillStyle = '#EAF0EE'; context.fillRect(panelX + 22, y - 35, panelW - 44, 210)
    context.fillStyle = '#173C46'; context.font = '700 22px Arial'; context.fillText(`${index + 1}. ${record.layerTitle}`, panelX + 38, y)
    context.fillStyle = '#B06D1D'; context.font = '700 18px Arial'; context.fillText(`${geometryLabel(record.geometryType)} · ${String(record.attributes._relacao_espacial || 'interseção')}`, panelX + 38, y + 34)
    context.fillStyle = '#526166'; context.font = '16px Arial'
    Object.entries(record.attributes).slice(0, 5).forEach(([key, value], attrIndex) => context.fillText(`${key}: ${String(value).slice(0, 48)}`, panelX + 38, y + 70 + attrIndex * 24))
  })
  drawLegend(context, records, 82, 1100, 1170)
  return format === 'jpg' ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png')
}

const composeSummaryInfographic = async (capture: CaptureResult, records: InterferenceRecord[]) => {
  const image = await loadImage(capture.dataUrl)
  const canvas = document.createElement('canvas'); canvas.width = 2000; canvas.height = 1450
  const context = canvas.getContext('2d'); if (!context) throw new Error('O navegador não disponibilizou o quadro-resumo.')
  drawBoardChrome(context, 'Quadro-resumo das interferências', 'Todas as interferências da área de estudo, com geometrias recortadas, camadas participantes e atributos essenciais.', canvas.width, canvas.height)
  const mapX = 70; const mapY = 220; const mapW = 1170; const mapH = 760
  context.fillStyle = '#FFFFFF'; context.fillRect(mapX - 12, mapY - 32, mapW + 24, mapH + 44)
  const ratio = Math.min(mapW / image.width, mapH / image.height); const drawW = image.width * ratio; const drawH = image.height * ratio
  context.drawImage(image, mapX, mapY, drawW, drawH); drawCoordinateGrid(context, capture, mapX, mapY, mapW, mapH, drawW, drawH)
  context.strokeStyle = '#263D42'; context.lineWidth = 3; context.strokeRect(mapX, mapY, drawW, drawH)
  const layerCount = new Set(records.map((record) => record.layerId)).size
  context.fillStyle = '#FFFFFF'; context.fillRect(1290, 220, 625, 760)
  context.fillStyle = '#173C46'; context.font = '700 28px Arial'; context.fillText('SÍNTESE', 1330, 280)
  context.fillStyle = '#F2B134'; context.font = '700 64px Arial'; context.fillText(String(records.length), 1330, 370)
  context.fillStyle = '#526166'; context.font = '600 20px Arial'; context.fillText('interferências consolidadas', 1330, 408)
  context.fillStyle = '#F2B134'; context.font = '700 64px Arial'; context.fillText(String(layerCount), 1600, 370)
  context.fillStyle = '#526166'; context.font = '600 20px Arial'; context.fillText('camadas participantes', 1600, 408)
  const byLayer = Array.from(new Map(records.map((record) => [record.layerId, record])).values())
  byLayer.forEach((record, index) => {
    const y = 490 + index * 70
    context.fillStyle = index % 2 ? '#F5F8F7' : '#EAF0EE'; context.fillRect(1320, y - 28, 560, 52)
    const swatch = symbolColor(record.symbol, '#E63946'); context.fillStyle = swatch; context.fillRect(1340, y - 12, 22, 16)
    context.fillStyle = '#173C46'; context.font = '700 18px Arial'; context.fillText(record.layerTitle.slice(0, 42), 1380, y)
    context.fillStyle = '#526166'; context.font = '16px Arial'; context.fillText(`${records.filter((item) => item.layerId === record.layerId).length} ocorrência(s)`, 1680, y)
  })
  context.fillStyle = '#173C46'; context.font = '700 24px Arial'; context.fillText('INTERFERÊNCIAS CLIPADAS', 70, 1050)
  const cardW = 900; const cardH = 92
  records.forEach((record, index) => {
    const col = index % 2; const row = Math.floor(index / 2); const x = 70 + col * 960; const y = 1100 + row * (cardH + 16)
    if (y > 1350) return
    context.fillStyle = index % 2 ? '#EAF0EE' : '#F5F8F7'; context.fillRect(x, y, cardW, cardH)
    context.fillStyle = '#B06D1D'; context.font = '700 20px Arial'; context.fillText(`${index + 1}`, x + 18, y + 32)
    context.fillStyle = '#173C46'; context.font = '700 18px Arial'; context.fillText(record.layerTitle.slice(0, 42), x + 58, y + 28)
    context.fillStyle = '#526166'; context.font = '16px Arial'; context.fillText(`${geometryLabel(record.geometryType)} · ${String(record.attributes._relacao_espacial || 'interseção')} · ${record.id}`, x + 58, y + 58)
  })
  drawLegend(context, records, 70, 1400, 1840)
  return canvas.toDataURL('image/png')
}

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
  const [drawing, setDrawing] = useState(false)
  const [layers, setLayers] = useState<InterferenceLayerInfo[]>([])
  const [activeLayerIds, setActiveLayerIds] = useState<string[]>([])
  const [records, setRecords] = useState<InterferenceRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [studyAreaReady, setStudyAreaReady] = useState(false)
  const studyAreaRef = useRef<Polygon | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [exportingBoard, setExportingBoard] = useState(false)
  const [exportingSummary, setExportingSummary] = useState(false)

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

  const drawStudyArea = async () => {
    if (!runtimeRef.current) { setShowSettings(true); return }
    setDrawing(true); setErrors([]); setRecords([]); setSelectedId(null)
    try {
      setStatus('Desenhe o polígono da área de estudo. Clique nos vértices e finalize com duplo clique.')
      const studyArea = await runtimeRef.current.drawStudyArea()
      if (!studyArea) throw new Error('A área de estudo não foi concluída.')
      studyAreaRef.current = studyArea
      setStudyAreaReady(true)
      setStatus('Área concluída. Agora clique em “Analisar área”.')
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Falha ao desenhar a área de estudo.'])
      setStatus('O desenho não foi concluído.')
    } finally { setDrawing(false) }
  }

  const analyzeStudyArea = async () => {
    if (!runtimeRef.current) { setShowSettings(true); return }
    if (!studyAreaRef.current) { setErrors(['Desenhe e finalize uma área de estudo antes de analisar.']); setStatus('Aguardando o desenho da área.'); return }
        setAnalyzing(true); setErrors([])
    try {
      setStatus('Analisando todas as camadas do Web Map…')
      const result = await runtimeRef.current.analyzeStudyArea(studyAreaRef.current)
      setRecords(result.records); setErrors(result.errors)
      setStatus(`${result.records.length} interferência(s) encontrada(s) em ${new Set(result.records.map((record) => record.layerId)).size} camada(s). A área foi preservada.`)
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Falha na análise espacial.']); setStatus('A análise não foi concluída.')
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
      const capture = await runtimeRef.current.captureRecord(record)
      const board = await composeInterferenceBoard(capture, [record], 'png')
      downloadDataUrl(board, `interferencia-${slug(record.layerTitle)}-${slug(record.id)}.png`)
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Não foi possível gerar o PNG desta interferência.'])
    } finally { setExportingId(null) }
  }

  const exportBoard = async (format: 'png' | 'jpg') => {
    if (!runtimeRef.current || !records.length) return
    setExportingBoard(true)
    try {
      const capture = await runtimeRef.current.captureMap()
      const board = await composeInterferenceBoard(capture, records, format)
      downloadDataUrl(board, `prancha-interferencias-${new Date().toISOString().slice(0, 10)}.${format}`)
    } catch (error) { setErrors([error instanceof Error ? error.message : 'Não foi possível gerar a prancha.']) }
    finally { setExportingBoard(false) }
  }

  const exportSummary = async () => {
    if (!runtimeRef.current || !records.length) return
    setExportingSummary(true)
    try {
      const capture = await runtimeRef.current.captureSummary()
      const board = await composeSummaryInfographic(capture, records)
      downloadDataUrl(board, `quadro-resumo-interferencias-${new Date().toISOString().slice(0, 10)}.png`)
    } catch (error) { setErrors([error instanceof Error ? error.message : 'Não foi possível gerar o quadro-resumo.']) }
    finally { setExportingSummary(false) }
  }

  const clear = () => {
    runtimeRef.current?.clearAnalysis()
    studyAreaRef.current = null
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
          <p className="mt-2 text-xs leading-5 text-[#8FA9AE]">A análise percorre automaticamente todas as camadas vetoriais do Web Map e lista somente as feições que intersectam, tocam, sobrepõem ou ficam circunscritas na área desenhada.</p>
          {!layers.length && <div className="mt-4 rounded border border-dashed border-[#55747B] p-4 text-xs text-[#B8C9CC]">Carregue o Web Map para listar as camadas vetoriais.</div>}
          <div className="mt-4 space-y-4">
            {groupedLayers.map(([group, entries]) => <div key={group}>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[.18em] text-[#F2B134]">{group}</p>
              <div className="space-y-1.5">{entries.map((entry: InterferenceLayerInfo) => <label key={entry.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs text-[#DCE7E8] transition hover:bg-white/5">
                <span className="mt-0.5 h-3 w-3 rounded-full border border-[#F2B134] bg-[#F2B134]/70" />
                <span className="min-w-0"><span className="block truncate">{entry.title}</span><span className="text-[10px] text-[#8FA9AE]">{geometryLabel(entry.geometryType)}</span></span>
              </label>)}</div>
            </div>)}
          </div>

          {records.length > 0 && <section className="mt-6 border-t border-[#31515A] pt-4"><div className="flex items-center justify-between"><h2 className="text-xs font-bold uppercase tracking-[.2em] text-[#B8C9CC]">Interferências detectadas</h2><span className="rounded-full bg-[#F2B134] px-2 py-0.5 text-[10px] font-bold text-[#172B30]">{records.length}</span></div><p className="mt-2 text-[11px] text-[#8FA9AE]">Cada item é uma feição lógica consolidada; clique para destacar somente a ocorrência e exportar sua prancha.</p><div className="mt-3 grid grid-cols-2 gap-2"><Button size="sm" variant="outline" disabled={exportingBoard} onClick={() => exportBoard('png')} className="border-[#55747B] bg-transparent text-[10px] text-[#F4F0E8] hover:bg-[#F2B134] hover:text-[#172B30]"><Download className="mr-1" size={12} />Prancha PNG</Button><Button size="sm" variant="outline" disabled={exportingBoard} onClick={() => exportBoard('jpg')} className="border-[#55747B] bg-transparent text-[10px] text-[#F4F0E8] hover:bg-[#F2B134] hover:text-[#172B30]"><Download className="mr-1" size={12} />Prancha JPG</Button><Button size="sm" variant="outline" disabled={exportingSummary} onClick={exportSummary} className="col-span-2 border-[#F2B134] bg-[#F2B134]/10 text-[11px] text-[#F4F0E8] hover:bg-[#F2B134] hover:text-[#172B30]"><Download className="mr-1" size={13} />{exportingSummary ? 'Gerando quadro-resumo…' : 'Quadro-resumo PNG (todas)'}</Button></div><div className="mt-3 space-y-2">{records.map((record) => <article key={record.id} className={`rounded border p-3 transition ${selectedId === record.id ? 'border-[#F2B134] bg-[#F2B134]/15' : 'border-[#31515A] bg-[#0B303A]/70'}`}><button className="w-full text-left" onClick={() => selectRecord(record)}><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-bold text-[#F4F0E8]">{record.layerTitle}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-[#F2B134]">{geometryLabel(record.geometryType)}</p></div><span className="text-[10px] text-[#8FA9AE]">{Object.keys(record.attributes).length} atributos</span></div><p className="mt-2 line-clamp-2 text-[11px] text-[#B8C9CC]">{Object.entries(record.attributes).slice(0, 2).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</p></button><Button size="sm" variant="outline" className="mt-3 h-7 w-full border-[#55747B] bg-transparent text-[11px] text-[#F4F0E8] hover:bg-[#F2B134] hover:text-[#172B30]" disabled={exportingId === record.id} onClick={() => exportRecord(record)}>{exportingId === record.id ? <LoaderCircle className="mr-2 animate-spin" size={13} /> : <Download className="mr-2" size={13} />}Baixar prancha PNG</Button></article>)}</div></section>}
        </div>

        <footer className="space-y-2 border-t border-[#31515A] px-5 py-4"><div className="grid grid-cols-2 gap-2"><Button onClick={drawStudyArea} disabled={drawing || analyzing || !runtimeRef.current} className="bg-[#F2B134] text-[#172B30] hover:bg-[#FFD166]"><Play className="mr-2" size={15} />{drawing ? 'Desenhando…' : '1. Desenhar área'}</Button><Button onClick={analyzeStudyArea} disabled={analyzing || drawing || !studyAreaReady || !runtimeRef.current} className="bg-[#D98E2B] text-[#172B30] hover:bg-[#F2B134]"><Play className="mr-2" size={15} />{analyzing ? 'Analisando…' : '2. Analisar área'}</Button></div><Button onClick={clear} variant="outline" className="w-full border-[#55747B] bg-transparent text-[#F4F0E8] hover:bg-white/10"><Trash2 className="mr-2" size={15} />Limpar área e resultados</Button><Button onClick={() => setShowSettings((value) => !value)} variant="ghost" className="w-full justify-start text-[#B8C9CC] hover:bg-white/5 hover:text-white"><Settings2 className="mr-2" size={15} />Configuração do Portal e Web Map</Button></footer>
      </aside>

      {showSettings && <div className="absolute right-6 top-6 z-20 w-[420px] rounded-lg border border-[#55747B] bg-[#F4F0E8] p-5 text-[#173C46] shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#B06D1D]">Conexão sem alterar o mapa</p><h2 className="mt-1 text-xl font-black">Web Map de interferências</h2></div><Settings2 className="text-[#B06D1D]" size={20} /></div><p className="mt-2 text-xs leading-5 text-[#526166]">A aplicação consulta o item operacional e cria somente gráficos temporários para a área de estudo e os destaques.</p><div className="mt-4 space-y-3"><label className="block text-xs font-bold">Portal Enterprise<Input value={settings.portalUrl} onChange={(event) => setSettings({ ...settings, portalUrl: event.target.value })} className="mt-1 bg-white" /></label><label className="block text-xs font-bold">ID do Web Map<Input value={settings.webMapId} onChange={(event) => setSettings({ ...settings, webMapId: event.target.value })} className="mt-1 bg-white" /></label><label className="block text-xs font-bold">Client ID OAuth<Input value={settings.clientId} onChange={(event) => setSettings({ ...settings, clientId: event.target.value })} placeholder="credencial OAuth do Portal" className="mt-1 bg-white" /></label></div><p className="mt-3 text-[11px] leading-4 text-[#526166]">A Redirect URL desta aplicação é <strong>{window.location.origin}{window.location.pathname}</strong>. Ela precisa estar cadastrada na credencial OAuth; caso contrário, o Portal retorna <strong>Invalid redirect_uri</strong>.</p><Button onClick={loadMap} disabled={loading} className="mt-4 w-full bg-[#173C46] text-white hover:bg-[#0B303A]">{loading ? <LoaderCircle className="mr-2 animate-spin" size={16} /> : <MapPinned className="mr-2" size={16} />}Entrar e carregar Web Map</Button></div>}

      <div className="absolute bottom-4 right-5 z-10 rounded bg-[#F4F0E8]/90 px-3 py-2 text-[10px] text-[#526166] shadow"><strong>Legenda:</strong> área de estudo em vermelho · ponto destacado em azul · linha em ocre · polígono em vermelho · seleção em amarelo</div>
    </main>
  )
}
