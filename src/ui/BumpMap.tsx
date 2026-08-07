import type { CircleMarkerOptions, LatLngExpression, LayerGroup, Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BumpStatus, type GeoPoint, type SpeedBump } from '../core/models';
import { EmptyState } from './Common';
import { formatCoordinates, formatSeenCount } from './formatters';

export interface BumpMapProps {
  bumps: SpeedBump[];
  currentLocation?: GeoPoint | null;
  onSelectBump?: (bump: SpeedBump) => void;
}

export function BumpMap({ bumps, currentLocation = null, onSelectBump }: BumpMapProps) {
  const mapElement = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerLayerRef = useRef<LayerGroup | null>(null);
  const positionedRef = useRef(false);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [tilesUnavailable, setTilesUnavailable] = useState(
    typeof navigator !== 'undefined' && !navigator.onLine
  );
  const validBumps = useMemo(
    () => bumps.filter((bump) => validCoordinate(bump.latitude, bump.longitude)),
    [bumps]
  );
  const hasCurrentLocation = currentLocation !== null &&
    validCoordinate(currentLocation.latitude, currentLocation.longitude);
  const hasMapContent = hasCurrentLocation || validBumps.length > 0;

  useEffect(() => {
    const onOffline = () => setTilesUnavailable(true);
    const onOnline = () => setTilesUnavailable(false);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    const container = mapElement.current;
    if (!container || mapRef.current || !hasMapContent) return undefined;

    let cancelled = false;
    let createdMap: LeafletMap | null = null;
    void import('leaflet').then((leaflet) => {
      if (cancelled || mapRef.current || !mapElement.current) return;
      leafletRef.current = leaflet;
      const map = leaflet.map(mapElement.current, {
        attributionControl: true,
        scrollWheelZoom: true,
        zoomControl: true
      });
      const tiles = leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      });
      tiles.on('tileerror', () => setTilesUnavailable(true));
      tiles.on('tileload', () => {
        if (navigator.onLine) setTilesUnavailable(false);
      });
      tiles.addTo(map);

      createdMap = map;
      mapRef.current = map;
      markerLayerRef.current = leaflet.layerGroup().addTo(map);
      setLibraryVersion((version) => version + 1);
      window.setTimeout(() => map.invalidateSize(), 0);
    });

    return () => {
      cancelled = true;
      markerLayerRef.current = null;
      mapRef.current = null;
      leafletRef.current = null;
      positionedRef.current = false;
      createdMap?.remove();
    };
  }, [hasMapContent]);

  useEffect(() => {
    const map = mapRef.current;
    const markerLayer = markerLayerRef.current;
    const leaflet = leafletRef.current;
    if (!map || !markerLayer || !leaflet) return;
    markerLayer.clearLayers();

    const positions: LatLngExpression[] = [];
    if (hasCurrentLocation) {
      const position: LatLngExpression = [currentLocation.latitude, currentLocation.longitude];
      positions.push(position);
      if (Number.isFinite(currentLocation.accuracyMetres) && currentLocation.accuracyMetres > 0) {
        leaflet.circle(position, {
          radius: currentLocation.accuracyMetres,
          color: '#2563EB',
          fillColor: '#60A5FA',
          fillOpacity: 0.12,
          weight: 1,
          interactive: false
        }).addTo(markerLayer);
      }
      leaflet.circleMarker(position, {
        radius: 8,
        color: '#FFFFFF',
        fillColor: '#2563EB',
        fillOpacity: 1,
        weight: 3
      }).bindPopup('Your current location').addTo(markerLayer);
    }

    validBumps.forEach((bump) => {
      const position: LatLngExpression = [bump.latitude, bump.longitude];
      positions.push(position);
      const marker = leaflet.circleMarker(position, markerStyle(bump.status));
      marker.bindPopup(createBumpPopup(bump));
      if (onSelectBump) marker.on('click', () => onSelectBump(bump));
      marker.addTo(markerLayer);
    });

    if (!positionedRef.current && positions.length > 0) {
      if (hasCurrentLocation) {
        map.setView([currentLocation.latitude, currentLocation.longitude], 15);
      } else if (positions.length === 1) {
        map.setView(positions[0], 15);
      } else {
        map.fitBounds(leaflet.latLngBounds(positions), { maxZoom: 15, padding: [28, 28] });
      }
      positionedRef.current = true;
    }
  }, [currentLocation, hasCurrentLocation, libraryVersion, onSelectBump, validBumps]);

  if (!hasMapContent) {
    return (
      <div className="bc-map-empty">
        <EmptyState
          title="No locations to show"
          body="Saved bumps and your current location will appear here when coordinates are available."
        />
      </div>
    );
  }

  return (
    <div className="bc-map" aria-label="Map of saved speed bumps">
      <div ref={mapElement} className="bc-leaflet-map" />
      {tilesUnavailable ? (
        <div className="bc-map-unavailable" role="status">
          Map tiles are unavailable offline. Your saved bump data is still available in List view.
        </div>
      ) : null}
    </div>
  );
}

function validCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function markerStyle(status: BumpStatus): CircleMarkerOptions {
  const fillColor = status === BumpStatus.CONFIRMED
    ? '#2E7D32'
    : status === BumpStatus.REMOVED
      ? '#BA1A1A'
      : '#8A5A00';
  return { radius: 9, color: '#FFFFFF', fillColor, fillOpacity: 1, weight: 2.5 };
}

function createBumpPopup(bump: SpeedBump): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'bc-map-popup';
  const title = document.createElement('strong');
  title.textContent = bump.roadName ?? bump.regionLabel ?? 'Speed bump';
  popup.append(title);
  [
    formatCoordinates(bump.latitude, bump.longitude),
    formatSeenCount(bump.encounterCount),
    bump.warningEnabled ? 'Warnings on' : 'Warnings off'
  ].forEach((text) => {
    const line = document.createElement('span');
    line.textContent = text;
    popup.append(line);
  });
  return popup;
}
