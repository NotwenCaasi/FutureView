EARTH_RADIUS = 6371000  # Average radius of Earth in meters
METER_TO_SKETCHUP_UNITS = 39.3701  # Meters to inches conversion factor for SketchUp

# Define the conversion function, adding curvature correction
def lat_lng_to_cartesian(lat, lng, z)
  # Compute the horizontal distances in meters (dx and dy)
  dx = (lng * Math.cos(lat * Math::PI / 180) - $lng0 * Math.cos($lat0 * Math::PI / 180)) * 6500 * 1000 * Math::PI / 180
  dy = (lat - $lat0) * 6500 * 1000 * Math::PI / 180

  # Compute the flat elevation difference
  dz = z - $z0
  
  # Compute the horizontal distance between the two points (dx, dy)
  horizontal_distance = Math.sqrt(dx**2 + dy**2)

  # Calculate the drop due to Earth curvature
  curvature_adjustment = (horizontal_distance**2) / (2 * EARTH_RADIUS)
  curvature_adjustment = 0

  # Adjust the dz to account for the Earth's curvature
  dz_corrected = dz - curvature_adjustment

  # Convert distances from meters to SketchUp units (inches)
  dx *= METER_TO_SKETCHUP_UNITS
  dy *= METER_TO_SKETCHUP_UNITS
  dz_corrected *= METER_TO_SKETCHUP_UNITS

  # Return the adjusted Cartesian coordinates
  return [dx, dy, dz_corrected]
end


require 'json'

# Adjust the path to 'camera_params.json'
params_file = File.join('C:/Users/v-martineau/Documents/Etudes/EOLIEN/2-PE MSL Champ Fleury/FutureView/server/', 'data', 'camera_params.json')
params = JSON.parse(File.read(params_file))

# Extract parameters
latitude = params['latitude']
longitude = params['longitude']
elevation = params['elevation']  # Replace with actual elevation if available
heading = params['heading']
pitch = params['pitch']
fov = params['fov']

# Convert heading and pitch to radians
heading_rad = heading * Math::PI / 180
pitch_rad = pitch * Math::PI / 180

# Convert geographic coordinates to Cartesian coordinates
puts "Latitude Origin: #{$lat0}, Current: #{latitude} (#{latitude.class})"
puts "Longitude Origin: #{$lng0}, Current: #{longitude} (#{longitude.class})"
puts "Elevation Origin: #{$z0}, Current: #{elevation} (#{elevation.class})"

if defined?($empty) && $empty
    eye_x, eye_y, eye_z = 0, 0, 0
else
    eye_x, eye_y, eye_z = lat_lng_to_cartesian(latitude, longitude, elevation)
end

puts "eye_x : #{eye_x}"
puts "eye_y : #{eye_y}"
puts "eye_z : #{eye_z}"

# Create the eye point
eye = Geom::Point3d.new(eye_x, eye_y, eye_z)

# Calculate the direction vector components (unit vector)
dx = Math.cos(pitch_rad) * Math.sin(heading_rad)
dy = Math.cos(pitch_rad) * Math.cos(heading_rad)
dz = Math.sin(pitch_rad)

# Create the direction vector
direction = Geom::Vector3d.new(dx, dy, dz)

# Set the desired distance and convert to SketchUp units
distance = 100  # Desired distance in meters
distance_units = distance * METER_TO_SKETCHUP_UNITS

# Scale the direction vector
direction.length = distance_units

# Calculate the target position
target = eye + direction

puts "target_x : #{target[0]}"
puts "target_y : #{target[1]}"
puts "target_z : #{target[2]}"

# Set up the camera
camera = Sketchup::Camera.new(eye, target, Z_AXIS)
camera.fov = fov

# Set camera perspective
camera.perspective = true

# Apply the camera to the active view
view = Sketchup.active_model.active_view
view.camera = camera

# Access the rendering options
options =  Sketchup.active_model.rendering_options

# Disable the sky and ground in the rendering options
#options["DisplaySky"] = false
#options["DisplayGround"] = false


# Render the image with transparent background
options = {
  filename: "C:/Users/v-martineau/Documents/Etudes/EOLIEN/2-PE MSL Champ Fleury/FutureView/public/data/image_new.png",
  width: 640,
  height: 640,
  transparent: true
}

success = view.write_image(options)

if success
  puts "Image exported successfully to #{options[:filename]}"
else
  UI.messagebox("Error exporting image to #{options[:filename]}")
end
