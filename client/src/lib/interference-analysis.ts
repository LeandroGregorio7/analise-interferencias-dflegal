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
  analyzeStudyArea: (studyArea: Polygon, activeLayerIds: string[]) => Promise<{ records: InterferenceRecord[]; errors: string[] }>
  highlightRecord: (record: InterferenceRecord) => Promise<void>
  captureRecord: (record: InterferenceRecord) => Promise<string>
  captureMap: () => Promise<string>
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

  const analyzeStudyArea = async (studyArea: Polygon, activeLayerIds: string[]) => {
    resultLayer.removeAll()
    labelLayer.removeAll()
    const records: InterferenceRecord[] = []
    const errors: string[] = []
    const active = layers.filter((entry) => activeLayerIds.includes(entry.id))

    for (const entry of active) {
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
          const record: InterferenceRecord = {
            id: `${entry.id}-${graphic.attributes?.[entry.layer.objectIdField] ?? index}`,
            layerTitle: entry.title,
            layerId: entry.id,
            geometryType: entry.geometryType!,
            graphic,
            attributes: displayAttributes(graphic),
          }
          records.push(record)
          resultLayer.add(new Graphic({ geometry: graphic.geometry, symbol: symbolFor(entry.geometryType!), attributes: { interferenceId: record.id } }))
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

  const captureRecord = async (record: InterferenceRecord) => {
    await highlightRecord(record)
    const screenshot = await view.takeScreenshot({ format: 'png', quality: 95 })
    return screenshot.dataUrl
  }

  const captureMap = async () => {
    const screenshot = await view.takeScreenshot({ format: 'png', quality: 95 })
    return screenshot.dataUrl
  }

  return {
    view,
    layers,
    drawStudyArea,
    analyzeStudyArea,
    highlightRecord,
    captureRecord,
    captureMap,
    clearAnalysis: () => { studyLayer.removeAll(); resultLayer.removeAll(); labelLayer.removeAll() },
    destroy: () => { sketch.destroy(); view.destroy() },
  }
}

export { portalRoot }
