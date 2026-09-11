import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Map from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import WebMap from "@arcgis/core/WebMap";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Polygon from "@arcgis/core/geometry/Polygon";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, CircleHelp, Crosshair, Database, Download, ExternalLink, Eye, FileText, Layers3, MapPinned, Menu, MousePointer2, PanelRightClose, PanelRightOpen, Play, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, X } from "lucide-react";

const DEFAULT_WEBMAP = "dfead3998af143298ece2d74712122b7";
const DEFAULT_PORTAL = "https://monitora.dflegal.df.gov.br/portal";

type GeometryKind = "Todos" | "Pontos" | "Linhas" | "Polígonos";
type Incident = { id: string; title: string; type: "Ponto" | "Linha" | "Polígono"; layer: string; severity: "Alta" | "Média" | "Baixa"; status: string; area: string; coordinate: string; color: string };

const incidents: Incident[] = [
  { id: "INT-0248", title: "Ocupação em faixa de domínio", type: "Polígono", layer: "Ocupações Identificadas", severity: "Alta", status: "Conflito confirmado", area: "1.284,6 m²", coordinate: "-15.7042, -47.8237", color: "#e14d4d" },
  { id: "INT-0247", title: "Rede de drenagem atravessando lote", type: "Linha", layer: "Infraestrutura hídrica", severity: "Média", status: "Requer validação", area: "186,4 m", coordinate: "-15.7060, -47.8201", color: "#f4aa3a" },
  { id: "INT-0246", title: "Edificação em área pública", type: "Polígono", layer: "Edificações", severity: "Alta", status: "Conflito confirmado", area: "412,8 m²", coordinate: "-15.7018, -47.8270", color: "#e14d4d" },
  { id: "INT-0245", title: "Poste dentro da faixa não edificável", type: "Ponto", layer: "Equipamentos urbanos", severity: "Baixa", status: "Monitoramento", area: "Ponto", coordinate: "-15.7084, -47.8254", color: "#63b49d" },
];

function DemoMap({ selected, onSelect }: { selected: Incident | null; onSelect: (incident: Incident) => void }) {
  return <div className="demo-map" role="img" aria-label="Mapa demonstrativo de interferências no Distrito Federal">
    <div className="map-grid" /><div className="road road-a" /><div className="road road-b" /><div className="road road-c" />
    <div className="district district-one" /><div className="district district-two" /><div className="waterway" />
    <div className="map-label label-norte">NORTE</div><div className="map-label label-park">Parque urbano</div><div className="map-label label-eixo">Eixo Monumental</div>
    <div className="map-badge"><span className="live-dot" /> MODO DEMONSTRATIVO</div>
    {incidents.map((incident, index) => <button key={incident.id} className={`map-incident incident-${index} ${selected?.id === incident.id ? "is-selected" : ""}`} style={{ "--marker": incident.color } as CSSProperties} onClick={() => onSelect(incident)} aria-label={`Selecionar ${incident.title}`}><span>{incident.type === "Ponto" ? "•" : incident.type === "Linha" ? "—" : "▰"}</span></button>)}
    <div className="map-scale"><span /> 200 m</div>
    <div className="map-controls"><button aria-label="Aproximar">+</button><button aria-label="Afastar">−</button><button aria-label="Localizar"><Crosshair size={15} /></button></div>
  </div>;
}

