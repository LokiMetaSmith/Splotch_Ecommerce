#!/bin/bash

# Generates an Nginx Server Block configuration

echo "------------------------------------------------------------------"
echo "Nginx Server Block Generator"
echo "------------------------------------------------------------------"

echo "This script generates an Nginx configuration file for a new subdomain."
echo "You can paste the output into your nginx.conf or a new file in /etc/nginx/sites-available/."
echo ""

read -p "Enter the external domain (e.g., dev.example.com): " DOMAIN_NAME
if [ -z "$DOMAIN_NAME" ]; then
    echo "Domain cannot be empty."
    exit 1
fi

read -p "Enter the internal backend address (e.g., app-dev:3000 or localhost:3001): " BACKEND_ADDR
if [ -z "$BACKEND_ADDR" ]; then
    echo "Backend address cannot be empty."
    exit 1
fi

echo ""
echo "--- COPY BELOW ---"
echo ""

cat <<EOF
server {
    listen 80;
    server_name $DOMAIN_NAME;

    # Basic security headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-XSS-Protection "1; mode=block";
    add_header X-Content-Type-Options "nosniff";

    location / {
        proxy_pass http://$BACKEND_ADDR;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

echo ""
echo "--- END COPY ---"
echo ""
echo "Instructions:"
echo "1. Copy the block above into your Nginx configuration."
echo "2. Run 'nginx -t' to verify syntax."
echo "3. Run 'nginx -s reload' to apply changes."
echo "4. Use Certbot or similar to enable HTTPS: certbot --nginx -d $DOMAIN_NAME"
