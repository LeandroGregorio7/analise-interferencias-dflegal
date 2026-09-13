/**
 * Carta Técnica Operacional: análise de interferências espaciais.
 * O mapa é dominante; o painel organiza consulta, camadas, atributos e exportação.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Polygon from '@arcgis/core/geometry/Polygon'
import { jsPDF } from 'jspdf'
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
  const candidate = symbol as any
  const colors = [candidate?.color, candidate?.outline?.color]
  for (const color of colors) {
    if (color?.toRgba) {
      const [r, g, b, a] = color.toRgba()
      if ((a ?? 1) > 0.05 && (r + g + b) > 24) return `rgba(${r},${g},${b},${a ?? 1})`
    }
    if (Array.isArray(color) && (color[3] ?? 255) > 12 && (color[0] + color[1] + color[2]) > 24) return `rgba(${color[0]},${color[1]},${color[2]},${(color[3] ?? 255) / 255})`
  }
  const json = candidate?.toJSON?.()
  const jsonColor = json?.color || json?.symbol?.color || json?.outline?.color
  if (Array.isArray(jsonColor) && (jsonColor[3] ?? 255) > 12 && (jsonColor[0] + jsonColor[1] + jsonColor[2]) > 24) return `rgba(${jsonColor[0]},${jsonColor[1]},${jsonColor[2]},${(jsonColor[3] ?? 255) / 255})`
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
  const entries = Array.from(new Map(records.map((record) => [`${record.layerId}:${classValue(record)}`, record])).values())
  context.fillStyle = '#173C46'; context.font = '700 18px Arial'; context.fillText('LEGENDA DAS CLASSES DAS INTERFERÊNCIAS', x, y)
  let legendX = x; let legendY = y + 30
  entries.forEach((record) => {
    const label = classValue(record).slice(0, 42)
    const itemWidth = Math.min(460, 48 + label.length * 9)
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
  const mapX = 140; const mapY = 220; const mapW = 1100; const mapH = 820
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

const exportIndividualPdf = async (capture: CaptureResult, record: InterferenceRecord) => {
  const image = await loadImage(capture.dataUrl)
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const w = 297; const h = 210; const m = 12
  pdf.setFillColor(11,48,58); pdf.rect(0,0,w,25,'F'); pdf.setTextColor(242,177,52); pdf.setFont('helvetica','bold'); pdf.setFontSize(15); pdf.text('DF LEGAL · ANÁLISE DE INTERFERÊNCIAS',m,11); pdf.setTextColor(255,255,255); pdf.setFontSize(10); pdf.text('Interferência selecionada',m,19)
  const mapW=178, mapH=150, mapX=m, mapY=35; const ratio=Math.min(mapW/image.width,mapH/image.height); const dw=image.width*ratio, dh=image.height*ratio
  pdf.addImage(image,'PNG',mapX+(mapW-dw)/2,mapY+(mapH-dh)/2,dw,dh); pdf.setDrawColor(38,61,66); pdf.rect(mapX,mapY,mapW,mapH)
  pdf.setTextColor(23,60,70); pdf.setFont('helvetica','bold'); pdf.setFontSize(13); pdf.text(record.layerTitle,205,44); pdf.setFontSize(11); pdf.text(`Classe: ${classValue(record).slice(0,55)}`,205,53); pdf.text(`Tipo: ${geometryLabel(record.geometryType)}`,205,61); pdf.text(`Relação: ${String(record.attributes._relacao_espacial || 'interseção')}`,205,69)
  pdf.setFont('helvetica','normal'); pdf.setFontSize(9); let y=82; Object.entries(record.attributes).filter(([key])=>!key.startsWith('_')).slice(0,9).forEach(([key,value])=>{ pdf.text(`${key}: ${String(value).slice(0,65)}`,205,y); y+=7 })
  pdf.setFillColor(230,57,70); pdf.rect(205,177,6,4,'F'); pdf.setTextColor(23,60,70); pdf.text(`Legenda — ${classValue(record).slice(0,55)}`,214,181)
  pdf.save(`interferencia-${slug(record.layerTitle)}-${slug(record.id)}.pdf`)
}

const exportConsolidatedPdf = async (capture: CaptureResult, records: InterferenceRecord[]) => {
  const image = await loadImage(capture.dataUrl)
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = 297; const pageHeight = 210; const margin = 12
  const header = (title: string) => {
    pdf.setFillColor(11, 48, 58); pdf.rect(0, 0, pageWidth, 24, 'F')
    pdf.setTextColor(242, 177, 52); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.text('DF LEGAL · ANÁLISE DE INTERFERÊNCIAS', margin, 10)
    pdf.setTextColor(255, 255, 255); pdf.setFontSize(10); pdf.text(title, margin, 18)
  }
  header('Prancha consolidada — mapa e interferências clipadas')
  const mapX = margin; const mapY = 34; const mapW = 180; const mapH = 155
  pdf.setFillColor(248, 248, 245); pdf.rect(mapX - 3, mapY - 3, mapW + 6, mapH + 6, 'F')
  const ratio = Math.min(mapW / image.width, mapH / image.height); const drawW = image.width * ratio; const drawH = image.height * ratio
  pdf.addImage(image, 'PNG', mapX + (mapW - drawW) / 2, mapY + (mapH - drawH) / 2, drawW, drawH)
  pdf.setDrawColor(38, 61, 66); pdf.rect(mapX, mapY, mapW, mapH)
  pdf.setTextColor(23, 60, 70); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text('CONSOLIDADO', 205, 42)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.text(`Interferências: ${records.length}`, 205, 52); pdf.text(`Classes: ${new Set(records.map(classValue)).size}`, 205, 59); pdf.text(`Camadas: ${new Set(records.map((record) => record.layerId)).size}`, 205, 66)
  let ly=82
  Array.from(new Map(records.map((record) => [`${record.layerId}:${classValue(record)}`, record])).values()).forEach((record) => {
    const color = symbolColor(record.symbol, '#E63946'); const rgb = color.match(/rgba?\\(([^)]+)\\)/)?.[1].split(',').map(Number) || [230,57,70]
    pdf.setFillColor(rgb[0] || 230, rgb[1] || 57, rgb[2] || 70); pdf.rect(205, ly - 4, 6, 4, 'F')
    pdf.setTextColor(23,60,70); pdf.setFontSize(8); pdf.text(`${classValue(record).slice(0, 40)} — ${records.filter((item) => classValue(item) === classValue(record)).length}`, 214, ly); ly += 8
  })
  const rows = records.map((record, index) => ({ n:index+1, layer:record.layerTitle, klass:classValue(record), relation:String(record.attributes._relacao_espacial || 'interseção'), id:record.id }))
  let index=0
  while (index < rows.length) {
    pdf.addPage(); header('Prancha consolidada — tabela de interferências')
    pdf.setFillColor(23,60,70); pdf.rect(margin, 34, pageWidth-margin*2, 9, 'F'); pdf.setTextColor(255,255,255); pdf.setFont('helvetica','bold'); pdf.setFontSize(8); pdf.text('Nº', margin+3, 40); pdf.text('CAMADA', margin+18, 40); pdf.text('CLASSE DA INTERFERÊNCIA', margin+105, 40); pdf.text('RELAÇÃO', margin+220, 40); pdf.text('ID', margin+250, 40)
    let y=43
    for (let count=0; count<20 && index<rows.length; count++, index++) {
      const row=rows[index]; pdf.setFillColor(count%2?245:234,248,247); pdf.rect(margin,y,pageWidth-margin*2,8,'F'); pdf.setTextColor(23,60,70); pdf.setFont('helvetica','normal'); pdf.setFontSize(8); pdf.text(String(row.n),margin+3,y+5); pdf.text(row.layer.slice(0,42),margin+18,y+5); pdf.text(row.klass.slice(0,58),margin+105,y+5); pdf.text(row.relation.slice(0,18),margin+220,y+5); pdf.text(row.id.slice(0,24),margin+250,y+5); y+=8
    }
  }
  pdf.save(`prancha-consolidada-interferencias-${new Date().toISOString().slice(0,10)}.pdf`)
}

const composeSummaryInfographic = async (capture: CaptureResult, records: InterferenceRecord[]) => {
  const image = await loadImage(capture.dataUrl)
  const width = 1400
  const margin = 60
  const mapX = 120
  const mapW = width - mapX - margin
  const mapH = 720
  const byLayer = Array.from(new Map(records.map((record) => [record.layerId, record])).values())
  const layerRows = Math.max(1, byLayer.length)
  const cardH = 86
  const cardsGap = 14
  const panelY = 1010
  const panelHeight = 300 + layerRows * 66
  const cardsStart = panelY + panelHeight + 100
  const recordsHeight = Math.max(1, records.length) * (cardH + cardsGap)
  const legendRows = Math.max(1, Math.ceil(Math.max(1, byLayer.length) / 2))
  const height = cardsStart + recordsHeight + 180 + legendRows * 34
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d'); if (!context) throw new Error('O navegador não disponibilizou o quadro-resumo.')
  drawBoardChrome(context, 'Quadro-resumo técnico das interferências', 'Síntese completa da área analisada — geometria clipada, camadas participantes e ocorrências consolidadas.', width, height)

  const mapY = 220
  context.fillStyle = '#FFFFFF'; context.fillRect(mapX - 14, mapY - 34, mapW + 28, mapH + 48)
  const ratio = Math.min(mapW / image.width, mapH / image.height); const drawW = image.width * ratio; const drawH = image.height * ratio
  const centeredX = mapX + (mapW - drawW) / 2
  context.drawImage(image, centeredX, mapY, drawW, drawH)
  drawCoordinateGrid(context, capture, centeredX, mapY, drawW, drawH, drawW, drawH)
  context.strokeStyle = '#263D42'; context.lineWidth = 3; context.strokeRect(centeredX, mapY, drawW, drawH)

  context.fillStyle = '#FFFFFF'; context.fillRect(margin, panelY, mapW, panelHeight)
  context.fillStyle = '#173C46'; context.font = '700 30px Arial'; context.fillText('SÍNTESE DA ANÁLISE', margin + 34, panelY + 56)
  context.fillStyle = '#F2B134'; context.font = '700 64px Arial'; context.fillText(String(records.length), margin + 38, panelY + 140)
  context.fillStyle = '#526166'; context.font = '600 20px Arial'; context.fillText('interferências consolidadas', margin + 38, panelY + 178)
  context.fillStyle = '#F2B134'; context.font = '700 64px Arial'; context.fillText(String(byLayer.length), margin + 430, panelY + 140)
  context.fillStyle = '#526166'; context.font = '600 20px Arial'; context.fillText('camadas participantes', margin + 430, panelY + 178)
  context.fillStyle = '#173C46'; context.font = '700 22px Arial'; context.fillText('Distribuição por camada', margin + 38, panelY + 235)
  byLayer.forEach((record, index) => {
    const y = panelY + 280 + index * 66
    context.fillStyle = index % 2 ? '#F5F8F7' : '#EAF0EE'; context.fillRect(margin + 28, y - 27, mapW - 56, 48)
    const swatch = symbolColor(record.symbol, '#E63946'); context.fillStyle = swatch; context.fillRect(margin + 46, y - 12, 22, 16)
    context.fillStyle = '#173C46'; context.font = '700 17px Arial'; context.fillText(record.layerTitle.slice(0, 70), margin + 86, y)
    context.fillStyle = '#526166'; context.font = '16px Arial'; context.textAlign = 'right'; context.fillText(`${records.filter((item) => item.layerId === record.layerId).length} ocorrência(s)`, width - margin - 46, y); context.textAlign = 'left'
  })

  const recordsTitleY = cardsStart - 38
  context.fillStyle = '#173C46'; context.font = '700 28px Arial'; context.fillText('INTERFERÊNCIAS CLIPADAS', margin, recordsTitleY)
  records.forEach((record, index) => {
    const y = cardsStart + index * (cardH + cardsGap)
    context.fillStyle = index % 2 ? '#EAF0EE' : '#F5F8F7'; context.fillRect(margin, y, mapW, cardH)
    context.fillStyle = '#B06D1D'; context.font = '700 22px Arial'; context.fillText(`${index + 1}`, margin + 22, y + 34)
    context.fillStyle = '#173C46'; context.font = '700 19px Arial'; context.fillText(record.layerTitle.slice(0, 74), margin + 70, y + 29)
    context.fillStyle = '#526166'; context.font = '16px Arial'; context.fillText(`${geometryLabel(record.geometryType)} · ${String(record.attributes._relacao_espacial || 'interseção')} · ${record.id}`, margin + 70, y + 57)
  })
  const legendY = cardsStart + recordsHeight + 44
  drawLegend(context, records, margin, legendY, mapW)
  return canvas.toDataURL('image/png')
}

const classValue = (record: InterferenceRecord) => {
  const runtimeClass = record.attributes._classe_legenda
  if (runtimeClass && String(runtimeClass).trim() && runtimeClass !== 'Classe não informada') return String(runtimeClass)
  const preferred = ['dsc_macrozone', 'dsc_macrozona', 'dsc_zona', 'nom_nome', 'nome', 'classe', 'classificacao', 'category', 'tipo']
  const entries = Object.entries(record.attributes).filter(([key, value]) => value !== null && value !== undefined && String(value).trim() && !key.startsWith('_'))
  const found = preferred.map((key) => entries.find(([name]) => name.toLowerCase() === key)).find(Boolean)
  return String(found?.[1] ?? entries.find(([key]) => !['objectid', 'id', 'fid'].includes(key.toLowerCase()))?.[1] ?? 'Classe não informada')
}

const exportSummaryPdf = (records: InterferenceRecord[]) => {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = 210; const margin = 16; const groups = new Map<string, Map<string, number>>()
  records.forEach((record) => {
    const layer = groups.get(record.layerTitle) || new Map<string, number>()
    const klass = classValue(record); layer.set(klass, (layer.get(klass) || 0) + 1); groups.set(record.layerTitle, layer)
  })
  let page = 0
  const header = (title: string) => {
    if (page > 0) pdf.addPage()
    page += 1
    pdf.setFillColor(11, 48, 58); pdf.rect(0, 0, pageWidth, 28, 'F')
    pdf.setTextColor(242, 177, 52); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.text('DF LEGAL · ANÁLISE DE INTERFERÊNCIAS', margin, 12)
    pdf.setTextColor(255, 255, 255); pdf.setFontSize(11); pdf.text(title, margin, 21)
    pdf.setTextColor(23, 60, 70); pdf.setFontSize(9); pdf.text(`Página ${page}`, pageWidth - margin - 18, 21)
  }
  header('Relatório consolidado por camada e classe')
  pdf.setTextColor(23, 60, 70); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10)
  pdf.text(`Total de interferências consolidadas: ${records.length}`, margin, 42)
  pdf.text(`Camadas participantes: ${groups.size}`, margin, 49)
  let y = 62
  const drawTableHeader = () => { pdf.setFillColor(23, 60, 70); pdf.rect(margin, y, pageWidth - margin * 2, 9, 'F'); pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.text('CAMADA', margin + 3, y + 6); pdf.text('CLASSE DA INTERFERÊNCIA', margin + 76, y + 6); pdf.text('QTD.', pageWidth - margin - 18, y + 6); y += 9 }
  drawTableHeader()
  for (const [layerTitle, classes] of Array.from(groups.entries())) {
    for (const [klass, count] of Array.from(classes.entries())) {
      if (y > 275) { header('Relatório consolidado — continuação'); y = 42; drawTableHeader() }
      pdf.setFillColor((y / 9) % 2 ? 245 : 234, 248, 247); pdf.rect(margin, y, pageWidth - margin * 2, 12, 'F')
      pdf.setTextColor(23, 60, 70); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.text(layerTitle.slice(0, 34), margin + 3, y + 8)
      pdf.setFont('helvetica', 'normal'); pdf.text(klass.slice(0, 52), margin + 76, y + 8); pdf.text(String(count), pageWidth - margin - 15, y + 8); y += 12
    }
  }
  header('Critérios do consolidado')
  pdf.setTextColor(23, 60, 70); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10)
  pdf.text('Cada registro representa uma feição lógica consolidada e recortada pela área de estudo.', margin, 44)
  pdf.text('A quantidade é agrupada por camada do Web Map e pelo atributo de classe/nome disponível.', margin, 52)
  pdf.text('A seleção de camada no aplicativo controla a visualização e a exportação individual.', margin, 60)
  pdf.save(`relatorio-interferencias-${new Date().toISOString().slice(0,10)}.pdf`)
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
  const [exportingPdfId, setExportingPdfId] = useState<string | null>(null)
  const [exportingBoard, setExportingBoard] = useState(false)
  const [exportingSummary, setExportingSummary] = useState(false)
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null)
  const [layerOpacity, setLayerOpacity] = useState(0.55)
  const [borderWidth, setBorderWidth] = useState(3)

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
      runtime.setLayerOpacity(0.55)
      runtime.setBorderWidth(3)
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
    await runtimeRef.current?.isolateRecord(record)
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

  const exportRecordPdf = async (record: InterferenceRecord) => {
    if (!runtimeRef.current) return
    setExportingPdfId(record.id)
    try { const capture = await runtimeRef.current.captureRecord(record); await exportIndividualPdf(capture, record) }
    catch (error) { setErrors([error instanceof Error ? error.message : 'Não foi possível gerar o PDF desta interferência.']) }
    finally { setExportingPdfId(null) }
  }

  const exportBoard = async (format: 'png' | 'jpg') => {
    if (!runtimeRef.current || !records.length) return
    setExportingBoard(true)
    try {
      const capture = await runtimeRef.current.captureSummary()
      if (format === 'png') { const board = await composeInterferenceBoard(capture, records, 'png'); downloadDataUrl(board, `prancha-interferencias-${new Date().toISOString().slice(0, 10)}.png`) }
      else await exportConsolidatedPdf(capture, records)
    } catch (error) { setErrors([error instanceof Error ? error.message : 'Não foi possível gerar a prancha.']) }
    finally { setExportingBoard(false) }
  }

  const exportSummary = async () => {
    if (!runtimeRef.current || !records.length) return
    setExportingSummary(true)
    try { exportSummaryPdf(records) }
    catch (error) { setErrors([error instanceof Error ? error.message : 'Não foi possível gerar o relatório PDF.']) }
    finally { setExportingSummary(false) }
  }

  const selectLayer = (layerId: string | null) => {
    setSelectedLayerId(layerId)
    runtimeRef.current?.setLayerSelection(layerId)
    setActiveLayerIds(layerId ? [layerId] : layers.map((layer) => layer.id))
  }

  const changeOpacity = (value: number) => {
    setLayerOpacity(value)
    runtimeRef.current?.setLayerOpacity(value)
  }

  const changeBorderWidth = (value: number) => {
    setBorderWidth(value)
    runtimeRef.current?.setBorderWidth(value)
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
      <aside className="relative z-10 flex h-full w-[470px] flex-col border-r border-[#31515A] bg-[#0B303A]/95 shadow-2xl backdrop-blur-md">
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
          {records.length > 0 && <div className="mt-4 rounded border border-[#F2B134]/60 bg-[#173C46] p-3"><label htmlFor="interference-select" className="text-[11px] font-bold uppercase tracking-wider text-[#F4F0E8]">Interferência para exibir/exportar</label><select id="interference-select" value={selectedId || ''} onChange={(event) => { const record = records.find((item) => item.id === event.target.value); if (record) selectRecord(record) }} className="mt-2 w-full min-w-0 rounded border border-[#55747B] bg-[#0B303A] p-2 text-xs text-white"><option value="">Selecione uma interferência…</option>{records.map((record) => <option key={record.id} value={record.id}>{record.layerTitle} — {classValue(record)}</option>)}</select><Button type="button" disabled={!selectedId} onClick={() => { const record = records.find((item) => item.id === selectedId); if (record) selectRecord(record) }} className="mt-2 w-full bg-[#F2B134] text-xs font-bold text-[#172B30] hover:bg-[#FFD166]">Isolar interferência selecionada</Button>{selectedId && <div className="mt-2 grid grid-cols-2 gap-2"><Button type="button" size="sm" onClick={() => { const record = records.find((item) => item.id === selectedId); if (record) exportRecord(record) }} disabled={exportingId === selectedId} className="bg-[#31515A] text-[11px] text-white hover:bg-[#55747B]">{exportingId === selectedId ? 'Gerando…' : 'Exportar PNG'}</Button><Button type="button" size="sm" onClick={() => { const record = records.find((item) => item.id === selectedId); if (record) exportRecordPdf(record) }} disabled={exportingPdfId === selectedId} className="bg-[#31515A] text-[11px] text-white hover:bg-[#55747B]">{exportingPdfId === selectedId ? 'Gerando…' : 'Exportar PDF'}</Button></div>}<p className="mt-2 text-[10px] text-[#B8C9CC]">Apenas interferências com geometria efetivamente dentro da área aparecem nesta lista.</p></div>}


          {records.length > 0 && <section className="mt-6 border-t border-[#31515A] pt-4"><div className="flex items-center justify-between"><h2 className="text-xs font-bold uppercase tracking-[.2em] text-[#B8C9CC]">Interferências detectadas</h2><span className="rounded-full bg-[#F2B134] px-2 py-0.5 text-[10px] font-bold text-[#172B30]">{records.length}</span></div><p className="mt-2 text-[11px] text-[#8FA9AE]">Selecione uma camada para isolar a visualização. O consolidado é exportado em PDF paginado.</p><div className="mt-3 grid gap-2"><Button size="sm" variant="outline" disabled={exportingBoard} onClick={() => exportBoard('jpg')} className="border-[#F2B134] bg-[#F2B134]/10 text-[11px] text-[#F4F0E8] hover:bg-[#F2B134] hover:text-[#172B30]"><Download className="mr-1" size={13} />{exportingBoard ? 'Gerando prancha PDF…' : 'Prancha consolidada PDF paginada'}</Button><Button size="sm" variant="outline" disabled={exportingSummary} onClick={exportSummary} className="border-[#55747B] bg-transparent text-[11px] text-[#F4F0E8] hover:bg-[#F2B134] hover:text-[#172B30]"><Download className="mr-1" size={13} />{exportingSummary ? 'Gerando PDF…' : 'Relatório quantitativo PDF (camada/classe)'}</Button></div><div className="mt-3 space-y-2">{records.map((record) => <article key={record.id} className={`rounded border p-3 transition ${selectedId === record.id ? 'border-[#F2B134] bg-[#F2B134]/15' : 'border-[#31515A] bg-[#0B303A]/70'}`}><button className="w-full text-left" onClick={() => selectRecord(record)}><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-bold text-[#F4F0E8]">{record.layerTitle}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-[#F2B134]">{geometryLabel(record.geometryType)} · {classValue(record)}{record.attributes._identificadores_agrupados ? ` · IDs: ${String(record.attributes._identificadores_agrupados).slice(0, 90)}` : ''}</p></div><span className="text-[10px] text-[#8FA9AE]">{Object.keys(record.attributes).length} atributos</span></div><p className="mt-2 line-clamp-2 text-[11px] text-[#B8C9CC]">{Object.entries(record.attributes).filter(([key]) => !key.startsWith('_')).slice(0, 2).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</p></button><div className="mt-3 grid grid-cols-2 gap-2"><Button size="sm" variant="outline" className="h-7 border-[#55747B] bg-transparent text-[10px] text-[#F4F0E8] hover:bg-[#F2B134] hover:text-[#172B30]" disabled={exportingId === record.id} onClick={() => exportRecord(record)}>{exportingId === record.id ? <LoaderCircle className="mr-1 animate-spin" size={12} /> : <Download className="mr-1" size={12} />}PNG</Button><Button size="sm" variant="outline" className="h-7 border-[#55747B] bg-transparent text-[10px] text-[#F4F0E8] hover:bg-[#F2B134] hover:text-[#172B30]" disabled={exportingPdfId === record.id} onClick={() => exportRecordPdf(record)}>{exportingPdfId === record.id ? <LoaderCircle className="mr-1 animate-spin" size={12} /> : <Download className="mr-1" size={12} />}PDF</Button></div></article>)}</div></section>}
        </div>

        <footer className="space-y-2 border-t border-[#31515A] px-5 py-4"><div className="rounded border border-[#F2B134]/70 bg-[#173C46] p-3"><div className="flex items-center justify-between"><label htmlFor="opacity-global" className="text-[11px] font-bold uppercase tracking-wider text-white">Transparência global</label><span className="text-xs font-bold text-[#F2B134]">{Math.round((1 - layerOpacity) * 100)}%</span></div><input id="opacity-global" type="range" min="0.1" max="1" step="0.05" value={layerOpacity} onChange={(event) => changeOpacity(Number(event.target.value))} className="mt-2 w-full accent-[#F2B134]" /><p className="mt-1 text-[10px] text-[#B8C9CC]">Aplica às camadas, recortes e área de estudo.</p><div className="mt-3 flex items-center justify-between"><label htmlFor="border-global" className="text-[11px] font-bold uppercase tracking-wider text-white">Espessura da borda</label><span className="text-xs font-bold text-[#F2B134]">{borderWidth}px</span></div><input id="border-global" type="range" min="1" max="12" step="1" value={borderWidth} onChange={(event) => changeBorderWidth(Number(event.target.value))} className="mt-2 w-full accent-[#F2B134]" /></div><div className="grid grid-cols-2 gap-2"><Button onClick={drawStudyArea} disabled={drawing || analyzing || !runtimeRef.current} className="bg-[#F2B134] text-[#172B30] hover:bg-[#FFD166]"><Play className="mr-2" size={15} />{drawing ? 'Desenhando…' : '1. Desenhar área'}</Button><Button onClick={analyzeStudyArea} disabled={analyzing || drawing || !studyAreaReady || !runtimeRef.current} className="bg-[#D98E2B] text-[#172B30] hover:bg-[#F2B134]"><Play className="mr-2" size={15} />{analyzing ? 'Analisando…' : '2. Analisar área'}</Button></div><Button onClick={clear} variant="outline" className="w-full border-[#55747B] bg-transparent text-[#F4F0E8] hover:bg-white/10"><Trash2 className="mr-2" size={15} />Limpar área e resultados</Button><Button onClick={() => setShowSettings((value) => !value)} variant="ghost" className="w-full justify-start text-[#B8C9CC] hover:bg-white/5 hover:text-white"><Settings2 className="mr-2" size={15} />Configuração do Portal e Web Map</Button></footer>
      </aside>

      {showSettings && <div className="absolute right-6 top-6 z-20 w-[420px] rounded-lg border border-[#55747B] bg-[#F4F0E8] p-5 text-[#173C46] shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#B06D1D]">Conexão sem alterar o mapa</p><h2 className="mt-1 text-xl font-black">Web Map de interferências</h2></div><Settings2 className="text-[#B06D1D]" size={20} /></div><p className="mt-2 text-xs leading-5 text-[#526166]">A aplicação consulta o item operacional e cria somente gráficos temporários para a área de estudo e os destaques.</p><div className="mt-4 space-y-3"><label className="block text-xs font-bold">Portal Enterprise<Input value={settings.portalUrl} onChange={(event) => setSettings({ ...settings, portalUrl: event.target.value })} className="mt-1 bg-white" /></label><label className="block text-xs font-bold">ID do Web Map<Input value={settings.webMapId} onChange={(event) => setSettings({ ...settings, webMapId: event.target.value })} className="mt-1 bg-white" /></label><label className="block text-xs font-bold">Client ID OAuth<Input value={settings.clientId} onChange={(event) => setSettings({ ...settings, clientId: event.target.value })} placeholder="credencial OAuth do Portal" className="mt-1 bg-white" /></label></div><p className="mt-3 text-[11px] leading-4 text-[#526166]">A Redirect URL desta aplicação é <strong>{window.location.origin}{window.location.pathname}</strong>. Ela precisa estar cadastrada na credencial OAuth; caso contrário, o Portal retorna <strong>Invalid redirect_uri</strong>.</p><Button onClick={loadMap} disabled={loading} className="mt-4 w-full bg-[#173C46] text-white hover:bg-[#0B303A]">{loading ? <LoaderCircle className="mr-2 animate-spin" size={16} /> : <MapPinned className="mr-2" size={16} />}Entrar e carregar Web Map</Button></div>}

      <div className="absolute bottom-4 right-5 z-10 rounded bg-[#F4F0E8]/90 px-3 py-2 text-[10px] text-[#526166] shadow"><strong>Legenda:</strong> área de estudo em vermelho · ponto destacado em azul · linha em ocre · polígono em vermelho · seleção em amarelo</div>
    </main>
  )
}
