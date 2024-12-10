const express = require('express');
const net = require('net');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const PImage = require('pureimage');
const sharp = require('sharp');
require('dotenv').config();
const WebSocket = require('ws'); // WebSocket server

const app = express();
const port = process.env.PORT || 3000;

const { exec } = require('child_process');

const sketchupPath = process.env.SKETCHUP_PATH;
const sketchupScriptStartServerPath = process.env.SKETCHUP_SCRIPT_START_SERVER_PATH;
const sketchupScriptCustomViewPath = process.env.SKETCHUP_SCRIPT_CUSTOM_VIEW_PATH;
const sketchupModelDirectory = path.join(__dirname, 'sketchup/models');  // Model directory

const imageRefPath = path.join(__dirname, '../public/data/image_ref.jpg');
const imageNewPath = path.join(__dirname, '../public/data/image_new.png');
const imageFutureOverPath = path.join(__dirname, '../public/data/image_future_over.png');
const imageFutureIntegratedPath = path.join(__dirname, '../public/data/image_future_integrated.png');

const defaultModel = 'empty';  // Define the default model to load

const dataDir = path.join(__dirname, '../public/data');

let sketchupScriptCustomView = null;

let imageRefUpdatedAt = null;
let imageFutureOverUpdatedAt = null;
let imageFutureIntegratedUpdatedAt = null;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// WebSocket server setup
let wss;

// Initialize WebSocket server in startServer()
async function startServer() {
  try {
    await fs.access(dataDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.mkdir(dataDir, { recursive: true });
    } else {
      throw err;
    }
  }

  // WebSocket server setup
  wss = new WebSocket.Server({ noServer: true });

  await loadCustomViewScript();

  const server = app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });

  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  startSketchup();

}


// Call the async startup function
startServer().catch((err) => {
  console.error('Error starting server:', err);
});


async function loadCustomViewScript() {
  try {
    sketchupScriptCustomView = await fs.readFile(sketchupScriptCustomViewPath, 'utf8');
    console.log(`Loaded SketchUp custom view script from: ${sketchupScriptCustomViewPath}`);
  } catch (error) {
    console.error(`Failed to load SketchUp custom view script: ${error.message}`);
    throw error;
  }
}


async function deleteFile(filePath) {
  try {
    await fs.unlink(filePath);
    console.log(`File ${filePath} deleted successfully`);
  } catch (err) {
    if (err.code !== 'ENOENT') {  // If the error is not "file not found"
      throw err;
    } else {
      console.log(`File ${filePath} not found, but it's okay`);
    }
  }
}


async function waitForFile(filePath, timeout = 60000, interval = 2000) {
  const startTime = Date.now();

  const checkFile = async () => {
    try {
      await fs.access(filePath);
      return true;
    } catch (err) {
      if (Date.now() - startTime >= timeout) {
        throw new Error(`Timeout: File ${filePath} was not created within ${timeout} ms.`);
      }
      await new Promise(resolve => setTimeout(resolve, interval)); // Delay before retry
      return checkFile();
    }
  };

  return checkFile();
}


async function startSketchup() {
  console.log('Triggering SketchUp with empty model...');
  try {
    await runSketchUpScriptWithModel('empty.skp');  // Pass empty.skp at startup
    
    const rubyScriptForModel = generateModelLoadScript(defaultModel);
    await runRubyScriptInSketchUp(rubyScriptForModel);

    const modelScriptPath = path.join(__dirname, 'sketchup/models', `${defaultModel}.txt`);
try {
  await fs.access(modelScriptPath);
  const modelScript = await fs.readFile(modelScriptPath, 'utf8');
      await runRubyScriptInSketchUp(modelScript);
} catch (err) {
  if (err.code === 'ENOENT') {
    // File doesn't exist
  } else {
    throw err;
  }
}

  } catch (error) {
    console.error('Failed to start SketchUp with empty model:', error);
    return;
  }
}


