/**
 * Carta Técnica Operacional: trilho técnico assimétrico, mapa dominante,
 * ocre para cotas e vermelho reservado para a área pública ocupada.
 */
import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileDown,
  ImageDown,
  Layers3,
  LoaderCircle,
  MapPinned,
  Ruler,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AppMapSettings,
  AnalysisRuntime,
  MapCapture,
  DimensionItem,
  FeatureKind,
  PublicAreaResult,
  SelectedFeature,
  createAnalysisRuntime,
  ensurePortalCredential,
} from '@/lib/arcgis-analysis'

const portalDefault = 'https://monitora.dflegal.df.gov.br/portal'
const printDefault = 'https://monitora.dflegal.df.gov.br/server/rest/services/DF_Legal_Printer_Service_V5/GPServer/Export%20Web%20Map'
const storageKey = 'advanced-lotes-dflegal-settings-v2'
const oauthClientId = 'jfk16YwsZbW4Cp98'

const defaultSettings: AppMapSettings = {
  portalUrl: portalDefault,
  webMapId: 'dfead3998af143298ece2d74712122b7',
  lotLayerTitle: 'Lotes Registrados',
  occupationLayerTitle: 'Ocupacoes Identificadas',
  lotAreaField: 'qd_area',
  occupationAreaField: 'st_area_sh',
  printServiceUrl: printDefault,
  layoutName: 'layout_a4_paisagem',
}

const officialLogoUrl = 'https://dflegal.df.gov.br/documents/9313432/9332158/Logo-DF-Legal.jpg/35530d0b-5442-08fb-c952-573edd9364d4?version=1.0&t=1740344032613&imagePreview=1'

const formatSquareMeters = (value: number) =>
  `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`

const formatMeters = (value: number) =>
  `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`

const loadImage = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('Não foi possível preparar a imagem do mapa.'))
  image.src = dataUrl
})

const drawWrappedText = (context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
  const words = text.split(' ')
  let line = ''
  let currentY = y
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (context.measureText(candidate).width > maxWidth && line) {
      context.fillText(line, x, currentY)
      line = word
      currentY += lineHeight
    } else {
      line = candidate
    }
  }
  if (line) context.fillText(line, x, currentY)
  return currentY + lineHeight
}

const drawAttributeBlock = (context: CanvasRenderingContext2D, title: string, fields: string[], feature: SelectedFeature | null, x: number, y: number, width: number) => {
  context.fillStyle = '#173C46'
  context.font = '700 16px Arial'
  context.fillText(title, x, y)
  let currentY = y + 24
  context.font = '11px Arial'
  for (const field of fields) {
    const value = feature?.graphic.attributes?.[field]
    const text = value === null || value === undefined || String(value).trim() === '' ? 'não informado' : String(value)
    context.fillStyle = '#526166'
    context.font = '700 11px Arial'
    context.fillText(`${field}:`, x, currentY)
    context.fillStyle = '#173C46'
    context.font = '11px Arial'
    currentY = drawWrappedText(context, text, x + 82, currentY, width - 82, 14)
    currentY += 3
  }
  return currentY + 10
}

