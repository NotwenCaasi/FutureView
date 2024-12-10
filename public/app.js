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

    const zoom = panorama.getZoom();
    const fov = 180 / Math.pow(2, zoom);

    const streetViewHeight = document.getElementById('street-view').offsetHeight;
    createScale('street-view-scale', fov, streetViewHeight);

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

        const imageHeight = document.getElementById('image-ref').offsetHeight;
        createScale('image-scale', fov, imageHeight);
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

  ws.onopen = function() {
    console.log('WebSocket connection opened');
  };

  ws.onerror = function(error) {
    console.error('WebSocket error:', error);
  };

  ws.onmessage = function(event) {
    const data = JSON.parse(event.data);
    // Check if the actual image was updated
    console.log('imageRefUpdated : ', data.imageRefUpdated) 
    if (data.imageRefUpdated) {
      reloadImage('image-ref', '/data/image_ref.jpg');
    }

    // Check if the future-over image was updated
    console.log('imageFutureOverUpdated : ', data.imageFutureOverUpdated) 
    if (data.imageFutureOverUpdated) {
      reloadImage('image-future-over', '/data/image_future_over.png');
    }

    // Check if the future-integrated image was updated
    console.log('imageFutureIntegratedUpdated : ', data.imageFutureIntegratedUpdated) 
    if (data.imageFutureIntegratedUpdated) {
      reloadImage('image-future-integrated', '/data/image_future_integrated.png');
    }
  };

  ws.onclose = function() {
    console.log('WebSocket connection closed');
  };
}


// Add the event listener for the buttons
function initializeCaptureButton() {
  document.getElementById('capture-button').addEventListener('click', captureCurrentView);
}
function initializeExportButtons() {
  document.getElementById('export-pdf-button').addEventListener('click', exportAsPDF);
  document.getElementById('export-image-button').addEventListener('click', exportAsImage);
}

// Fetch available models from the server
async function fetchAvailableModels() {
  try {
    const response = await axios.get('/api/models');
    let models = response.data.models;

    // Ensure "empty" model is first in the list
    const emptyIndex = models.indexOf('empty');
    if (emptyIndex > -1) {
      models.splice(emptyIndex, 1);
      models.unshift('empty');
    }

    // Generate the model selection dropdown
    generateModelDropdown(models);
  } catch (error) {
    console.error('Error fetching models:', error);
  }
}


// Dynamically generate the dropdown for available models
function generateModelDropdown(models) {
  const dropdownContainer = document.getElementById('model-dropdown');
  dropdownContainer.innerHTML = '';  // Clear any existing options

  models.forEach(model => {
    const option = document.createElement('option');
    option.value = model;
    option.text = model;

    // Automatically select "empty" model on page load
    if (model === 'empty') {
      option.selected = true;
    }

    dropdownContainer.appendChild(option);
  });
}


// Event listener to load the selected model
function initializeModelSelection() {
  const loadModelButton = document.getElementById('load-model-button');
  const dropdownContainer = document.getElementById('model-dropdown');

  loadModelButton.addEventListener('click', () => {
    const selectedModel = dropdownContainer.value;
    loadSelectedModel(selectedModel);  // Pass the selected model to the load function
  });
}


// Function to load the selected model
function loadSelectedModel(modelName) {
  console.log('Selected model:', modelName); // Log selected model
  axios.post('/api/load-model', { model: modelName }, {
    headers: {
      'Content-Type': 'application/json'
    }
  })
  .then(response => {
    console.log('Model loaded successfully:', response.data);
  })
  .catch(error => {
    console.error('Error loading model:', error);
  });
}

function exportAsPDF() {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();

  // Use html2canvas to capture the map-container and image-container sections
  html2canvas(document.querySelector('#map-container')).then(function(mapCanvas) {
    html2canvas(document.querySelector('#image-container')).then(function(imageCanvas) {
      // Combine map and image containers into one canvas
      const combinedCanvas = document.createElement('canvas');
      combinedCanvas.width = Math.max(mapCanvas.width, imageCanvas.width);
      combinedCanvas.height = mapCanvas.height + imageCanvas.height;

      const context = combinedCanvas.getContext('2d');
      context.drawImage(mapCanvas, 0, 0);
      context.drawImage(imageCanvas, 0, mapCanvas.height);

      // Convert the combined canvas into an image and add it to the PDF
      const imgData = combinedCanvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 10, 10, 190, 0); // Adjust size and position in PDF

      // Save the PDF
      pdf.save('page-export.pdf');
    });
  });
}

function exportAsImage() {
  // Use html2canvas to capture the map-container and image-container sections
  html2canvas(document.querySelector('#map-container')).then(function(mapCanvas) {
    html2canvas(document.querySelector('#image-container')).then(function(imageCanvas) {
      // Combine map and image containers into one canvas
      const combinedCanvas = document.createElement('canvas');
      combinedCanvas.width = Math.max(mapCanvas.width, imageCanvas.width);
      combinedCanvas.height = mapCanvas.height + imageCanvas.height;

      const context = combinedCanvas.getContext('2d');
      context.drawImage(mapCanvas, 0, 0);
      context.drawImage(imageCanvas, 0, mapCanvas.height);

      // Convert the combined canvas into an image and trigger download
      const imgData = combinedCanvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = imgData;
      link.download = 'page-export.png';
      link.click();
    });
  });
}

function createScale(containerId, fov, height) {
  const container = document.getElementById(containerId);

  // Clear any existing scale
  container.innerHTML = '';

  // Calculate the number of segments
  const segments = 5; // Number of divisions in the scale
  const anglePerSegment = fov / segments;
  const segmentHeight = height / segments;

  container.style.position = 'relative';
  container.style.width = '10px';
  container.style.backgroundColor = 'transparent';
  container.style.display = 'flex';
  container.style.flexDirection = 'column-reverse';

  // Create the scale
  for (let i = 0; i <= segments; i++) {

    const label = document.createElement('div');
    label.style.position = 'absolute';
    label.style.color = 'black';
    label.style.fontSize = '12px';
    label.style.transform = 'translate(-25px, 50%)';
    label.style.left = '0';
    label.style.bottom = `${i * segmentHeight}px`;
    label.innerText = `${Math.round((fov / (segments - 1)) * i)}°`;
    container.appendChild(label);

    if (i < segments) {
      const segment = document.createElement('div');
      segment.style.height = `${segmentHeight}px`;
      segment.style.width = '100%';
      segment.style.backgroundColor = i % 2 === 0 ? 'black' : 'white';
      container.appendChild(segment);
    }

  }
}

function initializeScales() {
  // Example FOVs (adjust dynamically as needed)
  const streetViewZoom = panorama ? panorama.getZoom() : 1;
  const streetViewFOV = 180 / Math.pow(2, streetViewZoom);

  const imageFOV = window.capturedData ? window.capturedData.fov : 75;

  // Heights of the elements
  const streetViewHeight = document.getElementById('street-view').offsetHeight;
  const imageHeight = document.getElementById('image-ref').offsetHeight;

  // Create scales
  createScale('street-view-scale', streetViewFOV, streetViewHeight);
  createScale('image-scale', imageFOV, imageHeight);
}


// Initialize the app by setting up the map, WebSocket, model loader, and capture button
function initializeApp() {
  initMap();
  fetchAvailableModels();
  initializeModelSelection();
  initializeWebSocket();
  initializeCaptureButton();
  initializeExportButtons();
  initializeScales();
  window.addEventListener('resize', initializeScales); // Recalculate on window resize
}

// Run the initialization after the DOM content is fully loaded
document.addEventListener('DOMContentLoaded', initializeApp);
