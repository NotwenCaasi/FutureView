// server/server.js

const express = require('express');
const net = require('net');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const PImage = require('pureimage');
require('dotenv').config();
const WebSocket = require('ws'); // WebSocket server

const app = express();
const port = process.env.PORT || 3000;

const { exec } = require('child_process');

const sketchupPath = process.env.SKETCHUP_PATH;
const sketchupScriptStartServerPath = process.env.SKETCHUP_SCRIPT_START_SERVER_PATH;
const sketchupScriptCustomViewPath = process.env.SKETCHUP_SCRIPT_CUSTOM_VIEW_PATH;
const sketchupModelPath = process.env.SKETCHUP_MODEL_PATH;

const sketchupCommand = `"${sketchupPath}" -RubyStartup "${sketchupScriptStartServerPath}" "${sketchupModelPath}"`;

// WebSocket server setup
const wss = new WebSocket.Server({ noServer: true }); // WebSocket server without its own HTTP server

function deleteFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.unlink(filePath, (err) => {
      if (err && err.code !== 'ENOENT') {
        // If the error is not 'file not found', reject the promise
        reject(err);
      } else {
        // File deleted or didn't exist, proceed
        resolve();
      }
    });
  });
}


function waitForFile(filePath, timeout = 60000, interval = 2000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const checkFile = () => {
      fs.access(filePath, fs.constants.F_OK, (err) => {
        if (!err) {
          // File exists
          resolve();
        } else {
          // Check if timeout has been reached
          if (Date.now() - startTime >= timeout) {
            reject(new Error(`Timeout: File ${filePath} was not created within ${timeout} ms.`));
          } else {
            // Wait and try again
            setTimeout(checkFile, interval);
          }
        }
      });
    };

    checkFile();
  });
}


async function startSketchup() {
  console.log('Triggering SketchUp script to start sketchup...');
  try {
    await runSketchUpScript();
  } catch (error) {
    console.error('Failed to run SketchUp script:', error);
    // Handle the error appropriately
    return;
  }
}


