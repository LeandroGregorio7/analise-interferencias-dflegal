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
import { parseImportedArea } from '@/lib/imported-geometry'

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
const legendLabel = (record: InterferenceRecord) => `${record.layerTitle} — ${classValue(record)}`
const classEntriesFor = (record: InterferenceRecord) => record.classEntries?.length ? record.classEntries : [{ label: classValue(record), symbol: record.symbol }]
const symbolColor = (symbol?: __esri.Symbol, fallback = '#E63946') => {
  const isBlack = (rgb: number[]) => rgb[0] < 12 && rgb[1] < 12 && rgb[2] < 12
  const toCss = (value: any, allowBlack = false): string | undefined => {
    if (!value) return undefined
    if (value.toRgba) { const rgba = value.toRgba(); if ((rgba[3] ?? 1) > 0.05 && (allowBlack || !isBlack(rgba))) return `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3] ?? 1})` }
    if (Array.isArray(value) && value.length >= 3 && (value[3] ?? 255) > 12 && (allowBlack || !isBlack(value))) return `rgba(${value[0]},${value[1]},${value[2]},${(value[3] ?? 255) / 255})`
    if (typeof value === 'string' && (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) || /^rgba?\(/i.test(value))) {
      if (!allowBlack && /^#0{6,8}$/i.test(value)) return undefined
      return value
    }
    return undefined
  }
  const itemsOf = (value: any) => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : value ? [value] : []
  const fillColor = (value: any, depth = 0): string | undefined => {
    if (!value || depth > 12) return undefined
    for (const item of itemsOf(value)) {
      const type = String(item?.type || item?.layerType || '').toLowerCase()
      if (type.includes('fill') || type.includes('cimpolygon') || type.includes('polygon')) {
        for (const key of ['color', 'fill', 'fillColor', 'paint']) { const found = toCss(item?.[key]); if (found) return found }
      }
      for (const key of ['symbolLayers', 'layers', 'primitiveOverrides', 'symbol', 'marker']) {
        const found = fillColor(item?.[key], depth + 1); if (found) return found
      }
    }
    return undefined
  }
  const candidate: any = symbol
  const json = candidate?.toJSON?.()
  return fillColor(candidate) || fillColor(json) || toCss(candidate?.color) || toCss(json?.color) || fallback
}


const cssRgb = (value: string, fallback: [number, number, number] = [230, 57, 70]): [number, number, number] => {
  const rgba = value.match(/rgba?\(([^)]+)\)/i)?.[1].split(',').map((part) => Number(part.trim()))
  if (rgba && rgba.length >= 3 && rgba.every((part) => Number.isFinite(part))) return [rgba[0], rgba[1], rgba[2]]
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1]
  if (hex) return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
  return fallback
}
const mapColorForLegend = (record: InterferenceRecord, selected = false) => selected ? '#FFD166' : symbolColor(record.symbol, record.geometryType === 'point' ? '#168AAD' : record.geometryType === 'polyline' ? '#F2B134' : '#E63946')

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
  context.font = '600 10px Arial'
  context.textAlign = 'center'
  for (let i = 0; i <= gridCount; i += 1) {
    const px = mapX + (drawW * i) / gridCount
    const py = mapY + (drawH * i) / gridCount
    context.beginPath(); context.moveTo(px, mapY); context.lineTo(px, mapY + drawH); context.stroke()
    context.beginPath(); context.moveTo(mapX, py); context.lineTo(mapX + drawW, py); context.stroke()
    // Topo horizontal: somente X no topo.
    const xValue = xmin + ((xmax - xmin) * i) / gridCount
    context.fillText(xValue.toFixed(0), px, mapY - 7)
    // Lado esquerdo vertical: somente Y, crescendo visualmente de baixo para cima.
    const yValue = ymax - ((ymax - ymin) * i) / gridCount
    context.textAlign = 'right'
    context.fillText(yValue.toFixed(0), mapX - 6, py + 3)
    context.textAlign = 'center'
  }
  context.restore()
}

