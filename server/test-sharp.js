const sharp = require('sharp');

async function simpleSharpTest() {
  try {
    const imgRef = sharp('../public/data/image_ref.jpg');
    
    // Read image metadata to ensure the file is processed
    const metadata = await imgRef.metadata();
    console.log('Image metadata:', metadata);

    // Save the processed image to test writing
    await imgRef.toFile('../public/data/output_image.jpg');
    console.log('Image processed successfully.');
  } catch (error) {
    console.error('Error during sharp test:', error);
  }
}

simpleSharpTest();
