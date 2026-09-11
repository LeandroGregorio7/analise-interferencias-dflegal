/**
 * Carta Técnica Operacional: integra o MapView com operações cartográficas
 * explícitas. Azul = referência, ocre = cotas, vermelho = área pública.
 */
import Graphic from '@arcgis/core/Graphic'
import WebMap from '@arcgis/core/WebMap'
import Portal from '@arcgis/core/portal/Portal'
import MapView from '@arcgis/core/views/MapView'
import FeatureLayer from '@arcgis/core/layers/FeatureLayer'
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer'
import Point from '@arcgis/core/geometry/Point'
import Polygon from '@arcgis/core/geometry/Polygon'
import Polyline from '@arcgis/core/geometry/Polyline'
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine'
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils'
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol'
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol'
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol'
import TextSymbol from '@arcgis/core/symbols/TextSymbol'
import PrintTemplate from '@arcgis/core/rest/support/PrintTemplate'
import PrintParameters from '@arcgis/core/rest/support/PrintParameters'
import * as print from '@arcgis/core/rest/print'
import OAuthInfo from '@arcgis/core/identity/OAuthInfo'
import esriId from '@arcgis/core/identity/IdentityManager'

export type FeatureKind = 'lote' | 'ocupacao'

export async function ensurePortalCredential(portalUrl: string, clientId: string) {
  const cleanPortalUrl = portalUrl.replace(/\/$/, '')
  const oauthInfo = new OAuthInfo({
    appId: clientId,
    portalUrl: cleanPortalUrl,
    flowType: 'authorization-code',
    popup: false,
  })
  esriId.registerOAuthInfos([oauthInfo])
  return esriId.getCredential(`${cleanPortalUrl}/sharing`, { oAuthPopupConfirmation: false })
}

export interface AppMapSettings {
  portalUrl: string
  webMapId: string
  lotLayerTitle: string
  occupationLayerTitle: string
  lotAreaField: string
  occupationAreaField: string
  printServiceUrl: string
  layoutName: string
}

export interface SelectedFeature {
  kind: FeatureKind
  graphic: Graphic
  title: string
  reportedArea: number
  address?: string
}

export interface DimensionItem {
  label: string
  length: number
}

export interface MapCapture {
  dataUrl: string
  extent: { xmin: number; ymin: number; xmax: number; ymax: number }
  geographicExtent: { xmin: number; ymin: number; xmax: number; ymax: number }
  spatialReference: { wkid?: number; latestWkid?: number; wkt?: string }
  scale: number
  zoom: number
}

export interface PublicAreaResult {
  lot: SelectedFeature
  occupation: SelectedFeature
  reportedLotArea: number
  reportedOccupationArea: number
  numericalExcess: number
  geometricPublicArea: number
  hasPublicArea: boolean
  note: string
}

export interface AnalysisRuntime {
  view: MapView
  layerTitles: string[]
  setSelectionMode: (mode: FeatureKind) => void
  searchFeatures: (mode: FeatureKind, searchText: string) => Promise<SelectedFeature[]>
  selectFeature: (selection: SelectedFeature, zoomToFeature?: boolean) => Promise<void>
  drawDimensions: (lote: SelectedFeature) => DimensionItem[]
  analysePublicArea: (ocupacao: SelectedFeature) => Promise<PublicAreaResult>
  clearGraphics: () => void
  printAnalysis: (settings: AppMapSettings, title: string, analysisText: string, selectionText: string) => Promise<string>
  exportMapImage: (format: 'png' | 'jpg') => Promise<MapCapture>
  destroy: () => void
}

const dimensionColor = '#C58A28'
const alertColor = '#B93835'

const numberFromValue = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const normalized = value.replace(/\./g, '').replace(',', '.')
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

type GeometryResult = __esri.Geometry | __esri.Geometry[] | null | undefined

const geodesicArea = (geometry: GeometryResult): number => {
  if (!geometry) return 0
  if (Array.isArray(geometry)) return geometry.reduce((total, part) => total + geodesicArea(part), 0)
  if (geometry.type !== 'polygon') return 0
  return Math.abs(geometryEngine.geodesicArea(geometry as Polygon, 'square-meters') || 0)
}

const firstGeometry = (geometry: GeometryResult) => Array.isArray(geometry) ? geometry[0] : geometry

const reportedOrGeometricArea = (graphic: Graphic, fieldName: string) => {
  const reported = numberFromValue(graphic.attributes?.[fieldName])
  return reported > 0 ? reported : geodesicArea(graphic.geometry)
}