const drawPdfCoordinateGrid = (pdf: jsPDF, capture: CaptureResult, mapX: number, mapY: number, mapW: number, mapH: number) => {
  if (!capture.extent) return
  const { xmin, ymin, xmax, ymax } = capture.extent; const gridCount = 5
  pdf.setDrawColor(23, 60, 70); pdf.setTextColor(23, 60, 70); pdf.setLineWidth(0.15); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(4.5)
  for (let i = 0; i <= gridCount; i += 1) {
    const px = mapX + (mapW * i) / gridCount; const py = mapY + (mapH * i) / gridCount
    pdf.line(px, mapY, px, mapY + mapH); pdf.line(mapX, py, mapX + mapW, py)
    pdf.text(String(Math.round(xmin + ((xmax - xmin) * i) / gridCount)), px, mapY - 2, { align: 'center' })
    pdf.text(String(Math.round(ymax - ((ymax - ymin) * i) / gridCount)), mapX - 2, py + 2, { align: 'right' })
  }
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
  const entries = records.flatMap((record) => classEntriesFor(record).map((entry) => ({ record, entry })))
  context.fillStyle = '#173C46'; context.font = '700 18px Arial'; context.fillText('LEGENDA DAS CLASSES DAS INTERFERÊNCIAS', x, y)
  let legendX = x; let legendY = y + 30
  entries.forEach(({ record, entry }) => {
    const label = `${record.layerTitle} — ${entry.label}`; const words = label.split(' '); const lines: string[] = []; let line = ''
    words.forEach((word) => { const candidate = line ? `${line} ${word}` : word; if (context.measureText(candidate).width > maxWidth - 42 && line) { lines.push(line); line = word } else line = candidate }); if (line) lines.push(line)
    const itemWidth = Math.min(maxWidth, Math.max(260, context.measureText(lines[0] || label).width + 48))
    if (legendX !== x && legendX + itemWidth > x + maxWidth) { legendX = x; legendY += 48 }
    const swatch = symbolColor(entry.symbol, mapColorForLegend(record)); context.fillStyle = swatch; context.fillRect(legendX, legendY - 15, 24, 16); context.strokeStyle = '#526166'; context.lineWidth = 1; context.strokeRect(legendX, legendY - 15, 24, 16)
    context.fillStyle = '#526166'; context.font = '600 16px Arial'; lines.forEach((text, index) => context.fillText(text, legendX + 34, legendY + index * 20)); legendX += itemWidth
  })
  return legendY + 28
}


const panelLines = (context: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, lineHeight = 22) => {
  const words = value.split(/\s+/); const lines: string[] = []; let line = ''
  context.font = context.font || '16px Arial'
  words.forEach((word) => { const candidate = line ? `${line} ${word}` : word; if (context.measureText(candidate).width > width && line) { lines.push(line); line = word } else line = candidate }); if (line) lines.push(line)
  lines.forEach((text, index) => context.fillText(text, x, y + index * lineHeight))
  return y + Math.max(1, lines.length) * lineHeight
}

