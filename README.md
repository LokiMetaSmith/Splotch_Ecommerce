---
title: Splotch
layout: page
---

<!DOCTYPE html>
	<html>
		<head>
			<title>SVG.js</title>
				<script src="https://cdn.jsdelivr.net/npm/@svgdotjs/svg.js@3.0/dist/svg.min.js"></script>
		</head>
	<body>
	</body>
</html>
# lokimetasmith.github.io

Set up your Node.js Express Server: If you don't have one, you'll need a basic Express.js server.

# In your project directory
npm init -y
npm install express square dotenv cors
Create your server file (e.g., server.js or app.js):

Modify the .env file in your project root: This file will store your sensitive credentials locally. Do NOT commit this file to Git. Add .env to your .gitignore file.

# .env
SQUARE_ACCESS_TOKEN=your_square_secret_api_key_here
SQUARE_ENVIRONMENT=sandbox # or production
# SQUARE_LOCATION_ID=your_location_id_if_needed
# PORT=3001 # Optional: if you want to use a port other than 3000
Modify printshop.js:

In your handleProcessPayment function, change YOUR_SERVERLESS_FUNCTION_URL to point to your self-hosted Node.js server's endpoint:
const YOUR_NODE_SERVER_URL = 'http://localhost:3000/api/process-payment'; // For local testing
// Or if your server is hosted: 'https://your-domain.com/api/process-payment'
Make sure to use this URL in the fetch call.
The rest of the changes in printshop.js (removing the direct Square API call and secret key) remain the same as outlined for the serverless function approach.
Run Your Node.js Server:

node server.js
Test:

Open your printshop.html in the browser (it can still be served from file:// or https://lokimetasmith.github.io as long as your Node server's CORS policy allows that origin).
Attempt a payment. The request should now go from printshop.js to your Node.js server, which then calls Square.
Check your Node.js server console for logs and your Square Sandbox dashboard for payment status.
Important Considerations for Self-Hosting:

CORS: The cors middleware in Express is important. For production, you should restrict the origin in corsOptions to only allow requests from the domain where your printshop.html is hosted, instead of a wildcard or http://localhost.
Environment Variables: When you deploy your Node.js server to a hosting provider (like DigitalOcean, Heroku, AWS EC2, etc.), you will need to configure these environment variables (SQUARE_ACCESS_TOKEN, SQUARE_ENVIRONMENT) in your hosting provider's settings, not by packaging the .env file.
HTTPS: For production, your Node.js server must be served over HTTPS to protect data in transit, especially since you're handling payment-related information (even if it's just tokens and amounts).
Security: Keep your server updated, manage dependencies, and follow other security best practices for running a web server.
Error Handling: The provided code has basic error handling; you might want to expand on it for production robustness.
This setup gives you full control over your backend environment. The key is that your Square Secret API Key is now secured on your server and not exposed in the client-side code.
