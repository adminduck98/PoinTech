import { useState, useCallback, useEffect, useRef } from 'react';
import { MapPin, X, Navigation, Check, Loader, Search } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from '../hooks/useTranslation';

interface MapPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (lat: number, lng: number, address: string) => void;
  initialLat?: number | null;
  initialLng?: number | null;
}

export const MapPicker = ({ isOpen, onClose, onConfirm, initialLat, initialLng }: MapPickerProps) => {
  const { language } = useTranslation();
  const [lat, setLat] = useState<number>(initialLat ?? 41.2995);
  const [lng, setLng] = useState<number>(initialLng ?? 69.2401);
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [searching, setSearching] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const reverseGeocode = useCallback(async (latitude: number, longitude: number) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&accept-language=ru,uz,en`,
        { headers: { 'User-Agent': 'PointTech-Shop/1.0' }, signal: controller.signal }
      );
      clearTimeout(timeoutId);
      if (!response.ok) return;
      const data = await response.json();
      if (data?.address) {
        const addr = data.address;
        const parts = [
          addr.road || addr.pedestrian,
          addr.house_number,
          addr.suburb || addr.neighbourhood,
          addr.city || addr.town || addr.village,
        ].filter(Boolean);
        setAddress(parts.join(', ') || data.display_name || '');
      }
    } catch {
      // ignore — user can type address manually
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [lat, lng],
      zoom: 15,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const icon = L.divIcon({
      className: '',
      html: `<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="#e11d48" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
      </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
    });

    const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      setLat(pos.lat);
      setLng(pos.lng);
      reverseGeocode(pos.lat, pos.lng);
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      setLat(e.latlng.lat);
      setLng(e.latlng.lng);
      reverseGeocode(e.latlng.lat, e.latlng.lng);
    });

    mapInstanceRef.current = map;
    markerRef.current = marker;

    if (initialLat && initialLng) {
      map.setView([initialLat, initialLng], 16);
    } else {
      reverseGeocode(lat, lng);
    }

    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleDetectLocation = () => {
    if (!navigator.geolocation) return;
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setLat(latitude);
        setLng(longitude);
        if (mapInstanceRef.current && markerRef.current) {
          mapInstanceRef.current.setView([latitude, longitude], 16);
          markerRef.current.setLatLng([latitude, longitude]);
        }
        reverseGeocode(latitude, longitude);
        setDetecting(false);
      },
      () => {
        setDetecting(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&accept-language=ru,uz,en&limit=5`,
        { headers: { 'User-Agent': 'PointTech-Shop/1.0' }, signal: controller.signal }
      );
      clearTimeout(timeoutId);
      if (!response.ok) { setSearchResults([]); return; }
      const data = await response.json();
      setSearchResults(data);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectResult = (result: { lat: string; lon: string; display_name: string }) => {
    const newLat = parseFloat(result.lat);
    const newLng = parseFloat(result.lon);
    setLat(newLat);
    setLng(newLng);
    setSearchResults([]);
    setSearchQuery('');
    if (mapInstanceRef.current && markerRef.current) {
      mapInstanceRef.current.setView([newLat, newLng], 17);
      markerRef.current.setLatLng([newLat, newLng]);
    }
    reverseGeocode(newLat, newLng);
  };

  /**
   * The confirm button used to be disabled until Nominatim returned a street
   * address, and `address` had no other source: geocoding has a 5 s timeout and
   * an empty catch, and the service is free, rate-limited to ~1 req/s and
   * regularly answers 429. A customer could drop the pin exactly where they
   * live and still be unable to continue — a dead end in the middle of
   * checkout, over an optional convenience lookup.
   *
   * The coordinates are the thing the courier actually needs, and we always
   * have them. When the lookup did not come back, hand over the coordinates in
   * a form a human can read and let the customer refine the address in the
   * checkout field.
   */
  const handleConfirm = () => {
    setLoading(true);
    const resolved = address.trim() || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    onConfirm(lat, lng, resolved);
    setLoading(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[color:var(--overlay)] backdrop-blur-md">
      <div className="bg-surface rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg h-[90dvh] sm:h-[80dvh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <h3 className="font-semibold text-text text-sm">
            {language === 'ru' ? 'Выберите адрес доставки' : 'Yetkazish manzilini tanlang'}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-muted transition-colors">
            <X className="w-4 h-4 text-text-tertiary" />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-border flex-shrink-0">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder={language === 'ru' ? 'Поиск адреса...' : 'Manzilni qidirish...'}
                className="input-premium w-full pl-9 pr-3 py-2.5 text-sm"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
              className="px-4 py-2.5 rounded-xl btn-brand disabled:opacity-50 text-sm font-semibold flex items-center gap-1.5"
            >
              {searching ? <Loader className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {language === 'ru' ? 'Найти' : 'Qidirish'}
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-2 bg-surface border border-border rounded-xl overflow-hidden max-h-40 overflow-y-auto">
              {searchResults.map((result, i) => (
                <button
                  key={i}
                  onClick={() => handleSelectResult(result)}
                  className="w-full text-left px-3 py-2.5 text-xs text-text hover:bg-bg dark:hover:bg-surface-elevated border-b border-border-subtle last:border-b-0 transition"
                >
                  {result.display_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Map area */}
        <div className="flex-1 relative overflow-hidden">
          <div ref={mapRef} className="w-full h-full" />

          {/* Detect location button */}
          <button
            onClick={handleDetectLocation}
            disabled={detecting}
            className="absolute top-3 right-3 z-[1000] p-2.5 rounded-xl bg-surface shadow-lg border border-border hover:bg-surface-muted transition disabled:opacity-50"
          >
            {detecting ? (
              <Loader className="w-5 h-5 text-accent animate-spin" />
            ) : (
              <Navigation className="w-5 h-5 text-text" />
            )}
          </button>
        </div>

        {/* Address display and confirm */}
        <div className="px-4 py-3 border-t border-border flex-shrink-0 space-y-3">
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${address ? 'text-text' : 'text-text-secondary'}`}>
                {address || (language === 'ru'
                  // Confirming is allowed without this — say what will happen
                  // instead of leaving the customer guessing why nothing moves.
                  ? 'Адрес не определён — точка на карте будет сохранена, адрес можно уточнить в заказе'
                  : "Manzil aniqlanmadi — xaritadagi nuqta saqlanadi, manzilni buyurtmada aniqlashtirishingiz mumkin")}
              </p>
              <p className="text-[10px] text-text-tertiary mt-0.5">
                {lat.toFixed(6)}, {lng.toFixed(6)}
              </p>
            </div>
          </div>

          <button
            onClick={handleConfirm}
            disabled={loading}
            className="w-full py-3 rounded-xl btn-brand disabled:opacity-50 text-sm font-semibold transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {language === 'ru' ? 'Подтвердить адрес' : 'Manzilni tasdiqlash'}
          </button>
        </div>
      </div>
    </div>
  );
};