const drawAttachmentPanel = (context: CanvasRenderingContext2D, records: InterferenceRecord[], x: number, y: number, width: number, height: number, title: string, subtitle: string) => {
  context.fillStyle = '#FFFFFF'; context.fillRect(x, y, width, height)
  context.fillStyle = '#0B303A'; context.fillRect(x, y, width, 154)
  context.fillStyle = '#FFFFFF'; context.font = '700 34px Arial'; context.fillText('DF Legal', x + 28, y + 48)
  context.font = '700 22px Arial'; context.fillText(title.toUpperCase(), x + 28, y + 86)
  context.font = '16px Arial'; context.fillText(subtitle, x + 28, y + 120)
  const inner = width - 56; let py = y + 205
  context.fillStyle = '#173C46'; context.font = '700 24px Arial'; context.fillText('IDENTIFICAÇÃO', x + 28, py); py += 42
  context.fillStyle = '#526166'; context.font = '600 17px Arial'
  records.slice(0, 2).forEach((record) => { py = panelLines(context, record.layerTitle, x + 28, py, inner, 22) + 5; context.font = '15px Arial'; py = panelLines(context, `Classe: ${classValue(record)}`, x + 28, py, inner, 19) + 9; context.font = '600 17px Arial' })
  context.strokeStyle = '#B06D1D'; context.lineWidth = 2; context.beginPath(); context.moveTo(x + 28, y + 345); context.lineTo(x + width - 28, y + 345); context.stroke()
  context.fillStyle = '#173C46'; context.font = '700 24px Arial'; context.fillText('INFORMAÇÕES', x + 28, y + 386)
  context.fillStyle = '#526166'; context.font = '14px Arial'; let infoY = y + 420
  records.slice(0, 1).forEach((record) => { infoY = panelLines(context, `${geometryLabel(record.geometryType)} · ${String(record.attributes._relacao_espacial || 'interseção')}`, x + 28, infoY, inner, 18) + 4; Object.entries(record.attributes).filter(([key]) => !key.startsWith('_')).slice(0, 7).forEach(([key, value]) => { infoY = panelLines(context, `${key}: ${String(value)}`, x + 28, infoY, inner, 17) + 2 }) })
  const legendTop = y + 620; context.strokeStyle = '#8F3035'; context.beginPath(); context.moveTo(x + 28, legendTop - 28); context.lineTo(x + width - 28, legendTop - 28); context.stroke(); context.fillStyle = '#173C46'; context.font = '700 24px Arial'; context.fillText('LEGENDA', x + 28, legendTop)
  let legendY = legendTop + 34; const entries = records.flatMap((record) => classEntriesFor(record).map((entry) => ({ record, entry })))
  entries.slice(0, 10).forEach(({ record, entry }) => { const color = symbolColor(entry.symbol, mapColorForLegend(record)); context.fillStyle = color; context.fillRect(x + 28, legendY - 14, 22, 14); context.strokeStyle = '#526166'; context.strokeRect(x + 28, legendY - 14, 22, 14); context.fillStyle = '#526166'; context.font = '13px Arial'; legendY = panelLines(context, `${record.layerTitle} — ${entry.label}`, x + 62, legendY - 1, inner - 34, 16) + 5 })
  context.fillStyle = '#526166'; context.font = '12px Arial'; context.fillText(`Gerado em ${new Date().toLocaleString('pt-BR')}`, x + 28, y + height - 28)
}


const composeAttachmentPng = async (capture: CaptureResult, records: InterferenceRecord[], title: string, subtitle: string, filename: string) => {
  const image = await loadImage(capture.dataUrl); const width = 1600; const height = 900; const panelW = 390; const mapX = 22; const mapY = 92; const mapW = width - panelW - 44; const mapH = height - 184
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); if (!context) throw new Error('O navegador não disponibilizou a exportação.')
  context.fillStyle = '#F4F0E8'; context.fillRect(0, 0, width, height); context.fillStyle = '#FFFFFF'; context.fillRect(mapX, mapY - 20, mapW, mapH + 40)
  const ratio = Math.min(mapW / image.width, mapH / image.height); const drawW = image.width * ratio; const drawH = image.height * ratio; const imageX = mapX + (mapW - drawW) / 2; const imageY = mapY + (mapH - drawH) / 2
  context.drawImage(image, imageX, imageY, drawW, drawH); drawCoordinateGrid(context, capture, imageX, imageY, drawW, drawH, drawW, drawH); context.strokeStyle = '#263D42'; context.lineWidth = 3; context.strokeRect(imageX, imageY, drawW, drawH)
  drawAttachmentPanel(context, records, width - panelW, 0, panelW, height, title, subtitle); context.strokeStyle = '#263D42'; context.lineWidth = 2; context.strokeRect(mapX, mapY, mapW, mapH); downloadDataUrl(canvas.toDataURL('image/png'), filename)
}

const composeInterferenceBoard = async (capture: CaptureResult, records: InterferenceRecord[], format: 'png' | 'jpg') => {
  const image = await loadImage(capture.dataUrl); const width = 1600; const height = 900; const panelW = 390; const mapX = 22; const mapY = 92; const mapW = width - panelW - 44; const mapH = height - 184
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); if (!context) throw new Error('O navegador não disponibilizou a prancha de exportação.')
  context.fillStyle = '#F4F0E8'; context.fillRect(0, 0, width, height); context.fillStyle = '#FFFFFF'; context.fillRect(mapX, mapY - 20, mapW, mapH + 40)
  const ratio = Math.min(mapW / image.width, mapH / image.height); const drawW = image.width * ratio; const drawH = image.height * ratio; const imageX = mapX + (mapW - drawW) / 2; const imageY = mapY + (mapH - drawH) / 2
  context.drawImage(image, imageX, imageY, drawW, drawH); drawCoordinateGrid(context, capture, imageX, imageY, drawW, drawH, drawW, drawH); context.strokeStyle = '#263D42'; context.lineWidth = 3; context.strokeRect(imageX, imageY, drawW, drawH)
  drawAttachmentPanel(context, records, width - panelW, 0, panelW, height, 'Mapa analisado', 'Prancha de interferência'); return format === 'jpg' ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png')
}