const featureTitle = (layer: FeatureLayer, graphic: Graphic) => {
  const objectId = graphic.attributes?.[layer.objectIdField]
  return `${layer.title}${objectId === undefined || objectId === null ? '' : ` · ${objectId}`}`
}

const normalizeAngle = (angle: number) => {
  let normalized = angle
  if (normalized > 90) normalized -= 180
  if (normalized < -90) normalized += 180
  return normalized
}

const sameVertex = (first: number[], second: number[]) =>
  Math.abs(first[0] - second[0]) < 0.000001 && Math.abs(first[1] - second[1]) < 0.000001

const normalizedRing = (ring: number[][]) => {
  const vertices: number[][] = []
  for (const vertex of ring) {
    if (!vertices.length || !sameVertex(vertices[vertices.length - 1], vertex)) vertices.push(vertex)
  }
  while (vertices.length > 1 && sameVertex(vertices[0], vertices[vertices.length - 1])) vertices.pop()
  return vertices
}

const makeSelection = (kind: FeatureKind, graphic: Graphic, layer: FeatureLayer, settings: AppMapSettings, addressField?: string): SelectedFeature => ({
  kind,
  graphic,
  title: featureTitle(layer, graphic),
  reportedArea: reportedOrGeometricArea(graphic, kind === 'lote' ? settings.lotAreaField : settings.occupationAreaField),
  address: addressField ? String(graphic.attributes?.[addressField] ?? '').trim() || undefined : undefined,
})

const ensurePolygon = (graphic: Graphic, layerLabel: string) => {
  if (!graphic.geometry || graphic.geometry.type !== 'polygon') {
    throw new Error(`${layerLabel} não possui uma geometria poligonal disponível.`)
  }
  return graphic.geometry as Polygon
}

const findFeatureLayer = (webmap: WebMap, title: string) =>
  webmap.allLayers.find((layer) => layer.type === 'feature' && layer.title === title) as FeatureLayer | undefined