function runSketchUpScript() {
  return new Promise((resolve, reject) => {
    // Replace with the actual command to run your SketchUp script
    const command = sketchupCommand;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing SketchUp script: ${error.message}`);
        reject(error);
        return;
      }
      if (stderr) {
        console.error(`SketchUp script stderr: ${stderr}`);
      }
      console.log(`SketchUp script stdout: ${stdout}`);
      resolve();
    });
  });
}


// Function to send Ruby script to SketchUp via TCP server
async function runRubyScriptInSketchUp() {
  try {
    // Read the Ruby script from file
    const rubyScript = fs.readFileSync(process.env.SKETCHUP_SCRIPT_CUSTOM_VIEW_PATH, 'utf8');

    // Create a JSON object with the Ruby script
    const message = JSON.stringify({ script: rubyScript });

    // Create a TCP connection to the SketchUp TCP server
    const client = new net.Socket();
    client.connect(4567, 'localhost', () => {
      console.log('Connected to SketchUp TCP server');
      client.write(message + '\n');  // Send the JSON message with a newline
    });

    // Listen for data from the SketchUp server
    client.on('data', (data) => {
      console.log('Response from SketchUp:', data.toString());
      client.destroy();  // Close the connection after receiving the response
    });

    // Handle connection errors
    client.on('error', (err) => {
      console.error('Error connecting to SketchUp TCP server:', err.message);
    });
  } catch (error) {
    console.error('Error reading or sending Ruby script:', error.message);
  }
}


// Function to generate image_future by overlaying image_new over image_ref
async function generateImageFuture() {
  const dataDir = path.join(__dirname, '../public/data');
  const imageRefPath = path.join(dataDir, 'image_ref.jpg');
  const imageNewPath = path.join(dataDir, 'image_new.png');
  const imageFuturePath = path.join(dataDir, 'image_future.png');

  // Delete image_new.png before starting the SketchUp script
  try {
    await deleteFile(imageNewPath);
    console.log('Deleted existing image_new.png (if it existed).');
  } catch (error) {
    console.error('Error deleting image_new.png:', error);
    // Decide whether to proceed or abort
    return;
  }

  // Trigger the SketchUp script to generate image_new.png
  console.log('Triggering SketchUp script to generate image_new.png...');
  try {
    await runRubyScriptInSketchUp();
  } catch (error) {
    console.error('Failed to run SketchUp script:', error);
    // Handle the error appropriately
    return;
  }

  // Wait until image_new.png is generated
  try {
    console.log('Waiting for image_new.png to be generated...');
    await waitForFile(imageNewPath, 60000, 2000); // Wait up to 60 seconds, check every 2 seconds
    console.log('image_new.png is now available.');
  } catch (error) {
    console.error(error.message);
    // Handle the error appropriately
    return;
  }

  // Proceed with processing
  try {
    // Load the images
    const [imgRef, imgNew] = await Promise.all([
      PImage.decodeJPEGFromStream(fs.createReadStream(imageRefPath)),
      PImage.decodePNGFromStream(fs.createReadStream(imageNewPath)),
    ]);

    // Create a new image for the future image
    const imgFuture = PImage.make(imgRef.width, imgRef.height);
    const ctx = imgFuture.getContext('2d');

    // Draw the reference image
    ctx.drawImage(imgRef, 0, 0);

    // Draw the new image over it
    ctx.drawImage(imgNew, 0, 0);

    // Save the result
    const outStream = fs.createWriteStream(imageFuturePath);
    await PImage.encodePNGToStream(imgFuture, outStream);
    console.log('Generated image_future.png');
  } catch (error) {
    console.error('Error generating image_future:', error);
  }

  // Notify WebSocket clients after generating the images
  refreshImageStatus();
}


// Function to notify clients about image updates
function broadcastImageUpdate(imageRefUpdated, imageFutureUpdated) {
  const updateMessage = JSON.stringify({ imageRefUpdated, imageFutureUpdated });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(updateMessage);  // Send the update message to connected clients
    }
  });
}


// Track when the images were last updated
let imageRefUpdatedAt = null;
let imageFutureUpdatedAt = null;


function updateImageTimestamps() {
  const dataDir = path.join(__dirname, '../public/data');
  const imageRefPath = path.join(dataDir, 'image_ref.jpg');
  const imageFuturePath = path.join(dataDir, 'image_future.png');

  if (fs.existsSync(imageRefPath)) {
    imageRefUpdatedAt = fs.statSync(imageRefPath).mtime;
  }

  if (fs.existsSync(imageFuturePath)) {
    imageFutureUpdatedAt = fs.statSync(imageFuturePath).mtime;
  }
}

// Call this function after generating images to notify WebSocket clients
function refreshImageStatus() {
  const dataDir = path.join(__dirname, '../public/data');
  const imageRefPath = path.join(dataDir, 'image_ref.jpg');
  const imageFuturePath = path.join(dataDir, 'image_future.png');

  const currentImageRefUpdatedAt = fs.existsSync(imageRefPath) ? fs.statSync(imageRefPath).mtime : null;
  const currentImageFutureUpdatedAt = fs.existsSync(imageFuturePath) ? fs.statSync(imageFuturePath).mtime : null;

  const imageRefUpdated = currentImageRefUpdatedAt > imageRefUpdatedAt;
  const imageFutureUpdated = currentImageFutureUpdatedAt > imageFutureUpdatedAt;

  // Broadcast updates via WebSocket if images were updated
  if (imageRefUpdated || imageFutureUpdated) {
    broadcastImageUpdate(imageRefUpdated, imageFutureUpdated);
  }

  // Update the timestamps
  updateImageTimestamps();
}


startSketchup();

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '../public')));


// API endpoint to proxy Street View requests and save camera parameters
// API endpoint to proxy Street View requests and save camera parameters
app.get('/api/streetview', async (req, res) => {
  const { latitude, longitude, heading, pitch, fov } = req.query;
  const apiKey = process.env.GOOGLE_MAPS_STREETVIEW_STATIC_API_KEY;
  const apiKey2 = process.env.GOOGLE_MAPS_API_KEY;

  let elevation = 0;

  try {
    // Get the elevation from the Google Elevation API
    const elevationApiUrl = `https://maps.googleapis.com/maps/api/elevation/json?locations=${latitude},${longitude}&key=${apiKey2}`;
    const elevationResponse = await axios.get(elevationApiUrl);

    if (elevationResponse.data && elevationResponse.data.results && elevationResponse.data.results.length > 0) {
      elevation = elevationResponse.data.results[0].elevation;
    } else {
      throw new Error('Elevation data not found.');
    }

  } catch (error) {
    console.error('Error fetching elevation or processing data:', error.message);
    return res.status(500).json({ error: 'Failed to fetch elevation data or process the request.' });
  }

  // Log the parameters for debugging
  console.log('Received parameters:', { latitude, longitude, heading, pitch, fov });

  // Save the camera parameters to a JSON file
  const cameraParams = {
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    elevation: parseFloat(elevation),
    heading: parseFloat(heading),
    pitch: parseFloat(pitch),
    fov: parseFloat(fov)
  };

  const filePath = path.join(__dirname, '../server/data/camera_params.json');

  // Write the camera parameters to the JSON file
  fs.writeFile(filePath, JSON.stringify(cameraParams, null, 2), (err) => {
    if (err) {
      console.error('Error writing camera parameters to file:', err);
    } else {
      console.log('Camera parameters saved to', filePath);
    }
  });

  // Fetch the Street View image
  const imageUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${latitude},${longitude}&heading=${heading}&pitch=${pitch}&fov=${fov}&key=${apiKey}`;

  try {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });

    if (response.status === 200) {
      const imageRefPath = path.join(__dirname, '../public/data/image_ref.jpg');

      // Save the image to data/image_ref.jpg
      fs.writeFileSync(imageRefPath, response.data);

      // Send the image response to the client
      res.set('Content-Type', 'image/jpeg');
      res.send(response.data);

      // Start generating image_future after sending the response to the client
      generateImageFuture();

    } else {
      console.error('Error response from Google API:', response.status, response.data.toString());
      return res.status(response.status).send('Error fetching image from Google Street View API');
    }
  } catch (error) {
    if (error.response) {
      console.error('Error fetching Street View image:', error.response.status, error.response.data);
      return res.status(error.response.status).send(error.response.data);
    } else {
      console.error('Error:', error.message);
      return res.status(500).send('Internal Server Error');
    }
  }
});


// Start the server
const server = app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});


// Upgrade HTTP server to support WebSocket connections
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