const exportIndividualPdf = async (capture: CaptureResult, record: InterferenceRecord) => {
  const image = await loadImage(capture.dataUrl); const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }); const W=297,H=210,panelX=224,mapX=18,mapY=16,mapW=202,mapH=184
  pdf.setFillColor(244,240,232); pdf.rect(0,0,W,H,'F'); const ratio=Math.min(mapW/image.width,mapH/image.height); const dw=image.width*ratio,dh=image.height*ratio; const ix=mapX+(mapW-dw)/2,iy=mapY+(mapH-dh)/2; pdf.addImage(image,'PNG',ix,iy,dw,dh); drawPdfCoordinateGrid(pdf,capture,ix,iy,dw,dh); pdf.setDrawColor(38,61,66); pdf.rect(ix,iy,dw,dh); pdf.setFillColor(255,255,255); pdf.rect(panelX,0,W-panelX,H,'F'); pdf.setFillColor(11,48,58); pdf.rect(panelX,0,W-panelX,38,'F'); pdf.setTextColor(255,255,255); pdf.setFont('helvetica','bold'); pdf.setFontSize(16); pdf.text('DF Legal',panelX+7,13); pdf.setFontSize(9); pdf.text('MAPA ANALISADO',panelX+7,23); pdf.setFont('helvetica','normal'); pdf.setFontSize(7); pdf.text('Interferência selecionada',panelX+7,31)
  let y=53; pdf.setTextColor(23,60,70); pdf.setFont('helvetica','bold'); pdf.setFontSize(11); pdf.text('IDENTIFICAÇÃO',panelX+7,y); y+=13; pdf.setFontSize(9); pdf.text(pdf.splitTextToSize(record.layerTitle,64),panelX+7,y); y+=12; pdf.setFont('helvetica','normal'); pdf.setFontSize(8); pdf.text(pdf.splitTextToSize(`Classe: ${classValue(record)}`,64),panelX+7,y); y+=16; pdf.setDrawColor(176,109,29); pdf.line(panelX+7,y,W-7,y); y+=12; pdf.setFont('helvetica','bold'); pdf.setFontSize(10); pdf.text('INFORMAÇÕES',panelX+7,y); y+=10; pdf.setFont('helvetica','normal'); pdf.setFontSize(7.5); pdf.text(pdf.splitTextToSize(`${geometryLabel(record.geometryType)} · ${String(record.attributes._relacao_espacial || 'interseção')}`,64),panelX+7,y); y+=10; Object.entries(record.attributes).filter(([key])=>!key.startsWith('_')).slice(0,10).forEach(([key,value])=>{ pdf.text(pdf.splitTextToSize(`${key}: ${String(value)}`,64),panelX+7,y); y+=7 }); y+=4; pdf.setDrawColor(143,48,53); pdf.line(panelX+7,y,W-7,y); y+=12; pdf.setFont('helvetica','bold'); pdf.setFontSize(10); pdf.text('LEGENDA',panelX+7,y); y+=9; classEntriesFor(record).forEach((entry)=>{ const rgb=cssRgb(symbolColor(entry.symbol,mapColorForLegend(record))); pdf.setFillColor(rgb[0],rgb[1],rgb[2]); pdf.rect(panelX+7,y-4,4,3,'F'); pdf.setTextColor(82,97,102); pdf.setFont('helvetica','normal'); pdf.setFontSize(7); pdf.text(pdf.splitTextToSize(`${record.layerTitle} — ${entry.label}`,57),panelX+14,y); y+=8 }); pdf.setFontSize(6); pdf.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`,panelX+7,H-8); pdf.save(`interferencia-${slug(record.layerTitle)}-${slug(record.id)}.pdf`)
}

const exportConsolidatedPdf = async (capture: CaptureResult, records: InterferenceRecord[]) => {
  const image = await loadImage(capture.dataUrl); const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }); const W=297,H=210,panelX=224,mapX=18,mapY=16,mapW=202,mapH=184
  pdf.setFillColor(244,240,232); pdf.rect(0,0,W,H,'F'); const ratio=Math.min(mapW/image.width,mapH/image.height); const dw=image.width*ratio,dh=image.height*ratio; const ix=mapX+(mapW-dw)/2,iy=mapY+(mapH-dh)/2; pdf.addImage(image,'PNG',ix,iy,dw,dh); drawPdfCoordinateGrid(pdf,capture,ix,iy,dw,dh); pdf.setDrawColor(38,61,66); pdf.rect(ix,iy,dw,dh); pdf.setFillColor(255,255,255); pdf.rect(panelX,0,W-panelX,H,'F'); pdf.setFillColor(11,48,58); pdf.rect(panelX,0,W-panelX,38,'F'); pdf.setTextColor(255,255,255); pdf.setFont('helvetica','bold'); pdf.setFontSize(16); pdf.text('DF Legal',panelX+7,13); pdf.setFontSize(9); pdf.text('MAPA ANALISADO',panelX+7,23); pdf.setFont('helvetica','normal'); pdf.setFontSize(7); pdf.text('Prancha consolidada',panelX+7,31)
  let y=53; pdf.setTextColor(23,60,70); pdf.setFont('helvetica','bold'); pdf.setFontSize(10); pdf.text('IDENTIFICAÇÃO',panelX+7,y); y+=12; pdf.setFont('helvetica','normal'); pdf.setFontSize(8); pdf.text(`Interferências: ${records.length}`,panelX+7,y); y+=7; pdf.text(`Camadas: ${new Set(records.map((record)=>record.layerId)).size}`,panelX+7,y); y+=15; pdf.setDrawColor(176,109,29); pdf.line(panelX+7,y,W-7,y); y+=12; pdf.setFont('helvetica','bold'); pdf.setFontSize(10); pdf.text('LEGENDA',panelX+7,y); y+=10; records.flatMap((record)=>classEntriesFor(record).map((entry)=>({record,entry}))).forEach(({record,entry})=>{ if(y>190){pdf.addPage(); y=20}; const rgb=cssRgb(symbolColor(entry.symbol,mapColorForLegend(record))); pdf.setFillColor(rgb[0],rgb[1],rgb[2]); pdf.rect(panelX+7,y-4,4,3,'F'); pdf.setTextColor(82,97,102); pdf.setFont('helvetica','normal'); pdf.setFontSize(6.5); pdf.text(pdf.splitTextToSize(`${record.layerTitle} — ${entry.label}`,57),panelX+14,y); y+=8 }); pdf.setFontSize(6); pdf.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`,panelX+7,H-8); pdf.save(`prancha-consolidada-interferencias-${new Date().toISOString().slice(0,10)}.pdf`)
}

