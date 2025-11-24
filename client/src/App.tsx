import { useState, useRef, useCallback, useEffect } from 'react';
import Map, { NavigationControl, Marker, Popup } from 'react-map-gl';
import type { MapLayerMouseEvent } from 'react-map-gl';
import axios from 'axios';
import { Upload, X, Plane, Trash2, Loader2 } from 'lucide-react';
import './App.css';
import './google-maps.d.ts';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const API_URL = import.meta.env.VITE_API_URL;
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

function App() {
  const [viewState, setViewState] = useState({
    latitude: 25.1972,
    longitude: 55.2744,
    zoom: 14
  });
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load saved image from localStorage on mount
  useEffect(() => {
    const loadSavedImage = async () => {
      const savedImage = localStorage.getItem('goplaces_uploaded_image');
      if (savedImage) {
        try {
          setImagePreview(savedImage);
          // Convert base64 back to File object
          const res = await fetch(savedImage);
          const blob = await res.blob();
          const file = new File([blob], 'uploaded-image.jpg', { type: 'image/jpeg' });
          setImageFile(file);
        } catch (err) {
          console.error('Error loading saved image:', err);
          // If there's an error, clear the invalid data
          localStorage.removeItem('goplaces_uploaded_image');
          setImagePreview(null);
        }
      }
    };
    
    loadSavedImage();
  }, []);

  // Calculate latitude offset based on zoom level (higher zoom = smaller offset needed)
  const getLatitudeOffset = (zoom: number) => {
    // At zoom 14, use smaller offset; at zoom 10, use larger offset
    // Increased multiplier to give more space for popup visibility
    return 0.008 * Math.pow(2, 14 - zoom);
  };

  // Initialize Google Maps Places Autocomplete
  useEffect(() => {
    const loadGoogleMaps = () => {
      if (window.google && window.google.maps && window.google.maps.places) {
        initAutocomplete();
        return;
      }

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = initAutocomplete;
      document.head.appendChild(script);
    };

    const initAutocomplete = () => {
      if (!searchInputRef.current || !window.google) return;

      const autocomplete = new window.google.maps.places.Autocomplete(searchInputRef.current, {
        fields: ['geometry', 'name', 'formatted_address'],
      });

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (place.geometry && place.geometry.location) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          
          // Mark that user has searched
          setHasSearched(true);
          
          const targetZoom = 15;
          const latOffset = getLatitudeOffset(targetZoom);
          
          setViewState(prev => ({
            ...prev,
            latitude: lat - latOffset,
            longitude: lng,
            zoom: targetZoom,
            transitionDuration: 1500,
            transitionEasing: (t: number) => t * (2 - t)
          }));

          // Reset and set new location to show popup
          setSelectedLocation(null);
          setTimeout(() => {
            setSelectedLocation({ lat, lng });
          }, 0);
          
          setGeneratedImage(null);
          setError(null);
        }
      });
    };

    loadGoogleMaps();
  }, []);

  const onMapClick = useCallback((event: MapLayerMouseEvent) => {
    const { lat, lng } = event.lngLat;
    
    // Mark that user has interacted (move search bar to top)
    setHasSearched(true);
    
    // Calculate appropriate offset based on current zoom
    const currentZoom = viewState.zoom;
    const latOffset = getLatitudeOffset(currentZoom);
    
    // Center the map on the clicked location with smooth animation
    setViewState(prev => ({
      ...prev,
      latitude: lat - latOffset,
      longitude: lng,
      zoom: prev.zoom < 12 ? 12 : prev.zoom,
      transitionDuration: 1500,
      transitionEasing: (t: number) => t * (2 - t) // Ease out quad for smooth deceleration
    }));
    
    // Reset and set new location to force popup refresh
    setSelectedLocation(null);
    setTimeout(() => {
      setSelectedLocation({ lat, lng });
    }, 0);
    
    // Only clear generated image, preserve uploaded image
    setGeneratedImage(null);
    setError(null);
  }, [viewState.zoom]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      
      // Convert to base64 and save to localStorage
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setImagePreview(base64String);
        localStorage.setItem('goplaces_uploaded_image', base64String);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDeleteImage = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering file upload
    setImageFile(null);
    setImagePreview(null);
    localStorage.removeItem('goplaces_uploaded_image');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleGenerate = async () => {
    if (!selectedLocation) return;
    
    // If preview exists but file doesn't, try to recreate file from preview
    if (!imageFile && imagePreview) {
      try {
        const res = await fetch(imagePreview);
        const blob = await res.blob();
        const file = new File([blob], 'uploaded-image.jpg', { type: 'image/jpeg' });
        setImageFile(file);
        // Let the state update, then retry
        setTimeout(() => handleGenerate(), 100);
        return;
      } catch (err) {
        console.error('Error converting preview to file:', err);
        setError('Error loading image. Please re-upload.');
        return;
      }
    }
    
    if (!imageFile) return;

    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append('lat', selectedLocation.lat.toString());
    formData.append('lng', selectedLocation.lng.toString());
    formData.append('image', imageFile);

    try {
      const response = await axios.post(API_URL, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.data.imageUrl) {
        setGeneratedImage(response.data.imageUrl);
      } else {
        setError('Failed to generate image. No URL returned.');
      }
    } catch (err) {
      console.error(err);
      setError('Failed to generate image. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const resetSelection = () => {
    setSelectedLocation(null);
    setGeneratedImage(null);
    setImageFile(null);
  };

  const centerMapOnLocation = () => {
    if (selectedLocation) {
      const targetZoom = 15;
      const latOffset = getLatitudeOffset(targetZoom);
      setViewState(prev => ({
        ...prev,
        latitude: selectedLocation.lat - latOffset,
        longitude: selectedLocation.lng,
        zoom: targetZoom,
        transitionDuration: 1500,
        transitionEasing: (t: number) => t * (2 - t) // Ease out quad for smooth deceleration
      }));
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <div className={`map-overlay ${hasSearched ? 'hidden' : ''}`}></div>
      <div className={`search-container ${hasSearched ? 'top' : 'center'}`}>
        <div className="search-wrapper">
          <img src="/flight.png" alt="Flight" className="search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Where do you want to go today?"
            className="search-input"
            onFocus={(e) => e.target.select()}
          />
        </div>
      </div>
      
      <Map
        {...viewState}
        onMove={evt => setViewState(evt.viewState)}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/light-v11"
        mapboxAccessToken={MAPBOX_TOKEN}
        onClick={onMapClick}
      >
        <NavigationControl position="top-right" />

        {selectedLocation && (
          <Marker longitude={selectedLocation.lng} latitude={selectedLocation.lat} anchor="bottom" color="#4f46e5" />
        )}

        {selectedLocation && (
          <Popup
            longitude={selectedLocation.lng}
            latitude={selectedLocation.lat}
            anchor="top"
            onClose={resetSelection}
            closeButton={false}
            maxWidth="350px"
            className="custom-popup"
          >
            <div className="popup-content">
              <div className="popup-header">
                <h3>Go to this place</h3>
                <button onClick={resetSelection} className="close-btn"><X size={16} /></button>
              </div>
              
              <div className="location-info" onClick={centerMapOnLocation} title="Click to center map">
                {selectedLocation.lat.toFixed(4)}°N, {selectedLocation.lng.toFixed(4)}°E
              </div>

              {!generatedImage ? (
                <>
                  <div className={`upload-section ${loading ? 'loading' : ''}`} onClick={() => !loading ? fileInputRef.current?.click() : null}>
                    {imagePreview ? (
                      <div className="file-preview">
                        <img src={imagePreview} alt="Preview" />
                        {loading && (
                          <div className="loading-overlay">
                            <div className="airplane-animation">
                              <Plane size={48} className="flying-large" />
                            </div>
                          </div>
                        )}
                        {!loading && (
                          <div className="preview-overlay">
                            <button className="delete-image-btn" onClick={handleDeleteImage}>
                              <Trash2 size={20} />
                            </button>
                            <span className="change-text">Change Image</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="upload-placeholder">
                        <Upload size={24} />
                        <span>Upload Your Photo</span>
                      </div>
                    )}
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleImageUpload}
                      accept="image/*"
                      hidden
                    />
                  </div>

                  <button 
                    className="generate-btn" 
                    onClick={handleGenerate}
                    disabled={(!imageFile && !imagePreview) || loading}
                  >
                    {loading ? <><Loader2 className="spin" size={18} /> Taking you to this place</> : 'Go to this place'}
                  </button>
                  {error && <p className="error-msg">{error}</p>}
                </>
              ) : (
                <div className="result-section">
                  <img src={generatedImage} alt="Generated" className="generated-img" />
                  <button className="reset-btn" onClick={() => setGeneratedImage(null)}>Try Again</button>
                </div>
              )}
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}

export default App;
