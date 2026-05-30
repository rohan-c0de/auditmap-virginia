"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Institution } from "@/lib/types";

interface MapInstitution {
  institution: Institution;
  distance: number;
}

interface MapViewProps {
  institutions: MapInstitution[];
  center: { lat: number; lng: number };
  zoom?: number;
}

// Fix Leaflet default icon paths (broken by bundlers)
const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export default function MapView({
  institutions,
  center,
  zoom = 9,
}: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current).setView(
      [center.lat, center.lng],
      zoom
    );

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter map when center/zoom props change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.setView([center.lat, center.lng], zoom);
  }, [center.lat, center.lng, zoom]);

  // Update markers when institutions change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const markers: L.Marker[] = [];

    function escapeHtml(s: string): string {
      return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    institutions.forEach(({ institution }) => {
      institution.campuses.forEach((campus) => {
        const marker = L.marker([campus.lat, campus.lng], {
          icon: defaultIcon,
        })
          .addTo(map)
          .bindPopup(
            `<div style="min-width:160px">
              <strong style="font-size:14px">${escapeHtml(institution.name)}</strong>
              <br/>
              <span style="color:#666;font-size:12px">${escapeHtml(campus.name)}</span>
              <br/>
              <span style="color:#888;font-size:11px">${escapeHtml(campus.address)}</span>
            </div>`
          );
        markers.push(marker);
      });
    });

    // Fit map bounds to markers if we have any
    if (markers.length > 0) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.1));
    }

    return () => {
      markers.forEach((m) => m.remove());
    };
  }, [institutions]);

  return (
    <div
      ref={mapRef}
      className="h-[500px] w-full rounded-lg border border-gray-200 shadow-sm"
      role="application"
      aria-label="Map showing college locations"
    />
  );
}