const composeLandscapeBoard = async (capture: MapCapture, format: 'png' | 'jpg', dimensions: DimensionItem[], publicArea: PublicAreaResult | null, lotSelection: SelectedFeature | null, occupationSelection: SelectedFeature | null) => {
  const image = await loadImage(capture.dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = 2000
  canvas.height = 1200
  const context = canvas.getContext('2d')
  if (!context) throw new Error('O navegador não disponibilizou o canvas para a exportação.')

  context.fillStyle = '#F4F0E8'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const mapX = 112
  const mapWidth = 1280
  const mapHeight = Math.round(mapWidth / (image.width / image.height))
  const mapY = 220
  context.fillStyle = '#FFFFFF'
  context.fillRect(mapX - 8, mapY - 28, mapWidth + 16, mapHeight + 56)
  context.drawImage(image, mapX, mapY, mapWidth, mapHeight)

  // Grade calculada a partir da extensão real da vista e rotulada na referência espacial do mapa.
  const { xmin, ymin, xmax, ymax } = capture.geographicExtent
  const gridX = (value: number) => mapX + ((value - xmin) / (xmax - xmin)) * mapWidth
  const gridY = (value: number) => mapY + mapHeight - ((value - ymin) / (ymax - ymin)) * mapHeight
  const formatCoordinate = (value: number) => value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  context.save()
  context.strokeStyle = '#526166'
  context.fillStyle = '#173C46'
  context.lineWidth = 1
  context.font = '11px Arial'
  for (let index = 0; index <= 5; index += 1) {
    const xValue = xmin + ((xmax - xmin) * index) / 5
    const yValue = ymin + ((ymax - ymin) * index) / 5
    const x = gridX(xValue)
    const y = gridY(yValue)
    context.beginPath(); context.moveTo(x, mapY - 7); context.lineTo(x, mapY); context.stroke()
    context.beginPath(); context.moveTo(mapX - 7, y); context.lineTo(mapX, y); context.stroke()
    context.fillText(formatCoordinate(xValue), x - 38, mapY - 12)
    context.save()
    context.translate(mapX - 28, y + 34)
    context.rotate(-Math.PI / 2)
    context.fillText(formatCoordinate(yValue), 0, 0)
    context.restore()
  }
  context.font = '700 12px Arial'
  context.fillText('Longitude (°)', mapX + mapWidth - 84, mapY - 12)
  context.save()
  context.translate(32, mapY + mapHeight / 2 + 28)
  context.rotate(-Math.PI / 2)
  context.fillText('Latitude (°) — crescente para o norte', 0, 0)
  context.restore()
  context.restore()
  context.strokeStyle = '#173C46'
  context.lineWidth = 3
  context.strokeRect(mapX, mapY, mapWidth, mapHeight)

  const panelX = 1430
  const panelWidth = 570
  context.fillStyle = '#FFFFFF'
  context.fillRect(panelX, 0, panelWidth, canvas.height)
  context.fillStyle = '#0B3440'
  context.fillRect(panelX, 0, panelWidth, 110)
  try {
    const officialLogo = await loadImage(officialLogoUrl)
    context.drawImage(officialLogo, panelX + 24, 18, 170, 62)
  } catch {
    context.fillStyle = '#FFFFFF'
    context.font = '700 28px Arial'
    context.fillText('DF Legal', panelX + 24, 52)
  }
  context.fillStyle = '#FFFFFF'
  context.font = '700 17px Arial'
  drawWrappedText(context, 'Mapa Temático Consulta Lote registrado e área pública ocupada', panelX + 220, 42, 320, 22)
  context.font = '14px Arial'
  context.fillText('Advanced Lotes · DF Legal', panelX + 220, 96)
  context.fillStyle = '#526166'
  context.font = '12px Arial'
  const wkid = capture.spatialReference.latestWkid || capture.spatialReference.wkid
  const referenceName = wkid === 3857 || wkid === 102100 ? 'WGS 84 / Web Mercator' : `Referência espacial WKID ${wkid || 'não informada'}`
  context.fillText(`Escala 1:${Math.round(capture.scale || 0).toLocaleString('pt-BR')}`, panelX + 24, 142)
  context.fillText(`Zoom ${capture.zoom.toFixed(2)} · EPSG:${wkid || '—'}`, panelX + 24, 162)
  context.fillText('Grade: Longitude/Latitude · WGS 84 / EPSG:4326', panelX + 24, 182)
  context.fillText('Visualização do mapa: Web Mercator / EPSG:3857', panelX + 24, 200)

  let y = 232
  const contentX = panelX + 24
  const contentWidth = panelWidth - 48
  context.fillStyle = '#173C46'
  context.font = '700 19px Arial'
  context.fillText('IDENTIFICAÇÃO DO LOTE REGISTRADO', contentX, y)
  y += 30
  context.font = '14px Arial'
  y = drawWrappedText(context, lotSelection?.graphic.attributes?.pu_end_car || lotSelection?.graphic.attributes?.end_car || lotSelection?.address || 'Endereço não informado', contentX, y, contentWidth, 20)
  y += 4
  context.fillText(`CIU ${lotSelection?.graphic.attributes?.pu_ciu || lotSelection?.graphic.attributes?.ciu || 'não informado'}`, contentX, y)
  y += 24
  context.fillStyle = '#C58A28'
  context.fillRect(contentX, y, contentWidth, 2)
  y += 32

  context.fillStyle = '#173C46'
  context.font = '700 19px Arial'
  context.fillText('COTAS DOS SEGMENTOS', contentX, y)
  y += 30
  context.font = '14px Arial'
  if (dimensions.length) {
    for (const dimension of dimensions) {
      context.fillStyle = '#526166'
      context.fillText(dimension.label, contentX, y)
      context.fillStyle = '#173C46'
      context.font = '700 14px Arial'
      context.fillText(formatMeters(dimension.length), contentX + 166, y)
      context.font = '14px Arial'
      y += 24
    }
  } else {
    context.fillStyle = '#526166'
    context.fillText('Nenhuma cota gerada.', contentX, y)
    y += 24
  }
  y += 18
  context.fillStyle = '#B93835'
  context.fillRect(contentX, y, contentWidth, 2)
  y += 32

  context.fillStyle = '#B93835'
  context.font = '700 19px Arial'
  context.fillText('ÁREA PÚBLICA', contentX, y)
  y += 30
  context.fillStyle = '#173C46'
  context.font = '14px Arial'
  if (publicArea) {
    const areaRows = [
      ['Ocupação', formatSquareMeters(publicArea.reportedOccupationArea)],
      ['Lote', formatSquareMeters(publicArea.reportedLotArea)],
      ['Excedente', formatSquareMeters(publicArea.numericalExcess)],
      ['Hachurado', formatSquareMeters(publicArea.geometricPublicArea)],
    ]
    for (const [label, value] of areaRows) {
      context.fillStyle = '#526166'
      context.fillText(label, contentX, y)
      context.fillStyle = '#173C46'
      context.font = '700 14px Arial'
      context.fillText(value, contentX + 125, y)
      context.font = '14px Arial'
      y += 25
    }
    y += 12
    context.fillStyle = publicArea.hasPublicArea ? '#B93835' : '#526166'
    context.font = '700 14px Arial'
    y = drawWrappedText(context, publicArea.hasPublicArea ? `Área pública ocupada identificada: área total ${formatSquareMeters(publicArea.geometricPublicArea)}.` : 'Não há área pública ocupada pela regra configurada.', contentX, y, contentWidth, 20)
    context.fillStyle = '#526166'
    context.font = '12px Arial'
    y = drawWrappedText(context, 'Hachura = diferença espacial entre ocupação e lote. Excedente = diferença numérica entre as áreas informadas na tabela.', contentX, y + 2, contentWidth, 17)
  } else {
    context.fillStyle = '#526166'
    context.fillText('Análise não executada.', contentX, y)
    y += 24
  }

  y = Math.max(y + 22, 640)
  context.fillStyle = '#C58A28'
  context.fillRect(contentX, y, contentWidth, 2)
  y += 28
  context.fillStyle = '#173C46'
  context.font = '700 14px Arial'
  context.fillText('DADOS DO LOTE REGISTRADO E OCUPAÇÃO IDENTIFICADA', contentX, y)
  y += 28
  const lotFields = ['pu_ciu', 'pu_projeto', 'pu_end_car', 'pu_end_usu', 'x', 'y', 'pn_norma', 'pn_uso', 'pn_norma_a']
  const occupationFields = ['ct_ciu', 'ct_origem', 'lt_enderec', 'lt_ra', 'st_area_sh']
  drawAttributeBlock(context, 'LOTE REGISTRADO', lotFields, lotSelection, contentX, y, 250)
  context.strokeStyle = '#9AA2A4'
  context.lineWidth = 2
  context.beginPath(); context.moveTo(contentX + 270, y - 14); context.lineTo(contentX + 270, 920); context.stroke()
  drawAttributeBlock(context, 'OCUPAÇÃO IDENTIFICADA', occupationFields, occupationSelection, contentX + 295, y, 240)

  const legendY = 1018
  context.fillStyle = '#C58A28'
  context.fillRect(contentX, legendY, contentWidth, 2)
  context.fillStyle = '#173C46'
  context.font = '700 16px Arial'
  context.fillText('LEGENDA', contentX, legendY + 26)
  context.font = '13px Arial'
  context.fillStyle = '#E5D95A'
  context.fillRect(contentX, legendY + 40, 20, 14)
  context.fillStyle = '#173C46'
  context.font = '700 13px Arial'
  context.fillText('Lotes Registrados', contentX + 30, legendY + 52)
  context.fillStyle = '#F35B87'
  context.fillRect(contentX, legendY + 62, 20, 14)
  context.fillStyle = '#173C46'
  context.fillText('Ocupações Identificadas', contentX + 30, legendY + 74)
  context.strokeStyle = '#FFE46E'
  context.strokeRect(contentX + 260, legendY + 40, 20, 14)
  context.fillStyle = '#B93835'
  context.font = '700 13px Arial'
  context.fillText('Área pública ocupada (hachura)', contentX + 290, legendY + 52)
  context.strokeStyle = '#4E5B60'
  context.lineWidth = 4
  context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16)
  context.fillStyle = '#526166'
  context.font = '12px Arial'
  context.fillText(`Gerado em ${new Date().toLocaleString('pt-BR')}`, contentX, 1168)
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png'
  return canvas.toDataURL(mime, format === 'jpg' ? 0.94 : undefined)
}

