"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoBairro } from "@/lib/nominatim";

export type Cobertura = {
  id: string;
  rotulo: string;
  cor: string;
  geo: GeoBairro;
};

export type Pin = {
  id: string;
  lat: number;
  lng: number;
  cor: string;
  nome: string;
  telefone: string;
  email: string;
  responsavel?: string;
  aproximado?: boolean;
};

type Props = {
  coberturas: Cobertura[];
  pins: Pin[];
  // Muda de valor quando o mapa deve enquadrar os pins (ex.: fim da geocodificação)
  enquadrarEm?: number;
};

const CENTRO_SP: L.LatLngExpression = [-23.5505, -46.6333];

// Popup montado com textContent: nomes e emails vêm de fora, não podem virar HTML
function conteudoPopup(p: Pin) {
  const div = document.createElement("div");
  div.style.minWidth = "180px";
  const linha = (rotulo: string, valor?: string) => {
    if (!valor) return;
    const el = document.createElement("div");
    el.style.fontSize = "12px";
    const b = document.createElement("b");
    b.textContent = `${rotulo}: `;
    el.append(b, valor);
    div.append(el);
  };
  const titulo = document.createElement("div");
  titulo.style.fontWeight = "600";
  titulo.style.marginBottom = "4px";
  titulo.textContent = p.nome;
  div.append(titulo);
  linha("Telefone", p.telefone);
  linha("E-mail", p.email);
  linha("Responsável", p.responsavel);
  if (p.aproximado) {
    const obs = document.createElement("div");
    obs.style.cssText = "font-size:11px;color:#6b7280;margin-top:4px";
    obs.textContent = "Localização aproximada (só a rua foi encontrada)";
    div.append(obs);
  }
  return div;
}

export default function MapComponent({ coberturas, pins, enquadrarEm }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const coberturaRef = useRef<L.FeatureGroup | null>(null);
  const pinsRef = useRef<L.FeatureGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const mapa = L.map(containerRef.current).setView(CENTRO_SP, 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapa);
    coberturaRef.current = L.featureGroup().addTo(mapa);
    pinsRef.current = L.featureGroup().addTo(mapa);
    mapaRef.current = mapa;
    return () => {
      mapa.remove();
      mapaRef.current = null;
    };
  }, []);

  useEffect(() => {
    const grupo = coberturaRef.current;
    if (!grupo) return;
    grupo.clearLayers();
    for (const c of coberturas) {
      if (c.geo.tipo === "poligono") {
        L.geoJSON(c.geo.geojson, {
          style: { color: c.cor, fillColor: c.cor, fillOpacity: 0.2, weight: 2 },
        })
          .bindTooltip(c.rotulo, { sticky: true })
          .addTo(grupo);
      } else {
        const rotulo = c.geo.centroMunicipio ? `${c.rotulo} (contorno não encontrado; centro do município)` : c.rotulo;
        L.circleMarker([c.geo.lat, c.geo.lng], {
          radius: 10,
          color: c.cor,
          fillColor: c.cor,
          fillOpacity: 0.3,
          weight: 2,
          dashArray: "4 3",
        })
          .bindTooltip(rotulo)
          .addTo(grupo);
      }
    }
  }, [coberturas]);

  useEffect(() => {
    const grupo = pinsRef.current;
    if (!grupo) return;
    grupo.clearLayers();
    for (const p of pins) {
      L.circleMarker([p.lat, p.lng], {
        radius: 7,
        color: "#ffffff",
        weight: 1.5,
        fillColor: p.cor,
        fillOpacity: 0.95,
      })
        .bindPopup(() => conteudoPopup(p))
        .addTo(grupo);
    }
  }, [pins]);

  useEffect(() => {
    if (!enquadrarEm) return;
    const mapa = mapaRef.current;
    const alvo = pinsRef.current?.getLayers().length ? pinsRef.current : coberturaRef.current;
    const limites = alvo?.getBounds();
    if (mapa && limites?.isValid()) mapa.fitBounds(limites, { padding: [30, 30], maxZoom: 16 });
  }, [enquadrarEm]);

  return <div ref={containerRef} className="h-[600px] w-full rounded-xl" />;
}
