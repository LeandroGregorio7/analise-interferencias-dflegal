/**
 * Runtime da análise de interferências espaciais.
 * O Web Map operacional continua somente leitura: a aplicação adiciona
 * camadas gráficas temporárias para área de estudo e destaques.
 */
import Graphic from '@arcgis/core/Graphic'
import WebMap from '@arcgis/core/WebMap'
import Portal from '@arcgis/core/portal/Portal'
import MapView from '@arcgis/core/views/MapView'
import FeatureLayer from '@arcgis/core/layers/FeatureLayer'
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer'
import SketchViewModel from '@arcgis/core/widgets/Sketch/SketchViewModel'
import Polygon from '@arcgis/core/geometry/Polygon'
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol'
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol'
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol'
import TextSymbol from '@arcgis/core/symbols/TextSymbol'
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine'
import OAuthInfo from '@arcgis/core/identity/OAuthInfo'
import esriId from '@arcgis/core/identity/IdentityManager'

export type InterferenceGeometry = 'point' | 'polyline' | 'polygon'

export interface InterferenceRecord {
  id: string
  layerTitle: string
  layerId: string
  geometryType: InterferenceGeometry
  graphic: Graphic
  attributes: Record<string, unknown>
  symbol?: __esri.Symbol
  involvedLayers?: Array<{ id: string; title: string; symbol?: __esri.Symbol; geometryType?: InterferenceGeometry }>
}

export interface CaptureResult {
  dataUrl: string
  extent?: { xmin: number; ymin: number; xmax: number; ymax: number }
  spatialReference?: { wkid?: number; latestWkid?: number }
}

export interface InterferenceLayerInfo {
  id: string
  title: string
  visible: boolean
  geometryType?: InterferenceGeometry
  layer: FeatureLayer
}

export interface InterferenceRuntime {
  view: MapView
  layers: InterferenceLayerInfo[]
  drawStudyArea: () => Promise<Polygon | null>
  analyzeStudyArea: (studyArea: Polygon) => Promise<{ records: InterferenceRecord[]; errors: string[] }>
  highlightRecord: (record: InterferenceRecord) => Promise<void>
  isolateRecord: (record: InterferenceRecord) => Promise<void>
  captureRecord: (record: InterferenceRecord) => Promise<CaptureResult>
  captureMap: () => Promise<CaptureResult>
  captureSummary: () => Promise<CaptureResult>
  setLayerSelection: (layerId: string | null) => void
  setLayerOpacity: (opacity: number) => void
  clearAnalysis: () => void
  destroy: () => void
}

const portalRoot = 'https://monitora.dflegal.df.gov.br/portal'
const studyColor: [number, number, number, number] = [214, 45, 53, 0.18]
const highlightColors: Record<InterferenceGeometry, string> = {
  point: '#168AAD',
  polyline: '#F2B134',
  polygon: '#E63946',
}

export async function ensureEnterpriseCredential(portalUrl: string, clientId: string) {
  const clean = portalUrl.replace(/\/$/, '')
  if (!clientId.trim()) throw new Error('Informe o Client ID OAuth do Portal Enterprise.')
  const info = new OAuthInfo({
    appId: clientId.trim(),
    portalUrl: clean,
    flowType: 'authorization-code',
    popup: false,
  })
  esriId.registerOAuthInfos([info])
  return esriId.getCredential(`${clean}/sharing`, { oAuthPopupConfirmation: false })
}

const geometryTypeOf = (layer: FeatureLayer): InterferenceGeometry | undefined => {
  const type = layer.geometryType
  if (type === 'point' || type === 'multipoint') return 'point'
  if (type === 'polyline') return 'polyline'
  if (type === 'polygon') return 'polygon'
  return undefined
}

const displayAttributes = (graphic: Graphic) => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(graphic.attributes || {})) {
    if (key.toLowerCase().includes('shape__')) continue
    if (value === null || value === undefined || String(value).trim() === '') continue
    result[key] = value
  }
  return result
}

