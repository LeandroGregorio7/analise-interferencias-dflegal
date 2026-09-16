import Polygon from '@arcgis/core/geometry/Polygon'

export type ImportedFormat = 'KML' | 'GeoJSON'

const ringFromCoordinates = (coordinates: unknown): number[][] => {
  if (!Array.isArray(coordinates)) return []
  return coordinates
    .filter((point): point is number[] => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
    .map((point) => [Number(point[0]), Number(point[1])])
}

const ringsFromGeoJsonGeometry = (geometry: any): number[][][] => {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return (geometry.coordinates || []).map((ring: unknown) => ringFromCoordinates(ring)).filter((ring: number[][]) => ring.length >= 4)
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates || []).flatMap((polygon: unknown) => Array.isArray(polygon) ? polygon.map(ringFromCoordinates).filter((ring) => ring.length >= 4) : [])
  return []
}

const closeRing = (ring: number[][]) => {
  if (ring.length < 3) return ring
  const first = ring[0]; const last = ring[ring.length - 1]
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, [...first]]
}

const parseGeoJson = (text: string): Polygon => {
  let json: any
  try { json = JSON.parse(text) } catch { throw new Error('O arquivo GeoJSON não possui JSON válido.') }
  const geometries = json.type === 'FeatureCollection'
    ? (json.features || []).map((feature: any) => feature?.geometry)
    : json.type === 'Feature' ? [json.geometry] : [json]
  const rings = geometries.flatMap(ringsFromGeoJsonGeometry).map(closeRing).filter((ring: number[][]) => ring.length >= 4)
  if (!rings.length) throw new Error('O GeoJSON precisa conter Polygon ou MultiPolygon.')
  return new Polygon({ rings, spatialReference: { wkid: 4326 } })
}

const textOf = (element: Element | undefined) => element?.textContent?.trim() || ''
const parseKml = (text: string): Polygon => {
  const xml = new DOMParser().parseFromString(text, 'application/xml')
  if (xml.querySelector('parsererror')) throw new Error('O arquivo KML não possui XML válido.')
  const rings: number[][][] = []
  Array.from(xml.getElementsByTagName('Polygon')).forEach((polygon) => {
    const boundaries = [
      ...Array.from(polygon.getElementsByTagName('outerBoundaryIs')),
      ...Array.from(polygon.getElementsByTagName('innerBoundaryIs')),
    ]
    boundaries.forEach((boundary) => {
      const coordinates = boundary.getElementsByTagName('coordinates')[0]
      const ring = textOf(coordinates).split(/\s+/).map((pair) => pair.split(',')).map((parts) => [Number(parts[0]), Number(parts[1])]).filter((point) => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
      const closed = closeRing(ring)
      if (closed.length >= 4) rings.push(closed)
    })
  })
  if (!rings.length) throw new Error('O KML precisa conter pelo menos um elemento Polygon.')
  return new Polygon({ rings, spatialReference: { wkid: 4326 } })
}

export const parseImportedArea = (text: string, fileName: string): { geometry: Polygon; format: ImportedFormat } => {
  const isKml = /\.kml$/i.test(fileName) || /<kml[\s>]/i.test(text)
  return isKml ? { geometry: parseKml(text), format: 'KML' } : { geometry: parseGeoJson(text), format: 'GeoJSON' }
}

export const geometryToGeoJsonPreview = (geometry: Polygon) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: geometry.rings } })
