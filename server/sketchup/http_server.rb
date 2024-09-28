require 'socket'
require 'json'

$empty = true

# Define a method to start the TCP server
def start_tcp_server(port = 4567)
  server = TCPServer.new('localhost', port)
  puts "TCP Server started on port #{port}..."

  loop do
    client = server.accept   # Wait for a client to connect
    puts "Client connected"

    # Read the incoming request from the client
    request = client.gets
    puts "Received request: #{request}"

    # Parse the JSON request to extract the Ruby script
    begin
      data = JSON.parse(request)
      script = data['script']

      # Execute the Ruby script
      eval(script)

      # Respond to the client
      client.puts({ status: 'success', message: 'Script executed' }.to_json)
    rescue => e
      # Handle errors and send the error message to the client
      client.puts({ status: 'error', message: e.message }.to_json)
    ensure
      client.close  # Close the connection with the client
      puts "Client disconnected"
    end
  end
end

# Start the TCP server on port 4567
start_tcp_server(4567)