function runSketchUpScriptWithModel(modelName) {
  return new Promise((resolve, reject) => {
    const modelPath = path.join(__dirname, 'sketchup/models', modelName).replace(/\\/g, '/'); // Path to empty.skp
    const command = `"${sketchupPath}" -RubyStartup "${sketchupScriptStartServerPath}" "${modelPath}"`;

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

function runSketchUpScript() {
  return new Promise((resolve, reject) => {
    const command = `"${sketchupPath}" -RubyStartup "${sketchupScriptStartServerPath}"`;

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

async function runRubyScriptInSketchUp(rubyScript) {
  try {
    const message = JSON.stringify({ script: rubyScript });

    const client = new net.Socket();
    client.connect(4567, 'localhost', () => {
      console.log('Connected to SketchUp TCP server');
      client.write(message + '\n');
    });

    client.on('data', (data) => {
      console.log('Response from SketchUp:', data.toString());
      client.destroy();
    });

    client.on('error', (err) => {
      console.error('Error connecting to SketchUp TCP server:', err.message);
    });
  } catch (error) {
    console.error('Error sending Ruby script:', error.message);
  }
}

// Function to generate image_future and image_future_modified
async function generateImageFuture() {
  try {
    // Read the reference and new images
    const imgRef = sharp(imageRefPath).ensureAlpha();  // Ensure Alpha for consistency
    const imgNew = sharp(imageNewPath).ensureAlpha();  // Ensure Alpha for consistency

    // Check the format of both images
    const refMetadata = await imgRef.metadata();
    const newMetadata = await imgNew.metadata();

    if (!['jpeg', 'png', 'webp'].includes(refMetadata.format) || !['jpeg', 'png', 'webp'].includes(newMetadata.format)) {
      throw new Error(`Unsupported image format: ${refMetadata.format} or ${newMetadata.format}`);
    }

    if (refMetadata.width !== newMetadata.width || refMetadata.height !== newMetadata.height) {
      throw new Error("Image dimensions do not match between reference and new image.");
    }

    console.log('Generating image_future...');
    
    // Overlay image_new onto image_ref to create image_future
    await imgRef
      .composite([{ input: imageNewPath, blend: 'over' }])  // Overlay image_new
      .toFile(imageFutureOverPath);  // Write image_future
    console.log('image_future_over.png generated successfully.');

    // Ensure the file is fully written
    await waitForFile(imageFutureOverPath, 60000, 1000);  // Wait up to 60s with 1s interval
    console.log('image_future_over.png is now available for use.');

    // Generate image_future_integrated where sky is detected (simple blue-based filter)
    console.log('Generating image_future_integrated...');

    // Read both images into raw RGBA buffers
    const [imgRefBuffer, imgNewBuffer] = await Promise.all([
      sharp(imageRefPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(imageNewPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    ]);

    const { data: refData, info } = imgRefBuffer;
    const { data: newData } = imgNewBuffer;
    const modifiedImageData = Buffer.alloc(refData.length);

    // Iterate over each pixel (4 bytes: RGBA), detecting the sky and modifying the image
    for (let i = 0; i < refData.length; i += 4) {
      const red = refData[i];
      const green = refData[i + 1];
      const blue = refData[i + 2];
      const alpha = refData[i + 3];

      const newAlpha = newData[i + 3]; // Alpha from image_new

      // Improved sky detection logic based on a lighter blue tone threshold or a uniform grey/white sky threshold
      const isSky = (blue>100 && red<blue && green<blue) || (blue>100 && red>(blue-20) && red<(blue+20) && green>(blue-20) && green<(blue+20));

      if (isSky && newAlpha === 255) {
        // Apply the new image pixel only in detected sky areas and when image_new is fully opaque
        modifiedImageData[i] = newData[i];     // R from image_new
        modifiedImageData[i + 1] = newData[i + 1]; // G from image_new
        modifiedImageData[i + 2] = newData[i + 2]; // B from image_new
        modifiedImageData[i + 3] = newAlpha;   // A from image_new
      } else {
        // Keep the original reference image's pixels for non-sky or transparent areas
        modifiedImageData[i] = red;
        modifiedImageData[i + 1] = green;
        modifiedImageData[i + 2] = blue;
        modifiedImageData[i + 3] = alpha;
      }
    }

    // Write the modified image to image_future_modified
    await sharp(modifiedImageData, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4
      }
    }).toFile(imageFutureIntegratedPath);
    console.log('Generated image_future_integrated.png');

    // Ensure the file is fully written
    await waitForFile(imageFutureIntegratedPath, 60000, 1000);  // Wait up to 60s with 1s interval
    console.log('image_future_integrated.png is now available for use.');

  } catch (error) {
    console.error('Error generating image_future or image_future_integrated:', error);
  }
}



function broadcastImageUpdate(imageRefUpdated, imageFutureOverUpdated, imageFutureIntegratedUpdated) {
  const updateMessage = JSON.stringify({ imageRefUpdated, imageFutureOverUpdated, imageFutureIntegratedUpdated });
  if (wss) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(updateMessage);
      }
    });
  } else {
    console.error('WebSocket server is not defined (wss is null)');
  }
}


async function updateImageTimestamps() {
  try {
    // Check if image_ref exists and update the timestamp
    await fs.access(imageRefPath);
    imageRefUpdatedAt = (await fs.stat(imageRefPath)).mtime;
    console.log('Updated image_ref timestamp:', imageRefUpdatedAt);

    // Check if image_future_over exists and update the timestamp
    await fs.access(imageFutureOverPath);
    imageFutureOverUpdatedAt = (await fs.stat(imageFutureOverPath)).mtime;
    console.log('Updated image_future_over timestamp:', imageFutureOverUpdatedAt);
    
    // Check if image_future_modified exists and update the timestamp
    await fs.access(imageFutureIntegratedPath);
    imageFutureIntegratedUpdatedAt = (await fs.stat(imageFutureIntegratedPath)).mtime;
    console.log('Updated image_future_integrated timestamp:', imageFutureIntegratedUpdatedAt);
  } catch (error) {
    console.error('Error updating image timestamps:', error);
  }
}


async function refreshImagesStatus() {
  try {
    // Check if image_ref exists and get its stats
    await fs.access(imageRefPath);
    const currentimageRefUpdatedAt = (await fs.stat(imageRefPath)).mtime;
    console.log('Current image_ref mtime:', currentimageRefUpdatedAt);

    // Check if image_future_over exists and get its stats
    await fs.access(imageFutureOverPath);
    const currentimageFutureOverUpdatedAt = (await fs.stat(imageFutureOverPath)).mtime;
    console.log('Current image_future_over mtime:', currentimageFutureOverUpdatedAt);

    // Check if image_future_integrated exists and get its stats
    await fs.access(imageFutureIntegratedPath);
    const currentimageFutureIntegratedUpdatedAt = (await fs.stat(imageFutureIntegratedPath)).mtime;
    console.log('Current image_future_integrated mtime:', currentimageFutureIntegratedUpdatedAt);

    // Compare timestamps to detect changes
    const imageRefUpdated = currentimageRefUpdatedAt > imageRefUpdatedAt;
    const imageFutureOverUpdated = currentimageFutureOverUpdatedAt > imageFutureOverUpdatedAt;
    const imageFutureIntegratedUpdated = currentimageFutureIntegratedUpdatedAt > imageFutureIntegratedUpdatedAt;


    if (imageRefUpdated || imageFutureOverUpdated ||imageFutureIntegratedUpdated ) {
      console.log('send message to client to refresh images');
      broadcastImageUpdate(imageRefUpdated, imageFutureOverUpdated, imageFutureIntegratedUpdated);
    } else {
      console.log('No changes detected in images.');
    }

    // Update stored timestamps
    updateImageTimestamps();
  } catch (error) {
    console.error('Error in refreshImagesStatus:', error);
  }
}



// API to get available models
app.get('/api/models', async (req, res) => {
  try {
    // Use async fs.readdir to read the directory
    const files = await fs.readdir(sketchupModelDirectory);

    // Filter out only .skp files and return their names without the extension
    const modelFiles = files.filter(file => path.extname(file) === '.skp').map(file => path.basename(file, '.skp'));

    // Log the models being returned
    console.log('Available models:', modelFiles);

    // Return the models as an array under the 'models' key
    res.json({ models: modelFiles });
  } catch (err) {
    // Error handling
    console.error('Error reading models directory:', err);
    res.status(500).json({ error: 'Failed to retrieve models' });
  }
});


// API to load the selected model using TCP communication with SketchUp
app.post('/api/load-model', async (req, res) => {
  console.log('Request body:', req.body);
  const selectedModel = req.body.model; // Assuming the model name is passed as 'model'

  try {
    if (!selectedModel) {
      return res.status(400).json({ error: 'Model name is required' });
    }

    // Generate the Ruby script to load the selected model
    const rubyScriptForModel = generateModelLoadScript(selectedModel);
    console.log('Generated Ruby script for loading the model.');

    // Send the Ruby script to SketchUp via TCP
    await runRubyScriptInSketchUp(rubyScriptForModel);
    console.log('Ruby script sent to SketchUp to load the model.');

    // Check if there's a specific Ruby script for the model, and run it if exists
    const modelScriptPath = path.join(__dirname, 'sketchup/models', `${selectedModel}.txt`);
try {
  await fs.access(modelScriptPath);
  // Read the custom Ruby script for this model
      const modelScript = await fs.readFile(modelScriptPath, 'utf8');
      await runRubyScriptInSketchUp(modelScript);
      console.log('Custom Ruby script for the model executed.');
} catch (err) {
  if (err.code === 'ENOENT') {
    console.log(`No custom Ruby script found for the model: ${selectedModel}`);
  } else {
    throw err;
  }
}

    res.json({ success: true, message: 'Model loaded and Ruby script executed successfully' });
  } catch (error) {
    console.error('Error loading model or executing Ruby script:', error);
    res.status(500).json({ error: 'Failed to load model or execute Ruby script', details: error.message });
  }
});


function generateModelLoadScript(modelName) {
  // Construct the model path, ensuring it uses forward slashes
  const modelPath = path.join(__dirname, 'sketchup/models', `${modelName}.skp`).replace(/\\/g, '/');
  
  // Generate the Ruby script to open the model instead of importing it
  return `
    # Define the path of the model to open
    model_path = "${modelPath}"
    
    # Open the model file and replace the current one
    if File.exist?(model_path)
      Sketchup.active_model.close(true)
      Sketchup.open_file(model_path)
      puts "Opened model: #{model_path}"
    else
      puts "Error: The model file '#{model_path}' does not exist."
    end
  `;
}







async function runModelRubyScript(modelName) {
  const scriptPath = path.join(__dirname, 'sketchup/models', `${modelName}.txt`);

  let rubyScript;
  try {
    rubyScript = await fs.readFile(scriptPath, 'utf8');
    console.log(`Running Ruby script for model: ${modelName}`);
  } catch (error) {
    console.error(`Failed to load Ruby script for ${modelName}:`, error);
    throw error;  // Throw error so the main function handles it
  }

  // Send the Ruby script to SketchUp via TCP
  await runRubyScriptInSketchUp(rubyScript);
}


async function safeWriteFileAsync(filePath, data) {
  try {
    const tempFilePath = `${filePath}.temp`;

    // Log step: Check if the file is accessible before writing
    try {
      await fs.access(filePath, fs.constants.F_OK);
      console.log(`File ${filePath} exists before writing.`);
    } catch (err) {
      console.log(`File ${filePath} does not exist before writing. Proceeding...`);
    }

    // Log step: Check if the temp file is accessible before writing
    try {
      await fs.access(tempFilePath, fs.constants.F_OK);
      console.log(`Temporary file ${tempFilePath} exists before writing.`);
    } catch (err) {
      console.log(`Temporary file ${tempFilePath} does not exist before writing. Proceeding...`);
    }

    // Write to a temporary file first
    await fs.writeFile(tempFilePath, data);
    console.log(`Successfully wrote to temporary file: ${tempFilePath}`);

    // Log step: Check if temp file was written successfully
    try {
      await fs.access(tempFilePath, fs.constants.F_OK);
      console.log(`Temporary file ${tempFilePath} is available for renaming.`);
    } catch (err) {
      console.log(`Temporary file ${tempFilePath} not found after writing.`);
      throw err;
    }

    // Once write is complete, rename the temp file to the final path
    await fs.rename(tempFilePath, filePath);
    console.log(`Renamed ${tempFilePath} to ${filePath}`);

    // Log step: Check if the final file is accessible after renaming
    try {
      await fs.access(filePath, fs.constants.F_OK);
      console.log(`Final file ${filePath} is available after renaming.`);
    } catch (err) {
      console.log(`Final file ${filePath} not found after renaming.`);
      throw err;
    }

  } catch (error) {
    console.error(`Error writing or renaming file: ${filePath}`, error);
    throw error;
  }
}


// Function to delete a file if it exists
async function deleteFileIfExists(filePath) {
  try {
    await fs.access(filePath); // Check if file exists
    await fs.unlink(filePath); // Delete it if it exists
    console.log(`Deleted existing file: ${filePath}`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist, proceed without error
      console.log(`File ${filePath} does not exist, proceeding...`);
    } else {
      // Some other error
      throw err;
    }
  }
}


// Function to wait for a file to be created
async function waitForFile(filePath, timeout = 60000, interval = 2000) {
  const startTime = Date.now();

  const checkFile = async () => {
    try {
      await fs.access(filePath); // Check if file exists
      console.log(`File ${filePath} is now available.`);
      return true;
    } catch (err) {
      if (Date.now() - startTime >= timeout) {
        throw new Error(`Timeout: File ${filePath} was not created within ${timeout} ms.`);
      }
      await new Promise(resolve => setTimeout(resolve, interval)); // Wait before retrying
      return checkFile(); // Recursively check again
    }
  };

  return checkFile();
}


// API endpoint to proxy Street View requests and save camera parameters
app.get('/api/streetview', async (req, res) => {
  const { latitude, longitude, heading, pitch, fov } = req.query;
  const apiKey = process.env.GOOGLE_MAPS_STREETVIEW_STATIC_API_KEY;
  const apiKey2 = process.env.GOOGLE_MAPS_API_KEY;

  let elevation = 0;

  console.log('API request received for /api/streetview');
  console.log('Received parameters:', { latitude, longitude, heading, pitch, fov });
  console.log('Google Maps API keys:', { apiKey, apiKey2 });

  // Fetch elevation data
  try {
    const elevationApiUrl = `https://maps.googleapis.com/maps/api/elevation/json?locations=${latitude},${longitude}&key=${apiKey2}`;
    console.log('Elevation API URL:', elevationApiUrl);

    const elevationResponse = await axios.get(elevationApiUrl);
    console.log('Elevation API response:', elevationResponse.data);

    if (elevationResponse.data && elevationResponse.data.results && elevationResponse.data.results.length > 0) {
      elevation = elevationResponse.data.results[0].elevation;
      console.log('Elevation fetched:', elevation);
    } else {
      throw new Error('Elevation data not found.');
    }
  } catch (error) {
    console.error('Error fetching elevation:', error.message);
    return res.status(500).json({ error: 'Failed to fetch elevation data' });
  }

  // Save camera parameters
  const cameraParams = {
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    elevation: parseFloat(elevation),
    heading: parseFloat(heading),
    pitch: parseFloat(pitch),
    fov: parseFloat(fov)
  };

  const filePath = path.join(__dirname, 'data/camera_params.json');
  console.log('Saving camera parameters to:', filePath);
  console.log('Camera parameters:', cameraParams);

  try {
    await fs.writeFile(filePath, JSON.stringify(cameraParams, null, 2));
    console.log('Camera parameters saved successfully.');
  } catch (error) {
    console.error('Error writing camera parameters:', error.message);
    return res.status(500).json({ error: 'Failed to save camera parameters' });
  }

  // Fetch the Street View image
  const imageUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${latitude},${longitude}&heading=${heading}&pitch=${pitch}&fov=${fov}&key=${apiKey}`;
  console.log('Street View API URL:', imageUrl);

  try {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });

    if (response.status === 200) {
      await safeWriteFileAsync(imageRefPath, response.data);
      res.set('Content-Type', 'image/jpeg');
      res.send(response.data);

      // Step 1: Delete the existing image_new.png if it exists
      await deleteFileIfExists(imageNewPath);
    
      console.log('Generating 3D model view');
    
      // Step 2: Run the SketchUp script to generate image_new.png
      await runRubyScriptInSketchUp(sketchupScriptCustomView);
      console.log('SketchUp script executed for generating image_new.');

      // Step 3: Wait for the new image to be generated
      console.log('Waiting for image_new.png to be generated...');
      await waitForFile(imageNewPath, 60000, 100); // Timeout: 60 seconds, check every 2 seconds
      console.log('image_new.png generated successfully.');

      console.log('Generating image_future...')
      await generateImageFuture();

      await new Promise(resolve => setTimeout(resolve, 500));  // 500ms delay

      console.log('Refreshing image in client page')
      await refreshImagesStatus();

      console.log('Landscape insertion complete')
    } else {
      console.error('Error fetching Street View image:', response.status);
      return res.status(response.status).send('Error fetching Street View image');
    }
  } catch (error) {
    console.error('Error fetching Street View image:', error.message);
    return res.status(500).send('Internal Server Error');
  }
});