const buildDimensionGraphics = (polygon: Polygon, viewResolution: number) => {
  const outerRing = polygon.rings[0]
  if (!outerRing || outerRing.length < 3) throw new Error('O lote selecionado não possui vértices suficientes para cotagem.')

  const vertices = normalizedRing(outerRing)
  if (vertices.length < 3) throw new Error('O lote selecionado não possui segmentos válidos para cotagem.')

  const centroid = polygon.centroid
  const offsetDistance = Math.max(2, viewResolution * 24)
  const graphics: Graphic[] = []
  const dimensions: DimensionItem[] = []

  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index]
    const end = vertices[(index + 1) % vertices.length]
    const segment = new Polyline({
      spatialReference: polygon.spatialReference,
      paths: [[start, end]],
    })
    const length = geometryEngine.geodesicLength(segment, 'meters') || 0
    if (length < 0.01) continue

    const lengths = vertices.map((vertex, vertexIndex) => {
      const next = vertices[(vertexIndex + 1) % vertices.length]
      return Math.hypot(next[0] - vertex[0], next[1] - vertex[1])
    }).filter((value) => value > 0)
    const sortedLengths = [...lengths].sort((a, b) => a - b)
    const medianLength = sortedLengths[Math.floor(sortedLengths.length / 2)] || length
    const firstIsLength = (lengths[0] || length) >= (lengths[1] || length)
    const isLength = vertices.length === 4
      ? (index % 2 === 0 ? firstIsLength : !firstIsLength)
      : length >= medianLength
    const label = isLength ? 'Comprimento' : 'Largura'
    const text = `${label}: ${length.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    const planarLength = Math.hypot(dx, dy)
    if (!planarLength) continue
    const angle = normalizeAngle((Math.atan2(dy, dx) * 180) / Math.PI)
    const midpoint = new Point({
      x: (start[0] + end[0]) / 2,
      y: (start[1] + end[1]) / 2,
      spatialReference: polygon.spatialReference,
    })
    let normalX = -dy / planarLength
    let normalY = dx / planarLength
    if (centroid && (midpoint.x - centroid.x) * normalX + (midpoint.y - centroid.y) * normalY < 0) {
      normalX *= -1
      normalY *= -1
    }
    const offsetStart = [start[0] + normalX * offsetDistance, start[1] + normalY * offsetDistance]
    const offsetEnd = [end[0] + normalX * offsetDistance, end[1] + normalY * offsetDistance]
    const labelPoint = new Point({
      x: midpoint.x + normalX * offsetDistance,
      y: midpoint.y + normalY * offsetDistance,
      spatialReference: polygon.spatialReference,
    })
    const dimensionLine = new Polyline({ spatialReference: polygon.spatialReference, paths: [[offsetStart, offsetEnd]] })
    const extensionStart = new Polyline({ spatialReference: polygon.spatialReference, paths: [[start, offsetStart]] })
    const extensionEnd = new Polyline({ spatialReference: polygon.spatialReference, paths: [[end, offsetEnd]] })

    graphics.push(
      new Graphic({
        geometry: dimensionLine,
        symbol: new SimpleLineSymbol({ color: dimensionColor, width: 2.1, style: 'solid' }),
        attributes: { analysisType: 'dimension-line', segment: label, lengthMeters: length },
      }),
      new Graphic({
        geometry: extensionStart,
        symbol: new SimpleLineSymbol({ color: dimensionColor, width: 1.2, style: 'short-dot' }),
      }),
      new Graphic({
        geometry: extensionEnd,
        symbol: new SimpleLineSymbol({ color: dimensionColor, width: 1.2, style: 'short-dot' }),
      }),
      new Graphic({
        geometry: labelPoint,
        symbol: new TextSymbol({
          text,
          color: '#725016',
          haloColor: '#FFFDF6',
          haloSize: 2.2,
          angle,
          yoffset: 0,
          font: { family: 'Source Sans 3', size: 11, weight: 'bold' },
        }),
        attributes: { analysisType: 'dimension-label', segment: label, lengthMeters: length },
      }),
      new Graphic({
        geometry: new Point({ x: start[0], y: start[1], spatialReference: polygon.spatialReference }),
        symbol: new SimpleMarkerSymbol({ style: 'x', color: dimensionColor, size: 7, outline: { color: '#FFFDF6', width: 0.7 } }),
      }),
    )
    dimensions.push({ label, length })
  }

  return { graphics, dimensions }
}

const getLargestIntersectingLot = async (occupation: SelectedFeature, lotLayer: FeatureLayer, settings: AppMapSettings) => {
  const occupationGeometry = ensurePolygon(occupation.graphic, 'A ocupação selecionada')
  const query = lotLayer.createQuery()
  query.geometry = occupationGeometry
  query.spatialRelationship = 'intersects'
  query.returnGeometry = true
  query.outFields = ['*']
  const response = await lotLayer.queryFeatures(query)

  if (!response.features.length) throw new Error('Nenhum lote intersecta a ocupação selecionada.')

  const candidates = response.features.filter((candidate) => Boolean(candidate.geometry))
  if (!candidates.length) throw new Error('Os lotes encontrados não retornaram geometria para a análise.')

  const bestMatch = candidates.reduce((currentBest, candidate) => {
    const candidateIntersection = geometryEngine.intersect(occupationGeometry, candidate.geometry!)
    const bestIntersection = geometryEngine.intersect(occupationGeometry, currentBest.geometry!)
    return geodesicArea(candidateIntersection) > geodesicArea(bestIntersection) ? candidate : currentBest
  })

  return makeSelection('lote', bestMatch, lotLayer, settings)
}

export async function createAnalysisRuntime(
  container: HTMLDivElement,
  settings: AppMapSettings,
  onSelection: (selection: SelectedFeature) => void,
  getSelectionMode: () => FeatureKind,
): Promise<AnalysisRuntime> {
  const portal = new Portal({ url: settings.portalUrl.replace(/\/$/, '') })
  const webmap = new WebMap({ portalItem: { id: settings.webMapId.trim(), portal } })
  await webmap.loadAll()

  const view = new MapView({
    container,
    map: webmap,
    constraints: { snapToZoom: false },
    popupEnabled: false,
    ui: { components: ['zoom', 'compass', 'attribution'] },
  })
  await view.when()

  const hatchLayer = new GraphicsLayer({ title: 'Análise temporária — área pública', listMode: 'hide' })
  const dimensionLayer = new GraphicsLayer({ title: 'Análise temporária — cotas', listMode: 'hide' })
  const selectionLayer = new GraphicsLayer({ title: 'Análise temporária — seleção', listMode: 'hide' })
  webmap.addMany([hatchLayer, dimensionLayer, selectionLayer])

  const lotLayer = findFeatureLayer(webmap, settings.lotLayerTitle)
  const occupationLayer = findFeatureLayer(webmap, settings.occupationLayerTitle)
  if (!lotLayer || !occupationLayer) {
    const available = webmap.allLayers.map((layer) => layer.title).filter(Boolean).join(' | ')
    throw new Error(`Não encontrei uma das camadas configuradas. Camadas disponíveis: ${available || 'nenhuma'}.`)
  }

  // O Web Map operacional mantém esta camada desligada. Ela é exibida somente
  // durante a escolha de ocupação, sem salvar nem modificar o item do Portal.
  // As duas camadas operacionais ficam visíveis; o modo controla apenas qual delas recebe o clique.
  // Isso preserva a leitura conjunta do lote e da ocupação sem editar o Web Map do Portal.
  lotLayer.visible = true
  occupationLayer.visible = true
  occupationLayer.opacity = 0.34
  lotLayer.opacity = 0.82

  const selectFeature = async (selected: SelectedFeature, zoomToFeature = false) => {
    selectionLayer.graphics
      .toArray()
      .filter((graphic) => graphic.attributes?.selectedKind === selected.kind)
      .forEach((graphic) => selectionLayer.remove(graphic))
    const geometry = selected.graphic.geometry
    if (geometry?.type === 'polygon') {
      const color = selected.kind === 'lote' ? [0, 224, 255, 0.16] : [255, 79, 126, 0.16]
      const outline = selected.kind === 'lote' ? '#00DDF5' : '#FF4779'
      selectionLayer.add(new Graphic({
        geometry,
        symbol: new SimpleFillSymbol({
          style: 'solid',
          color,
          outline: new SimpleLineSymbol({ color: outline, width: 4 }),
        }),
        attributes: { analysisType: 'selected-feature', selectedKind: selected.kind },
      }))
    }
    onSelection(selected)
    if (zoomToFeature && geometry) await view.goTo(geometry, { duration: 550 })
  }

  const searchFeatures = async (kind: FeatureKind, searchText: string) => {
    const value = searchText.trim().replace(/'/g, "''")
    if (value.length < 2) return []
    const layer = kind === 'lote' ? lotLayer : occupationLayer
    const availableFields = new Set(layer.fields.map((field) => field.name.toLowerCase()))
    const candidates = kind === 'lote'
      ? ['pu_ciu', 'end_car', 'pu_end_car', 'pu_end_usu']
      : ['ct_ciu', 'end_car', 'lt_enderec', 'lt_nome']
    const fields = candidates.filter((field) => availableFields.has(field.toLowerCase()))
    const addressField = (kind === 'lote' ? ['end_car', 'pu_end_car', 'pu_end_usu'] : ['end_car', 'lt_enderec', 'lt_nome'])
      .find((field) => availableFields.has(field.toLowerCase()))
    if (!fields.length) throw new Error(`A camada ${layer.title} não possui campos de CIU ou endereço configurados.`)
    const query = layer.createQuery()
    query.where = fields.map((field) => `UPPER(${field}) LIKE UPPER('%${value}%')`).join(' OR ')
    query.outFields = ['*']
    query.returnGeometry = true
    query.num = 8
    const response = await layer.queryFeatures(query)
    return response.features.map((graphic) => makeSelection(kind, graphic, layer, settings, addressField))
  }

  const clickHandle = view.on('click', async (event) => {
    const kind = getSelectionMode()
    const targetLayer = kind === 'lote' ? lotLayer : occupationLayer
    const query = targetLayer.createQuery()
    query.geometry = event.mapPoint
    query.spatialRelationship = 'intersects'
    query.returnGeometry = true
    query.outFields = ['*']
    query.num = 1
    const response = await targetLayer.queryFeatures(query)
    const graphic = response.features[0]
    if (!graphic) return

    await selectFeature(makeSelection(kind, graphic, targetLayer, settings))
  })

  return {
    view,
    layerTitles: webmap.allLayers.toArray().map((layer) => layer.title || '').filter(Boolean),
    setSelectionMode: (mode) => {
      lotLayer.visible = true
      occupationLayer.visible = true
    },
    searchFeatures,
    selectFeature,
    drawDimensions: (lote) => {
      const polygon = ensurePolygon(lote.graphic, 'O lote selecionado')
      dimensionLayer.removeAll()
      const { graphics, dimensions } = buildDimensionGraphics(polygon, view.resolution)
      dimensionLayer.addMany(graphics)
      return dimensions
    },
    analysePublicArea: async (occupation) => {
      const lot = await getLargestIntersectingLot(occupation, lotLayer, settings)
      const occupationPolygon = ensurePolygon(occupation.graphic, 'A ocupação selecionada')
      const lotPolygon = ensurePolygon(lot.graphic, 'O lote associado')
      const reportedOccupationArea = reportedOrGeometricArea(occupation.graphic, settings.occupationAreaField)
      const reportedLotArea = reportedOrGeometricArea(lot.graphic, settings.lotAreaField)
      const numericalExcess = Math.max(reportedOccupationArea - reportedLotArea, 0)
      const difference = geometryEngine.difference(occupationPolygon, lotPolygon)
      const hachGeometry = firstGeometry(difference)
      const geometricPublicArea = geodesicArea(difference)
      const hasPublicArea = numericalExcess > 0 && geometricPublicArea > 0

      hatchLayer.removeAll()
      if (hasPublicArea && hachGeometry) {
        hatchLayer.addMany([
          new Graphic({
            geometry: hachGeometry,
            symbol: new SimpleFillSymbol({
              style: 'none',
              outline: new SimpleLineSymbol({ color: '#1C2525', width: 4.2 }),
            }),
            attributes: {
              analysisType: 'public-area-outline',
              reportedExcess: numericalExcess,
              geometricArea: geometricPublicArea,
            },
          }),
          new Graphic({
            geometry: hachGeometry,
            symbol: new SimpleFillSymbol({
              style: 'cross',
              color: [255, 226, 79, 0.92],
              outline: new SimpleLineSymbol({ color: '#FFE46E', width: 2.1 }),
            }),
            attributes: {
              analysisType: 'public-area',
              reportedExcess: numericalExcess,
              geometricArea: geometricPublicArea,
            },
          }),
        ])
      }

      return {
        lot,
        occupation,
        reportedLotArea,
        reportedOccupationArea,
        numericalExcess,
        geometricPublicArea,
        hasPublicArea,
        note: hasPublicArea
          ? 'A hachura representa a parte geométrica da ocupação fora do lote de maior sobreposição.'
          : 'Não há hachura: pela regra configurada, a área declarada da ocupação não supera a do lote ou não foi encontrada diferença geométrica.',
      }
    },
    clearGraphics: () => {
      hatchLayer.removeAll()
      dimensionLayer.removeAll()
    },
    exportMapImage: async (format) => {
      const screenshot = await view.takeScreenshot({ format })
      const extent = view.extent
      if (!screenshot.dataUrl || !extent) throw new Error(`Não foi possível gerar a imagem ${format.toUpperCase()} do mapa.`)
      const spatialReference = view.spatialReference as (__esri.SpatialReference & { latestWkid?: number | null })
      const geographicExtent = webMercatorUtils.webMercatorToGeographic(extent) as __esri.Extent
      return {
        dataUrl: screenshot.dataUrl,
        extent: { xmin: extent.xmin, ymin: extent.ymin, xmax: extent.xmax, ymax: extent.ymax },
        geographicExtent: { xmin: geographicExtent.xmin, ymin: geographicExtent.ymin, xmax: geographicExtent.xmax, ymax: geographicExtent.ymax },
        spatialReference: {
          wkid: spatialReference?.wkid ?? undefined,
          latestWkid: spatialReference?.latestWkid ?? undefined,
          wkt: spatialReference?.wkt ?? undefined,
        },
        scale: view.scale ?? 0,
        zoom: view.zoom ?? 0,
      }
    },
    printAnalysis: async (printSettings, title, analysisText, selectionText) => {
      const layout = printSettings.layoutName.trim() || 'MAP_ONLY'
      const template = new PrintTemplate({
        format: 'pdf',
        layout: layout as any,
        layoutOptions: {
          titleText: title,
          customTextElements: [
            { analysis_info: analysisText },
            { popup_info: selectionText },
          ],
        },
        exportOptions: { dpi: 180 },
      })
      const parameters = new PrintParameters({ view, template })
      const executionMode = await print.getMode(printSettings.printServiceUrl)
      // Contorno do GPServer: a camada RA falha ao ser criada no Export Web Map.
      // Ela permanece visível no mapa, mas é ocultada somente enquanto o payload é serializado.
      const hiddenForPrint = webmap.allLayers
        .toArray()
        .filter((layer) => /regi(?:ão|ões)\s+administrativ|\bRA\b/i.test(layer.title || ''))
        .map((layer) => ({ layer, visible: layer.visible }))
      hiddenForPrint.forEach(({ layer }) => { layer.visible = false })
      try {
        const response = await print.execute(printSettings.printServiceUrl, parameters)
        if (!response.url) throw new Error(`O serviço de impressão não retornou a URL do PDF. Modo: ${executionMode}; layout enviado: ${layout}.`)
        return response.url
      } finally {
        hiddenForPrint.forEach(({ layer, visible }) => { layer.visible = visible })
      }
    },
    destroy: () => {
      clickHandle.remove()
      view.destroy()
    },
  }
}
