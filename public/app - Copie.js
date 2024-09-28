// Global variables
let panorama;
let miniMap;
let miniMapMarker;
let latestPosition = null;
let latestPOV = null;

// Initialize Google Maps and Street View
window.initMap = function() {
  // Retry initializing the map until Google Maps is available
  const retryLimit = 10;
  let retryCount = 0;

  function initializeWhenGoogleIsAvailable() {
    if (typeof google !== 'undefined' && typeof google.maps !== 'undefined') {
      initStreetView();
    } else if (retryCount < retryLimit) {
      retryCount++;
      console.log(`Retrying Google Maps initialization... (${retryCount})`);
      setTimeout(initializeWhenGoogleIsAvailable, 500);  // Retry after 500ms
    } else {
      console.error('Google Maps API is not available.');
    }
  }

  initializeWhenGoogleIsAvailable();
}

// Initialize the Street View and mini-map
function initStreetView() {
  if (typeof google === 'undefined') {
    console.error('Google Maps API not loaded');
    return;
  }

  // Starting location
  const startLocation = { lat: 47.32051870936257, lng: -0.9273506344141741 };

  // Initialize Street View
  panorama = new google.maps.StreetViewPanorama(
    document.getElementById('street-view'),
    {
      position: startLocation,
      pov: { heading: 34, pitch: 10 },
      visible: true,
      navigationControl: true,  // Enable navigation
      linksControl: true,       // Enable movement to adjacent panoramas
      motionTracking: true,
      motionTrackingControl: true,
      zoom: 1,
      addressControl: false,
      panControl: true,
      enableCloseButton: false,
    }
  );

  // Initialize mini-map
  miniMap = new google.maps.Map(document.getElementById('mini-map'), {
    center: startLocation,
    zoom: 15,
    disableDefaultUI: true,  // Minimal UI for the mini-map
  });

  // Add marker to mini-map
  miniMapMarker = new google.maps.Marker({
    position: startLocation,
    map: miniMap,
    title: "Current Street View Position",
    icon: {
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 5,
      rotation: panorama.getPov().heading,  // Initial rotation based on Street View heading
    }
  });

  // Sync mini-map with Street View position
  panorama.addListener('position_changed', () => {
    latestPosition = panorama.getPosition();
    miniMapMarker.setPosition(latestPosition);
    miniMap.setCenter(latestPosition);
  });

  // Update the marker rotation when Street View orientation (heading) changes
  panorama.addListener('pov_changed', () => {
    latestPOV = panorama.getPov();
    miniMapMarker.setIcon({
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 5,
      rotation: latestPOV.heading,  // Rotate the marker based on Street View heading
    });
  });

  // Allow clicking on the mini-map to change Street View position
  miniMap.addListener('click', (event) => {
    const newPosition = event.latLng;
    panorama.setPosition(newPosition);  // Update Street View position
    miniMapMarker.setPosition(newPosition);  // Sync the marker position
    miniMap.setCenter(newPosition);  // Optionally center the mini-map on the new position
  });

  // Capture heading and pitch (POV) changes
  panorama.addListener('pov_changed', () => {
    latestPOV = panorama.getPov();
  });
}

// Capture the current Street View and send a request to the server
function captureCurrentView() {
  if (latestPosition && latestPOV) {
    // Get the current zoom level of the panorama
    const zoom = panorama.getZoom();
    
    // Calculate the Field of View (FOV) based on the zoom level
    const fov = 180 / Math.pow(2, zoom);

    const data = {
      latitude: latestPosition.lat(),
      longitude: latestPosition.lng(),
      heading: latestPOV.heading,
      pitch: latestPOV.pitch,
      fov: fov,  // Adjust the FOV if necessary
    };

    // Send request to your server to capture the view
    axios
      .get('/api/streetview', { params: data, responseType: 'blob' })
      .then(response => {
        window.capturedData = data;
      })
      .catch(error => {
        console.error('Error fetching image:', error);
        alert('Error fetching image');
      });
  } else {
    alert('Please adjust the view first.');
  }
}

// Reload an image by updating its `src` attribute with a cache-busting timestamp
function reloadImage(imageId, src) {
  const imageElement = document.getElementById(imageId);
  const newSrc = `${src}?t=${new Date().getTime()}`;  // Add a timestamp to bypass cache
  imageElement.src = newSrc;
}

// Initialize WebSocket connection to listen for image updates
function initializeWebSocket() {
  const ws = new WebSocket(`ws://${window.location.host}`);

  // Listen for WebSocket messages from the server
  ws.onmessage = function(event) {
    const data = JSON.parse(event.data);

    // Check if the reference image was updated
    if (data.imageRefUpdated) {
      reloadImage('image-ref', '/data/image_ref.jpg');
    }

    // Check if the future image was updated
    if (data.imageFutureUpdated) {
      reloadImage('image-future', '/data/image_future.png');
    }
  };
}

// Add the event listener for the capture button
function initializeCaptureButton() {
  document.getElementById('capture-button').addEventListener('click', captureCurrentView);
}

// Initialize the app by setting up the map, WebSocket, and capture button
function initializeApp() {
  initMap();
  initializeWebSocket();
  initializeCaptureButton();
}

// Run the initialization after the DOM content is fully loaded
document.addEventListener('DOMContentLoaded', initializeApp);