const getStoredSettings = (): AppMapSettings => {
  try {
    const stored = window.localStorage.getItem(storageKey)
    if (!stored) return defaultSettings
    const parsed = JSON.parse(stored) as Partial<AppMapSettings>
    return { ...defaultSettings, ...parsed, webMapId: parsed.webMapId?.trim() || defaultSettings.webMapId }
  } catch {
    return defaultSettings
  }
}

export default function Home() {
  const mapHostRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<AnalysisRuntime | null>(null)
  const selectionModeRef = useRef<FeatureKind>('lote')
  const [settings, setSettings] = useState<AppMapSettings>(getStoredSettings)
  const [isConfigurationOpen, setConfigurationOpen] = useState(true)
  const [isLoadingMap, setLoadingMap] = useState(false)
  const [isPrinting, setPrinting] = useState(false)
  const [isExportingImage, setExportingImage] = useState(false)
  const [status, setStatus] = useState('Informe o ID do Web Map para iniciar a análise.')
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<SelectedFeature | null>(null)
  const [lotSelection, setLotSelection] = useState<SelectedFeature | null>(null)
  const [occupationSelection, setOccupationSelection] = useState<SelectedFeature | null>(null)
  const [selectionMode, setSelectionMode] = useState<FeatureKind>('lote')
  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState<SelectedFeature[]>([])
  const [isSearching, setSearching] = useState(false)
  const [dimensions, setDimensions] = useState<DimensionItem[]>([])
  const [publicArea, setPublicArea] = useState<PublicAreaResult | null>(null)

  useEffect(() => () => runtimeRef.current?.destroy(), [])

  const updateSetting = (key: keyof AppMapSettings, value: string) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const changeSelectionMode = (mode: FeatureKind) => {
    selectionModeRef.current = mode
    setSelectionMode(mode)
    runtimeRef.current?.setSelectionMode(mode)
    setSearchText('')
    setSearchResults([])
    setError('')
    setStatus(`Modo de seleção: ${mode === 'lote' ? 'Lote' : 'Ocupação'}. Clique na feição correspondente; seleções anteriores são mantidas.`)
  }

  const loadMap = async () => {
    if (!settings.webMapId.trim()) {
      setError('Cole o ID do item do Web Map antes de carregar o mapa.')
      return
    }
    if (!mapHostRef.current) return

    setLoadingMap(true)
    setError('')
    setStatus('Conectando ao Portal e carregando as camadas protegidas…')
    setSelection(null)
    setLotSelection(null)
    setOccupationSelection(null)
    setDimensions([])
    setPublicArea(null)
    runtimeRef.current?.destroy()
    runtimeRef.current = null

    try {
      await ensurePortalCredential(settings.portalUrl, oauthClientId)
      setStatus('Login confirmado. Carregando o Web Map e as camadas protegidas…')
      const runtime = await createAnalysisRuntime(mapHostRef.current, settings, (nextSelection) => {
        setSelection(nextSelection)
        if (nextSelection.kind === 'lote') setLotSelection(nextSelection)
        else setOccupationSelection(nextSelection)
        setStatus(`${nextSelection.kind === 'lote' ? 'Lote' : 'Ocupação'} selecionado: ${nextSelection.title}`)
      }, () => selectionModeRef.current)
      runtimeRef.current = runtime
      runtime.setSelectionMode(selectionModeRef.current)
      window.localStorage.setItem(storageKey, JSON.stringify(settings))
      setConfigurationOpen(false)
      setStatus(`Mapa carregado. Clique em um lote ou em uma ocupação para iniciar.`)
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Não foi possível carregar o Web Map.'
      setError(message)
      setStatus('O mapa não foi carregado.')
    } finally {
      setLoadingMap(false)
    }
  }

  const searchSelectedLayer = async () => {
    if (!runtimeRef.current) return
    if (searchText.trim().length < 2) {
      setError('Informe pelo menos dois caracteres do CIU ou do endereço.')
      return
    }
    try {
      setSearching(true)
      setError('')
      setStatus(`Buscando ${selectionMode === 'lote' ? 'lote' : 'ocupação'} por CIU ou endereço…`)
      const results = await runtimeRef.current.searchFeatures(selectionMode, searchText)
      setSearchResults(results)
      setStatus(results.length ? `${results.length} resultado(s) encontrado(s). Escolha um para selecionar.` : 'Nenhum resultado encontrado para a busca.')
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Não foi possível pesquisar a camada selecionada.')
    } finally {
      setSearching(false)
    }
  }

  const selectSearchResult = async (result: SelectedFeature) => {
    if (!runtimeRef.current) return
    try {
      setError('')
      await runtimeRef.current.selectFeature(result, true)
      setSearchResults([])
      setStatus(`${result.kind === 'lote' ? 'Lote' : 'Ocupação'} selecionado pela busca: ${result.title}`)
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : 'Não foi possível selecionar o resultado encontrado.')
    }
  }

  const drawDimensions = () => {
    if (!runtimeRef.current) return
    if (!lotSelection) {
      setError('Selecione primeiro um lote da camada “Lotes Registrados”.')
      return
    }
    try {
      setError('')
      const nextDimensions = runtimeRef.current.drawDimensions(lotSelection)
      setDimensions(nextDimensions)
      setStatus(`${nextDimensions.length} segmentos cotados no lote selecionado.`)
    } catch (dimensionError) {
      setError(dimensionError instanceof Error ? dimensionError.message : 'Não foi possível gerar as cotas.')
    }
  }

  const analysePublicArea = async () => {
    if (!runtimeRef.current) return
    if (!occupationSelection) {
      setError('Selecione primeiro uma ocupação da camada “Ocupacoes Identificadas”.')
      return
    }
    try {
      setError('')
      setStatus('Calculando a diferença geométrica entre ocupação e lote…')
      const result = await runtimeRef.current.analysePublicArea(occupationSelection)
      setPublicArea(result)
      setStatus(result.hasPublicArea ? 'Área pública ocupada destacada no mapa.' : 'Análise concluída sem área pública hachurada.')
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : 'Não foi possível calcular a área pública.')
    }
  }

  const exportMapImage = async (format: 'png' | 'jpg') => {
    if (!runtimeRef.current) return
    try {
      setError('')
      setExportingImage(true)
      setStatus(`Gerando imagem ${format.toUpperCase()} da área atual do mapa…`)
      const capture = await runtimeRef.current.exportMapImage(format)
      const dataUrl = await composeLandscapeBoard(capture, format, dimensions, publicArea, lotSelection, occupationSelection)
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = `advanced-lotes-df-legal-${new Date().toISOString().slice(0, 10)}.${format}`
      link.click()
      setStatus(`Prancha paisagem em ${format.toUpperCase()} baixada com mapa, cotas e quadro analítico.`)
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : 'Não foi possível exportar a imagem do mapa.')
      setStatus('Falha na exportação da imagem.')
    } finally {
      setExportingImage(false)
    }
  }

  const clearAnalysis = () => {
    runtimeRef.current?.clearGraphics()
    setDimensions([])
    setPublicArea(null)
    setStatus('Cotas e hachura removidas do mapa. A seleção foi mantida.')
    setError('')
  }

  const printAnalysis = async () => {
    if (!runtimeRef.current) return
    try {
      setError('')
      setPrinting(true)
      setStatus('Enviando mapa, cotas e hachura para o PDF… A RA é ocultada somente durante a impressão para contornar o erro do GPServer.')
      const analysisText = publicArea
        ? [
            `Área da ocupação: ${formatSquareMeters(publicArea.reportedOccupationArea)}`,
            `Área do lote: ${formatSquareMeters(publicArea.reportedLotArea)}`,
            `Excedente numérico: ${formatSquareMeters(publicArea.numericalExcess)}`,
            `Área geométrica hachurada: ${formatSquareMeters(publicArea.geometricPublicArea)}`,
          ].join('\n')
        : 'Nenhuma análise de área pública executada.'
      const selectionText = [
        lotSelection ? `Lote: ${lotSelection.title}\nÁrea informada: ${formatSquareMeters(lotSelection.reportedArea)}` : 'Lote: não selecionado.',
        occupationSelection ? `Ocupação: ${occupationSelection.title}\nÁrea informada: ${formatSquareMeters(occupationSelection.reportedArea)}` : 'Ocupação: não selecionada.',
      ].join('\n\n')
      const fileUrl = await runtimeRef.current.printAnalysis(settings, 'Análise de Lote — DF Legal', analysisText, selectionText)
      window.open(fileUrl, '_blank', 'noopener,noreferrer')
      setStatus('PDF gerado. A nova aba contém o arquivo devolvido pelo serviço.')
    } catch (printError) {
      const message = printError instanceof Error ? printError.message : 'O serviço não retornou o PDF.'
      setError(message)
      setStatus('Falha na impressão. O serviço V5 não devolveu o PDF; confira a URL da tarefa e o log do GPServer.')
    } finally {
      setPrinting(false)
    }
  }

  const mapIsLoaded = Boolean(runtimeRef.current)
  const selectionIsLot = Boolean(lotSelection)
  const selectionIsOccupation = Boolean(occupationSelection)

  return (
    <main className="analysis-workspace">
      <aside className="command-rail">
        <div className="rail-texture" style={{ backgroundImage: 'url(/manus-storage/cartographic-workbench-wide_55f61441.jpg)' }} />
        <div className="rail-content">
          <header className="brand-lockup">
            <img src={officialLogoUrl} alt="Logo oficial DF Legal" className="brand-mark" />
            <div>
              <p className="eyebrow">DF LEGAL · ANÁLISE ESPACIAL</p>
              <h1>Advanced<br />Lotes</h1>
            </div>
          </header>

          <section className="status-card" aria-live="polite">
            <span className="status-dot" />
            <div>
              <p className="status-label">STATUS DA SESSÃO</p>
              <p className="status-copy">{status}</p>
            </div>
          </section>

          <section className="tool-cluster" aria-label="Ferramentas de análise">
            <p className="section-label">ANÁLISE DO LOTE</p>
            <div className="selection-mode" role="group" aria-label="Camada a selecionar no mapa">
              <button type="button" className={selectionMode === 'lote' ? 'is-selected' : ''} onClick={() => changeSelectionMode('lote')}>
                Selecionar lote
              </button>
              <button type="button" className={selectionMode === 'ocupacao' ? 'is-selected' : ''} onClick={() => changeSelectionMode('ocupacao')}>
                Selecionar ocupação
              </button>
            </div>
            <p className="selection-hint">Modo ativo: <strong>{selectionMode === 'lote' ? 'Lote' : 'Ocupação'}</strong>. As duas seleções permanecem ativas para a análise.</p>
            <div className="feature-search">
              <div className="feature-search-entry">
                <Search size={15} aria-hidden="true" />
                <Input
                  aria-label="Buscar por CIU ou endereço"
                  value={searchText}
                  placeholder="CIU ou endereço"
                  onChange={(event) => setSearchText(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void searchSelectedLayer() }}
                />
                <button type="button" onClick={() => void searchSelectedLayer()} disabled={!mapIsLoaded || isSearching}>
                  {isSearching ? '…' : 'Buscar'}
                </button>
              </div>
              {searchResults.length > 0 && (
                <div className="feature-search-results" aria-label="Resultados da busca">
                  {searchResults.map((result) => (
                    <button type="button" key={`${result.kind}-${result.title}`} onClick={() => void selectSearchResult(result)}>
                      <strong>{result.title}</strong>
                      {result.address && <small>Endereço: {result.address}</small>}
                      <small>Área: {formatSquareMeters(result.reportedArea)}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button onClick={drawDimensions} disabled={!mapIsLoaded || !selectionIsLot} className="tool-button tool-button-dimension">
              <Ruler size={18} strokeWidth={1.8} />
              <span><strong>Cotar segmentos</strong><small>Desenha cada medida do lote</small></span>
            </Button>
            <Button onClick={analysePublicArea} disabled={!mapIsLoaded || !selectionIsOccupation} className="tool-button tool-button-alert">
              <AlertTriangle size={18} strokeWidth={1.8} />
              <span><strong>Ver área pública</strong><small>Hachura o excedente geométrico</small></span>
            </Button>
            <Button onClick={clearAnalysis} disabled={!mapIsLoaded} variant="ghost" className="tool-button tool-button-clear">
              <Trash2 size={17} strokeWidth={1.8} />
              <span><strong>Limpar análise</strong><small>Remove apenas gráficos temporários</small></span>
            </Button>
          </section>

          <section className="tool-cluster print-cluster">
            <p className="section-label">SAÍDA CARTOGRÁFICA</p>
            <Button onClick={printAnalysis} disabled={!mapIsLoaded || isPrinting} className="print-button">
              {isPrinting ? <LoaderCircle className="animate-spin" size={18} /> : <FileDown size={18} />}
              {isPrinting ? 'Gerando PDF…' : 'Imprimir mapa analisado'}
            </Button>
            <p className="print-hint">O PDF usa o Export Web Map; a RA é ocultada somente durante a chamada. PNG/JPG são alternativas diretas da área atual do mapa.</p>
            <div className="image-export-actions">
              <Button onClick={() => void exportMapImage('png')} disabled={!mapIsLoaded || isPrinting || isExportingImage} variant="outline" className="image-export-button">
                <ImageDown size={16} /> {isExportingImage ? 'Gerando…' : 'Baixar PNG'}
              </Button>
              <Button onClick={() => void exportMapImage('jpg')} disabled={!mapIsLoaded || isPrinting || isExportingImage} variant="outline" className="image-export-button">
                <ImageDown size={16} /> {isExportingImage ? 'Gerando…' : 'Baixar JPG'}
              </Button>
            </div>
          </section>

          <button className="settings-toggle" onClick={() => setConfigurationOpen((open) => !open)} aria-expanded={isConfigurationOpen}>
            <Settings2 size={16} /> Configuração do mapa
            {isConfigurationOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </aside>

      <section className="map-stage">
        <div className="map-header">
          <div className="map-header-title"><MapPinned size={18} /><span>PRANCHETA CARTOGRÁFICA</span></div>
          <div className="map-header-meta"><Layers3 size={15} /> {mapIsLoaded ? 'Web Map conectado' : 'Aguardando Web Map'}</div>
        </div>

        <div ref={mapHostRef} className={`map-canvas ${mapIsLoaded ? 'is-active' : ''}`} />

        {!mapIsLoaded && (
          <div className="map-empty-state">
            <img src="/manus-storage/cadastral-detail-reference_52d4cd42.jpg" alt="Referência abstrata de loteamento cadastral" />
            <div className="map-empty-overlay" />
            <div className="empty-copy">
              <span className="eyebrow">ESTADO 01 · MAPA NÃO CONECTADO</span>
              <h2>Aguardando Web Map.</h2>
              <p>Informe o ID do item para carregar as camadas operacionais e habilitar a seleção espacial.</p>
              <div className="operational-readout" aria-label="Estado da conexão">
                <div><span>CAMADA-ALVO A</span><strong>Lotes Registrados</strong></div>
                <div><span>CAMADA-ALVO B</span><strong>Ocupacoes Identificadas</strong></div>
                <div><span>SAÍDA</span><strong>Export Web Map · PDF</strong></div>
              </div>
              <Button onClick={() => setConfigurationOpen(true)}><Settings2 size={16} /> Configurar conexão</Button>
            </div>
          </div>
        )}

        {selection && (
          <div className={`selection-chip ${selection.kind}`}>
            <span>{selection.kind === 'lote' ? 'LOTE SELECIONADO' : 'OCUPAÇÃO SELECIONADA'}</span>
            <strong>{selection.title}</strong>
            {selection.address && <small>Endereço: {selection.address}</small>}
            <small>Área informada: {formatSquareMeters(selection.reportedArea)}</small>
          </div>
        )}

        {(dimensions.length > 0 || publicArea) && (
          <aside className="analysis-panel">
            <div className="analysis-panel-texture" style={{ backgroundImage: 'url(/manus-storage/parcel-analysis-texture_08b98a22.jpg)' }} />
            <div className="analysis-panel-content">
              <div className="analysis-panel-title"><span>RESULTADO DA ANÁLISE</span><div /></div>
              {dimensions.length > 0 && (
                <section>
                  <div className="result-heading"><Ruler size={16} /> <span>{dimensions.length} segmentos cotados</span></div>
                  <div className="dimension-list">
                    {dimensions.map((dimension) => <div key={dimension.label}><span>{dimension.label}</span><strong>{formatMeters(dimension.length)}</strong></div>)}
                  </div>
                </section>
              )}
              {publicArea && (
                <section className={publicArea.hasPublicArea ? 'public-result has-alert' : 'public-result'}>
                  <div className="result-heading"><AlertTriangle size={16} /> <span>{publicArea.hasPublicArea ? 'Área pública ocupada' : 'Sem área pública hachurada'}</span></div>
                  <div className="area-grid">
                    <div><small>OCUPAÇÃO</small><strong>{formatSquareMeters(publicArea.reportedOccupationArea)}</strong></div>
                    <div><small>LOTE</small><strong>{formatSquareMeters(publicArea.reportedLotArea)}</strong></div>
                    <div><small>EXCEDENTE</small><strong>{formatSquareMeters(publicArea.numericalExcess)}</strong></div>
                    <div><small>HACHURADO</small><strong>{formatSquareMeters(publicArea.geometricPublicArea)}</strong></div>
                  </div>
                  <p>{publicArea.note}</p>
                </section>
              )}
            </div>
          </aside>
        )}

        {error && <div className="error-banner"><AlertTriangle size={17} /> <span>{error}</span></div>}
      </section>

      {isConfigurationOpen && (
        <div className="configuration-scrim">
          <section className="configuration-drawer" aria-label="Configuração de conexão do Portal">
            <div className="drawer-header">
              <div><p className="eyebrow">CONEXÃO SEM ALTERAR A BASE</p><h2>Configurar mapa operacional</h2></div>
              <button onClick={() => setConfigurationOpen(false)} aria-label="Fechar configuração">×</button>
            </div>
            <p className="drawer-intro">O ID e as camadas já foram conferidos no Web Map operacional. Ao carregar, o Portal pedirá seu login para acessar as camadas protegidas. Nenhuma senha é salva nesta aplicação.</p>
            <div className="form-grid">
              <label><span>Portal ArcGIS Enterprise</span><Input value={settings.portalUrl} onChange={(event) => updateSetting('portalUrl', event.target.value)} /></label>
              <label><span>ID do Web Map</span><Input placeholder="Ex.: 32 caracteres do item do mapa" value={settings.webMapId} onChange={(event) => updateSetting('webMapId', event.target.value)} /></label>
              <label><span>Camada de lotes</span><Input value={settings.lotLayerTitle} onChange={(event) => updateSetting('lotLayerTitle', event.target.value)} /></label>
              <label><span>Campo da área do lote</span><Input value={settings.lotAreaField} onChange={(event) => updateSetting('lotAreaField', event.target.value)} /></label>
              <label><span>Camada de ocupações</span><Input value={settings.occupationLayerTitle} onChange={(event) => updateSetting('occupationLayerTitle', event.target.value)} /></label>
              <label><span>Campo da área construída</span><Input value={settings.occupationAreaField} onChange={(event) => updateSetting('occupationAreaField', event.target.value)} /></label>
              <label className="full-width"><span>Tarefa Export Web Map</span><Input value={settings.printServiceUrl} onChange={(event) => updateSetting('printServiceUrl', event.target.value)} /></label>
              <label className="full-width"><span>Nome do layout de impressão</span><Input value={settings.layoutName} onChange={(event) => updateSetting('layoutName', event.target.value)} /></label>
            </div>
            <div className="drawer-footer"><p>Não informe senha, token ou chave em nenhum campo.</p><Button onClick={loadMap} disabled={isLoadingMap}>{isLoadingMap ? <LoaderCircle className="animate-spin" size={17} /> : <MapPinned size={17} />}{isLoadingMap ? 'Autenticando e carregando…' : 'Entrar e carregar Web Map'}</Button></div>
          </section>
        </div>
      )}
    </main>
  )
}