const symbolFor = (geometryType: InterferenceGeometry, selected = false) => {
  const color = selected ? '#FFD166' : highlightColors[geometryType]
  if (geometryType === 'point') {
    return new SimpleMarkerSymbol({ style: 'circle', color, size: selected ? 15 : 10, outline: { color: '#FFFFFF', width: 1.5 } })
  }
  if (geometryType === 'polyline') {
    return new SimpleLineSymbol({ color, width: selected ? 5 : 3, style: 'solid' })
  }
  return new SimpleFillSymbol({ color: selected ? '#FFD166' : '#E63946', outline: new SimpleLineSymbol({ color, width: selected ? 5 : 3 }) })
}

export async function createInterferenceRuntime(
  container: HTMLDivElement,
  settings: { portalUrl: string; webMapId: string; clientId: string },
): Promise<InterferenceRuntime> {
  await ensureEnterpriseCredential(settings.portalUrl, settings.clientId)
  const portal = new Portal({ url: settings.portalUrl.replace(/\/$/, '') })
  const webmap = new WebMap({ portalItem: { id: settings.webMapId.trim(), portal } })
  await webmap.loadAll()

  const view = new MapView({
    container,
    map: webmap,
    popupEnabled: false,
    constraints: { snapToZoom: false },
    ui: { components: ['zoom', 'compass', 'attribution'] },
  })
  await view.when()

  const studyLayer = new GraphicsLayer({ title: 'Área de estudo — temporária', listMode: 'hide' })
  const resultLayer = new GraphicsLayer({ title: 'Interferências — temporárias', listMode: 'hide' })
  const labelLayer = new GraphicsLayer({ title: 'Rótulos — temporários', listMode: 'hide' })
  webmap.addMany([studyLayer, resultLayer, labelLayer])

  const layers: InterferenceLayerInfo[] = []
  webmap.allLayers.forEach((item) => {
    if (item.type !== 'feature') return
    const layer = item as FeatureLayer
    const geometryType = geometryTypeOf(layer)
    if (!geometryType) return
    layers.push({ id: layer.id, title: layer.title || layer.id, visible: layer.visible, geometryType, layer })
  })
  await Promise.all(layers.map(async (entry) => {
    try { await entry.layer.load() } catch { /* erro individual é informado durante a análise */ }
  }))

  const sketch = new SketchViewModel({
    view,
    layer: studyLayer,
    polygonSymbol: new SimpleFillSymbol({ color: studyColor, outline: new SimpleLineSymbol({ color: '#D62D35', width: 3 }) }),
  })

  const drawStudyArea = async () => {
    studyLayer.removeAll()
    resultLayer.removeAll()
    labelLayer.removeAll()
    const graphic = await new Promise<Graphic | null>((resolve) => {
      const handle = sketch.on('create', (event) => {
        if (event.state === 'complete') {
          handle.remove()
          resolve(event.graphic)
        }
      })
      sketch.create('polygon')
    })
    return graphic?.geometry?.type === 'polygon' ? graphic.geometry as Polygon : null
  }

  const analyzeStudyArea = async (studyArea: Polygon) => {
    resultLayer.removeAll()
    labelLayer.removeAll()
    const records: InterferenceRecord[] = []
    const errors: string[] = []
    const byLogicalFeature = new Map<string, InterferenceRecord>()

    for (const entry of layers) {
      try {
        const query = entry.layer.createQuery()
        query.geometry = studyArea
        query.spatialRelationship = 'intersects'
        query.returnGeometry = true
        query.outFields = ['*']
        query.num = 2000
        const response = await entry.layer.queryFeatures(query)
        response.features.forEach((graphic, index) => {
          if (!graphic.geometry) return
          const intersects = geometryEngine.intersects(studyArea, graphic.geometry)
          if (!intersects) return
          const rawIntersection = geometryEngine.intersect(studyArea, graphic.geometry)
          const clippedGeometry = Array.isArray(rawIntersection)
            ? rawIntersection.length === 1 ? rawIntersection[0] : geometryEngine.union(rawIntersection)
            : rawIntersection
          if (!clippedGeometry) return
          // Interferência somente existe quando há parte efetiva da feição
          // dentro da área. Um simples toque no limite não é ocorrência.
          const meaningful = entry.geometryType === 'polygon'
            ? clippedGeometry.type === 'polygon' && geometryEngine.geodesicArea(clippedGeometry as __esri.Polygon, 'square-meters') > 0.01
            : entry.geometryType === 'polyline'
              ? clippedGeometry.type === 'polyline' && geometryEngine.geodesicLength(clippedGeometry as __esri.Polyline, 'meters') > 0.01
              : clippedGeometry.type === 'point' && geometryEngine.contains(studyArea, graphic.geometry)
          if (!meaningful) return
          const relation = geometryEngine.contains(studyArea, graphic.geometry)
            ? 'circunscrita'
            : geometryEngine.touches(studyArea, graphic.geometry)
              ? 'toca'
              : geometryEngine.overlaps(studyArea, graphic.geometry)
                ? 'sobreposição'
                : 'interseção'
          const sourceSymbol = (entry.layer.renderer as any)?.getSymbol?.(graphic) ?? symbolFor(entry.geometryType!)
          const clippedGraphic = new Graphic({ geometry: clippedGeometry, attributes: graphic.attributes, symbol: sourceSymbol })
          const objectId = graphic.attributes?.[entry.layer.objectIdField]
          // Uma mesma feição pode retornar mais de um fragmento (multipart/dissolve).
          // A unidade selecionável deve ser a feição lógica, não cada fragmento.
          const logicalKey = `${entry.id}:${objectId ?? JSON.stringify(displayAttributes(graphic))}`
          const existing = byLogicalFeature.get(logicalKey)
          if (existing) {
            const merged = geometryEngine.union([existing.graphic.geometry!, clippedGeometry])
            if (merged) {
              existing.graphic.geometry = merged as __esri.Geometry
              const previousRelation = String(existing.attributes._relacao_espacial || '')
              existing.attributes._relacao_espacial = previousRelation === relation ? relation : 'interseção'
              // Mantém uma única geometria desenhada para a feição lógica consolidada.
              resultLayer.graphics.toArray()
                .filter((item) => item.attributes?.interferenceId === existing.id)
                .forEach((item) => resultLayer.remove(item))
              resultLayer.add(new Graphic({ geometry: merged as __esri.Geometry, symbol: existing.symbol as any, attributes: { interferenceId: existing.id, layerId: existing.layerId, layerTitle: existing.layerTitle, logicalKey } }))
            }
            return
          }
          const record: InterferenceRecord = {
            id: `${entry.id}-${objectId ?? index}`,
            layerTitle: entry.title,
            layerId: entry.id,
            geometryType: entry.geometryType!,
            graphic: clippedGraphic,
            symbol: sourceSymbol,
            involvedLayers: [{ id: entry.id, title: entry.title, symbol: sourceSymbol, geometryType: entry.geometryType }],
            attributes: { ...displayAttributes(graphic), _relacao_espacial: relation, _feicao_logica: objectId ?? 'sem OBJECTID' },
          }
          byLogicalFeature.set(logicalKey, record)
          records.push(record)
          resultLayer.add(new Graphic({ geometry: clippedGeometry, symbol: sourceSymbol, attributes: { interferenceId: record.id, layerId: entry.id, layerTitle: entry.title, logicalKey } }))
        })
      } catch (error) {
        errors.push(`${entry.title}: ${error instanceof Error ? error.message : 'não foi possível consultar a camada'}`)
      }
    }

    if (records.length) {
      await view.goTo(studyArea, { duration: 400 })
    }
    return { records, errors }
  }

  const highlightRecord = async (record: InterferenceRecord) => {
    resultLayer.graphics.forEach((graphic) => {
      const isSelected = graphic.attributes?.interferenceId === record.id
      graphic.symbol = symbolFor(record.geometryType, isSelected)
    })
    labelLayer.removeAll()
    const geometry = record.graphic.geometry
    if (geometry) {
      labelLayer.add(new Graphic({
        geometry: geometry.type === 'point' ? geometry : geometry.extent?.center,
        symbol: new TextSymbol({ text: record.layerTitle, color: '#1D3557', haloColor: '#FFFFFF', haloSize: 2, font: { size: 10, weight: 'bold' } }),
      }))
      await view.goTo(geometry, { duration: 450 })
    }
  }

  const isolateRecord = async (record: InterferenceRecord) => {
    // Selecionar no dropdown significa isolar: oculta camadas originais,
    // outras ocorrências e deixa somente o recorte escolhido no mapa.
    layers.forEach((entry) => { entry.layer.visible = false })
    resultLayer.graphics.forEach((graphic) => { graphic.visible = graphic.attributes?.interferenceId === record.id })
    labelLayer.removeAll()
    const geometry = record.graphic.geometry
    if (geometry) {
      labelLayer.add(new Graphic({
        geometry: geometry.type === 'point' ? geometry : geometry.extent?.center,
        symbol: new TextSymbol({ text: record.layerTitle, color: '#1D3557', haloColor: '#FFFFFF', haloSize: 2, font: { size: 10, weight: 'bold' } }),
      }))
      await view.goTo(geometry, { duration: 450 })
    }
  }

  const captureIsolated = async (record?: InterferenceRecord) => {
    const featureLayers = layers.map((entry) => ({ layer: entry.layer, visible: entry.layer.visible, opacity: entry.layer.opacity }))
    const resultGraphics = resultLayer.graphics.toArray().map((graphic) => ({ graphic, visible: graphic.visible }))
    const studyVisible = studyLayer.visible
    const labelsVisible = labelLayer.visible
    try {
      // A captura nunca usa o estado acumulado da tela: só os gráficos recortados pedidos.
      featureLayers.forEach(({ layer }) => { layer.visible = false })
      studyLayer.visible = false
      labelLayer.visible = false
      resultGraphics.forEach(({ graphic }) => {
        graphic.visible = record ? graphic.attributes?.interferenceId === record.id : true
      })
      if (record) await view.goTo(record.graphic.geometry, { duration: 350 })
      const screenshot = await view.takeScreenshot({ format: 'png', quality: 95 })
      const extent = view.extent
      return {
        dataUrl: screenshot.dataUrl,
        extent: extent ? { xmin: extent.xmin, ymin: extent.ymin, xmax: extent.xmax, ymax: extent.ymax } : undefined,
        spatialReference: extent?.spatialReference ? { wkid: extent.spatialReference.wkid ?? undefined, latestWkid: (extent.spatialReference as any).latestWkid ?? undefined } : undefined,
      }
    } finally {
      featureLayers.forEach(({ layer, visible, opacity }) => { layer.visible = visible; layer.opacity = opacity })
      studyLayer.visible = studyVisible
      labelLayer.visible = labelsVisible
      resultGraphics.forEach(({ graphic, visible }) => { graphic.visible = visible })
    }
  }

  const captureRecord = async (record: InterferenceRecord) => {
    // Garante que o modo de exportação sempre parte da ocorrência selecionada,
    // independentemente do estado visual anterior do mapa.
    await highlightRecord(record)
    return captureIsolated(record)
  }
  const captureSummary = async () => captureIsolated()
  const captureMap = async () => captureSummary()
  const setLayerSelection = (layerId: string | null) => {
    // Explicitamente desliga todas as camadas antes de ligar a escolhida.
    layers.forEach((entry) => { entry.layer.visible = false })
    if (layerId) layers.find((entry) => entry.id === layerId)?.layer && (layers.find((entry) => entry.id === layerId)!.layer.visible = true)
    resultLayer.graphics.forEach((graphic) => {
      graphic.visible = layerId === null || graphic.attributes?.layerId === layerId || graphic.attributes?.interferenceId?.startsWith(`${layerId}-`)
    })
  }
  const setLayerOpacity = (opacity: number) => {
    layers.forEach((entry) => { entry.layer.opacity = Math.max(0.1, Math.min(1, opacity)) })
  }

  return {
    view,
    layers,
    drawStudyArea,
    analyzeStudyArea,
    highlightRecord,
    isolateRecord,
    captureRecord,
    captureMap,
    captureSummary,
    setLayerSelection,
    setLayerOpacity,
    clearAnalysis: () => { studyLayer.removeAll(); resultLayer.removeAll(); labelLayer.removeAll() },
    destroy: () => { sketch.destroy(); view.destroy() },
  }
}

export { portalRoot }