export default function Home() {
  const mapEl = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Incident | null>(incidents[0]);
  const [geometry, setGeometry] = useState<GeometryKind>("Todos");
  const [showLayers, setShowLayers] = useState(true);
  const [showPanel, setShowPanel] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [arcgisConnected, setArcgisConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [webMapId, setWebMapId] = useState(DEFAULT_WEBMAP);
  const [portalUrl, setPortalUrl] = useState(DEFAULT_PORTAL);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<MapView | null>(null);
  const filtered = useMemo(() => incidents.filter(item => (geometry === "Todos" || item.type === geometry.slice(0, -1)) && `${item.title} ${item.layer} ${item.id}`.toLowerCase().includes(query.toLowerCase())), [geometry, query]);

  useEffect(() => { if (!mapEl.current || arcgisConnected) return; let currentView: MapView | null = null; const boot = async () => {
    try { const webMap = new WebMap({ portalItem: { id: webMapId, portal: { url: portalUrl } } }); currentView = new MapView({ container: mapEl.current!, map: webMap, center: [-47.82, -15.705], zoom: 13, ui: { components: ["zoom", "compass"] } }); await currentView.when(); setView(currentView); setConnectionError(""); setArcgisConnected(true); } catch { setConnectionError("Não foi possível carregar o Web Map nesta sessão. O modo demonstrativo continua disponível."); }
  }; boot(); return () => { currentView?.destroy(); }; }, [webMapId, portalUrl, arcgisConnected]);

  const runAnalysis = () => { setIsRunning(true); window.setTimeout(() => setIsRunning(false), 1200); };
  const connectArcgis = () => { setSettingsOpen(false); setArcgisConnected(false); setConnectionError(""); window.setTimeout(() => setArcgisConnected(true), 50); };
  const selectIncident = (item: Incident) => { setSelected(item); if (view) { const point = new Point({ longitude: -47.8237 + (Number(item.id.slice(-1)) * .001), latitude: -15.7042 + (Number(item.id.slice(-1)) * .001) }); view.goTo({ target: point, zoom: 15 }); } };

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">DF<span>+</span></div><div><strong>DF Legal</strong><small>Monitora geoespacial</small></div></div><nav><a className="active">Análise de interferências</a><a>Mapas operacionais</a><a>Relatórios</a></nav><div className="top-actions"><div className="status"><span className="live-dot" /> Portal conectado</div><button className="icon-button" aria-label="Ajuda"><CircleHelp size={18} /></button><button className="user-button">AM<span>Analista</span><ChevronDown size={14} /></button></div><button className="mobile-menu" aria-label="Menu"><Menu size={20} /></button></header>
    <section className="workspace">
      <aside className="sidebar">
        <div className="side-heading"><div><p className="eyebrow">Operação 04</p><h1>Interferências</h1></div><button className="collapse-button" onClick={() => setShowPanel(!showPanel)} aria-label="Alternar painel"><PanelRightClose size={17} /></button></div>
        <p className="intro">Cruze camadas do Portal Enterprise e identifique conflitos espaciais em pontos, linhas e polígonos.</p>
        <div className="analysis-card"><div className="card-top"><div className="icon-tile"><Sparkles size={16} /></div><div><strong>Nova análise espacial</strong><span>Área de estudo configurada</span></div><span className="ready-dot" /></div><div className="study-row"><MapPinned size={14} /><span>Área monitorada</span><b>Brasília · DF</b></div><button className={`primary-button ${isRunning ? "loading" : ""}`} onClick={runAnalysis}>{isRunning ? <><RefreshCw size={16} className="spin" /> Processando camadas...</> : <><Play size={15} fill="currentColor" /> Executar análise</>}</button></div>
        <div className="filter-section"><div className="section-head"><span className="eyebrow">Filtros de geometria</span><SlidersHorizontal size={14} /></div><div className="segmented">{(["Todos", "Pontos", "Linhas", "Polígonos"] as GeometryKind[]).map(item => <button key={item} className={geometry === item ? "active" : ""} onClick={() => setGeometry(item)}>{item}</button>)}</div></div>
        <div className="layers-section"><div className="section-head"><span className="eyebrow">Camadas analisadas <em>04</em></span><button className="text-button" onClick={() => setShowLayers(!showLayers)}>{showLayers ? "ocultar" : "mostrar"}</button></div>{showLayers && <div className="layer-list">{[["Ocupações Identificadas", "#e14d4d", "polígono"], ["Infraestrutura hídrica", "#f4aa3a", "linha"], ["Edificações", "#e178a7", "polígono"], ["Equipamentos urbanos", "#63b49d", "ponto"]].map(([name, color, shape]) => <div className="layer-row" key={name}><span className={`layer-symbol ${shape}`} style={{ background: color }} /><span>{name}</span><Eye size={14} /></div>)}</div>}</div>
        <div className="sidebar-foot"><button className="secondary-button" onClick={() => setSettingsOpen(true)}><Settings2 size={15} /> Configurar Portal</button><div className="secure-note"><ShieldCheck size={14} /> Dados lidos somente no navegador</div></div>
      </aside>
      <section className="map-area"><div className="map-toolbar"><div className="search-box"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Pesquisar ocorrência, camada ou ID" /></div><button className="toolbar-button" onClick={() => setSettingsOpen(true)}><Database size={15} /> <span>Web Map</span></button><button className="toolbar-button" onClick={() => setShowLayers(!showLayers)}><Layers3 size={15} /></button><button className="toolbar-button" onClick={() => window.print()}><Download size={15} /></button></div><div ref={mapEl} className={`arcgis-map ${arcgisConnected ? "" : "hidden-map"}`} />{!arcgisConnected && <DemoMap selected={selected} onSelect={selectIncident} />}{connectionError && <div className="map-warning"><AlertTriangle size={15} /> {connectionError}</div>}<div className="map-footer"><span><span className="live-dot" /> Última atualização há 2 min</span><span>Fonte: Monitora DF Legal</span><span>Escala 1:12.500</span></div>{showPanel && <aside className="results-panel"><div className="results-head"><div><p className="eyebrow">Resultado da análise</p><h2>{filtered.length} interferências <span>encontradas</span></h2></div><button onClick={() => setShowPanel(false)} aria-label="Fechar painel"><X size={17} /></button></div><div className="result-summary"><div><strong>{filtered.filter(i => i.severity === "Alta").length}</strong><span>alta prioridade</span></div><div><strong>{filtered.filter(i => i.severity === "Média").length}</strong><span>em validação</span></div><div><strong>{filtered.filter(i => i.severity === "Baixa").length}</strong><span>monitoradas</span></div></div><div className="result-list">{filtered.map(item => <button className={`result-item ${selected?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => selectIncident(item)}><div className="result-icon" style={{ color: item.color }}>{item.type === "Ponto" ? <Crosshair size={16} /> : item.type === "Linha" ? <span className="line-icon" /> : <span className="poly-icon" />}</div><div className="result-main"><div className="result-title"><strong>{item.title}</strong><span className={`severity ${item.severity.toLowerCase()}`}>{item.severity}</span></div><span className="result-meta">{item.id} · {item.layer}</span><div className="result-detail"><span>{item.area}</span><span>{item.status}</span></div></div><ArrowRight size={15} className="arrow" /></button>)}</div><button className="report-button"><FileText size={15} /> Gerar relatório de interferências <ExternalLink size={13} /></button></aside>}{!showPanel && <button className="reopen-panel" onClick={() => setShowPanel(true)}><PanelRightOpen size={16} /> Resultados</button>}</section>
    </section>
    {settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><div className="settings-modal" onClick={e => e.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Fonte de dados</p><h2>Conectar ao Portal</h2></div><button onClick={() => setSettingsOpen(false)}><X size={18} /></button></div><p className="modal-copy">Informe o endereço do ArcGIS Enterprise e o ID do Web Map. A autenticação, quando necessária, será solicitada pelo próprio Portal.</p><label>URL do Portal<input value={portalUrl} onChange={e => setPortalUrl(e.target.value)} /></label><label>ID do Web Map<input value={webMapId} onChange={e => setWebMapId(e.target.value)} /></label><div className="modal-actions"><button className="secondary-button" onClick={() => setSettingsOpen(false)}>Cancelar</button><button className="primary-button" onClick={connectArcgis}><Database size={15} /> Carregar Web Map</button></div></div></div>}
  </main>;
}