const composeSummaryInfographic = async (capture: CaptureResult, records: InterferenceRecord[]) => composeInterferenceBoard(capture, records, 'png')


const classValue = (record: InterferenceRecord) => {
  const runtimeClass = record.attributes._classes_legenda || record.attributes._classe_legenda
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
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
      const classLines = pdf.splitTextToSize(klass, 103).slice(0, 3)
      const rowHeight = Math.max(12, classLines.length * 7 + 5)
      if (y + rowHeight > 275) { header('Relatório consolidado — continuação'); y = 42; drawTableHeader() }
      pdf.setFillColor((y / 9) % 2 ? 245 : 234, 248, 247); pdf.rect(margin, y, pageWidth - margin * 2, rowHeight, 'F')
      pdf.setTextColor(23, 60, 70); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.text(layerTitle.slice(0, 34), margin + 3, y + 8)
      pdf.setFont('helvetica', 'normal'); pdf.text(classLines, margin + 76, y + 7, { maxWidth: 103 }); pdf.text(String(count), pageWidth - margin - 15, y + 8); y += rowHeight
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
  const [importedFileName, setImportedFileName] = useState<string | null>(null)

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

  const importStudyArea = async (file?: File) => {
    if (!file || !runtimeRef.current) return
    setDrawing(true); setErrors([]); setRecords([]); setSelectedId(null)
    try {
      const parsed = parseImportedArea(await file.text(), file.name)
      const projected = await runtimeRef.current.setStudyArea(parsed.geometry)
      studyAreaRef.current = projected
      setImportedFileName(file.name)
      setStudyAreaReady(true)
      setStatus(`${parsed.format} carregado: ${file.name}. Agora clique em “Analisar área”.`)
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Não foi possível carregar o arquivo geográfico.'])
      setStatus('Falha ao carregar o arquivo.')
    } finally { setDrawing(false) }
  }

  const selectRecord = async (record: InterferenceRecord) => {
    setSelectedId(record.id)
    setSelectedLayerId(null)
    setActiveLayerIds([])
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

  const toggleLayer = (layerId: string, visible: boolean) => {
    setActiveLayerIds((current) => visible ? Array.from(new Set([...current, layerId])) : current.filter((id) => id !== layerId))
    runtimeRef.current?.setLayerVisibility(layerId, visible)
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
    setRecords([]); setErrors([]); setSelectedId(null); setStudyAreaReady(false); setImportedFileName(null)
    setStatus('Área de estudo e resultados temporários removidos.')
  }

  return (
    <main className="relative h-screen overflow-hidden bg-[#071E27] text-[#F4F0E8]">
      <div ref={mapRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(7,30,39,.96)_0%,rgba(7,30,39,.78)_22%,transparent_48%)]" />
      <aside className="relative z-10 flex h-full w-[560px] min-w-[560px] flex-col border-r border-[#31515A] bg-[#0B303A]/95 shadow-2xl backdrop-blur-md">
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
          {layers.length > 0 && <section className="mt-4 rounded border border-[#55747B] bg-[#0B303A]/80 p-3"><div className="flex items-center justify-between"><h3 className="text-[11px] font-bold uppercase tracking-wider text-[#F2B134]">Visibilidade das camadas</h3><span className="text-[10px] text-[#8FA9AE]">background preservado</span></div><div className="mt-2 max-h-48 space-y-1 overflow-y-auto">{layers.map((layer) => <label key={layer.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-[11px] text-[#DCE7E8] hover:bg-white/5"><input type="checkbox" checked={activeLayerIds.includes(layer.id)} onChange={(event) => toggleLayer(layer.id, event.target.checked)} className="accent-[#F2B134]" /><span className="truncate">{layer.title}</span></label>)}</div><p className="mt-2 text-[10px] text-[#8FA9AE]">Use os controles para mostrar ou ocultar Lotes, Lote LUOS, Ocupações e demais camadas vetoriais sem remover o mapa-base.</p></section>}
          {records.length > 0 && <div className="mt-4 min-h-[190px] rounded border border-[#F2B134]/60 bg-[#173C46] p-4"><label htmlFor="interference-select" className="text-[11px] font-bold uppercase tracking-wider text-[#F4F0E8]">Interferência para exibir/exportar</label><select id="interference-select" value={selectedId || ''} onChange={(event) => { const record = records.find((item) => item.id === event.target.value); if (record) selectRecord(record) }} className="mt-2 w-full min-w-0 rounded border border-[#55747B] bg-[#0B303A] p-3 text-sm leading-6 text-white"><option value="">Selecione uma interferência…</option>{records.map((record) => <option key={record.id} value={record.id}>{record.layerTitle} — {classValue(record)}</option>)}</select><Button type="button" disabled={!selectedId} onClick={() => { const record = records.find((item) => item.id === selectedId); if (record) selectRecord(record) }} className="mt-2 w-full bg-[#F2B134] text-xs font-bold text-[#172B30] hover:bg-[#FFD166]">Isolar interferência selecionada</Button>{selectedId && <div className="mt-2 grid grid-cols-2 gap-2"><Button type="button" size="sm" onClick={() => { const record = records.find((item) => item.id === selectedId); if (record) exportRecord(record) }} disabled={exportingId === selectedId} className="bg-[#31515A] text-[11px] text-white hover:bg-[#55747B]">{exportingId === selectedId ? 'Gerando…' : 'Exportar PNG'}</Button><Button type="button" size="sm" onClick={() => { const record = records.find((item) => item.id === selectedId); if (record) exportRecordPdf(record) }} disabled={exportingPdfId === selectedId} className="bg-[#31515A] text-[11px] text-white hover:bg-[#55747B]">{exportingPdfId === selectedId ? 'Gerando…' : 'Exportar PDF'}</Button></div>}<p className="mt-2 text-[10px] text-[#B8C9CC]">Apenas interferências com geometria efetivamente dentro da área aparecem nesta lista.</p></div>}


          {records.length > 0 && <section className="mt-6 border-t border-[#31515A] pt-4"><div className="flex items-center justify-between"><h2 className="text-xs font-bold uppercase tracking-[.2em] text-[#B8C9CC]">Interferências detectadas</h2><span className="rounded-full bg-[#F2B134] px-2 py-0.5 text-[10px] font-bold text-[#172B30]">{records.length}</span></div><p className="mt-2 text-[11px] text-[#8FA9AE]">Selecione uma camada para isolar a visualização. O consolidado é exportado em PDF paginado.</p><div className="mt-3 grid gap-2"><Button size="sm" variant="outline" disabled={exportingBoard} onClick={() => exportBoard('jpg')} className="border-[#F2B134] bg-[#F2B134]/10 text-[11px] text-[#F4F0E8] hover:bg-[#F2B134] hover:text-[#172B30]"><Download className="mr-1" size={13} />{exportingBoard ? 'Gerando prancha PDF…' : 'Prancha consolidada PDF paginada'}</Button><Button size="sm" variant="outline" disabled={exportingSummary} onClick={exportSummary} className="border-[#55747B] bg-transparent text-[11px] text-[#F4F0E8] hover:bg-[#F2B134] hover:text-[#172B30]"><Download className="mr-1" size={13} />{exportingSummary ? 'Gerando PDF…' : 'Relatório quantitativo PDF (camada/classe)'}</Button></div><div className="mt-3 space-y-2">{records.map((record) => <article key={record.id} className={`rounded border p-3 transition ${selectedId === record.id ? 'border-[#F2B134] bg-[#F2B134]/15' : 'border-[#31515A] bg-[#0B303A]/70'}`}><button className="w-full text-left" onClick={() => selectRecord(record)}><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-bold text-[#F4F0E8]">{record.layerTitle}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-[#F2B134]">{geometryLabel(record.geometryType)} · {classValue(record)}{record.attributes._identificadores_agrupados ? ` · IDs: ${String(record.attributes._identificadores_agrupados).slice(0, 90)}` : ''}</p></div><span className="text-[10px] text-[#8FA9AE]">{Object.keys(record.attributes).length} atributos</span></div><p className="mt-2 line-clamp-2 text-[11px] text-[#B8C9CC]">{Object.entries(record.attributes).filter(([key]) => !key.startsWith('_')).slice(0, 2).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</p></button><div className="mt-3 grid grid-cols-2 gap-2"><Button size="sm" variant="outline" className="h-7 border-[#55747B] bg-transparent text-[10px] text-[#F4F0E8] hover:bg-[#F2B134] hover:text-[#172B30]" disabled={exportingId === record.id} onClick={() => exportRecord(record)}>{exportingId === record.id ? <LoaderCircle className="mr-1 animate-spin" size={12} /> : <Download className="mr-1" size={12} />}PNG</Button><Button size="sm" variant="outline" className="h-7 border-[#55747B] bg-transparent text-[10px] text-[#F4F0E8] hover:bg-[#F2B134] hover:text-[#172B30]" disabled={exportingPdfId === record.id} onClick={() => exportRecordPdf(record)}>{exportingPdfId === record.id ? <LoaderCircle className="mr-1 animate-spin" size={12} /> : <Download className="mr-1" size={12} />}PDF</Button></div></article>)}</div></section>}
        </div>

        <footer className="space-y-2 border-t border-[#31515A] px-5 py-4"><div className="rounded border border-[#F2B134]/70 bg-[#173C46] p-3"><div className="flex items-center justify-between"><label htmlFor="opacity-global" className="text-[11px] font-bold uppercase tracking-wider text-white">Transparência global</label><span className="text-xs font-bold text-[#F2B134]">{Math.round((1 - layerOpacity) * 100)}%</span></div><input id="opacity-global" type="range" min="0.1" max="1" step="0.05" value={layerOpacity} onChange={(event) => changeOpacity(Number(event.target.value))} className="mt-2 w-full accent-[#F2B134]" /><p className="mt-1 text-[10px] text-[#B8C9CC]">Aplica às camadas, recortes e área de estudo.</p><div className="mt-3 flex items-center justify-between"><label htmlFor="border-global" className="text-[11px] font-bold uppercase tracking-wider text-white">Espessura da borda</label><span className="text-xs font-bold text-[#F2B134]">{borderWidth}px</span></div><input id="border-global" type="range" min="1" max="12" step="1" value={borderWidth} onChange={(event) => changeBorderWidth(Number(event.target.value))} className="mt-2 w-full accent-[#F2B134]" /></div><div className="rounded border border-[#55747B] bg-[#173C46] p-3"><p className="text-[11px] font-bold uppercase tracking-wider text-[#F2B134]">Importar área de estudo</p><p className="mt-1 text-[10px] leading-4 text-[#B8C9CC]">Envie .KML ou .GeoJSON com Polygon/MultiPolygon para usar na análise.</p><input id="study-area-file" type="file" accept=".kml,.geojson,.json,application/vnd.google-earth.kml+xml,application/geo+json,application/json" onChange={(event) => importStudyArea(event.target.files?.[0])} disabled={drawing || analyzing || !runtimeRef.current} className="mt-2 block w-full text-[11px] text-[#DCE7E8] file:mr-2 file:rounded file:border-0 file:bg-[#F2B134] file:px-3 file:py-1.5 file:text-[11px] file:font-bold file:text-[#172B30]" />{importedFileName && <p className="mt-2 truncate text-[10px] text-[#F2B134]">Arquivo: {importedFileName}</p>}</div><div className="grid grid-cols-2 gap-2"><Button onClick={drawStudyArea} disabled={drawing || analyzing || !runtimeRef.current} className="bg-[#F2B134] text-[#172B30] hover:bg-[#FFD166]"><Play className="mr-2" size={15} />{drawing ? 'Desenhando…' : '1. Desenhar área'}</Button><Button onClick={analyzeStudyArea} disabled={analyzing || drawing || !studyAreaReady || !runtimeRef.current} className="bg-[#D98E2B] text-[#172B30] hover:bg-[#F2B134]"><Play className="mr-2" size={15} />{analyzing ? 'Analisando…' : '2. Analisar área'}</Button></div><Button onClick={clear} variant="outline" className="w-full border-[#55747B] bg-transparent text-[#F4F0E8] hover:bg-white/10"><Trash2 className="mr-2" size={15} />Limpar área e resultados</Button><Button onClick={() => setShowSettings((value) => !value)} variant="ghost" className="w-full justify-start text-[#B8C9CC] hover:bg-white/5 hover:text-white"><Settings2 className="mr-2" size={15} />Configuração do Portal e Web Map</Button></footer>
      </aside>

      {showSettings && <div className="absolute right-6 top-6 z-20 w-[420px] rounded-lg border border-[#55747B] bg-[#F4F0E8] p-5 text-[#173C46] shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#B06D1D]">Conexão sem alterar o mapa</p><h2 className="mt-1 text-xl font-black">Web Map de interferências</h2></div><Settings2 className="text-[#B06D1D]" size={20} /></div><p className="mt-2 text-xs leading-5 text-[#526166]">A aplicação consulta o item operacional e cria somente gráficos temporários para a área de estudo e os destaques.</p><div className="mt-4 space-y-3"><label className="block text-xs font-bold">Portal Enterprise<Input value={settings.portalUrl} onChange={(event) => setSettings({ ...settings, portalUrl: event.target.value })} className="mt-1 bg-white" /></label><label className="block text-xs font-bold">ID do Web Map<Input value={settings.webMapId} onChange={(event) => setSettings({ ...settings, webMapId: event.target.value })} className="mt-1 bg-white" /></label><label className="block text-xs font-bold">Client ID OAuth<Input value={settings.clientId} onChange={(event) => setSettings({ ...settings, clientId: event.target.value })} placeholder="credencial OAuth do Portal" className="mt-1 bg-white" /></label></div><p className="mt-3 text-[11px] leading-4 text-[#526166]">A Redirect URL desta aplicação é <strong>{window.location.origin}{window.location.pathname}</strong>. Ela precisa estar cadastrada na credencial OAuth; caso contrário, o Portal retorna <strong>Invalid redirect_uri</strong>.</p><Button onClick={loadMap} disabled={loading} className="mt-4 w-full bg-[#173C46] text-white hover:bg-[#0B303A]">{loading ? <LoaderCircle className="mr-2 animate-spin" size={16} /> : <MapPinned className="mr-2" size={16} />}Entrar e carregar Web Map</Button></div>}

      <div className="absolute bottom-4 right-5 z-10 rounded bg-[#F4F0E8]/90 px-3 py-2 text-[10px] text-[#526166] shadow"><strong>Legenda:</strong> área de estudo em vermelho · ponto destacado em azul · linha em ocre · polígono em vermelho · seleção em amarelo</div>
    </main>
  )
}
