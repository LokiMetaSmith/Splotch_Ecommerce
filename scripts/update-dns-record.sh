#!/bin/bash

# Utility to add a DNS A record using DigitalOcean CLI (doctl)

echo "------------------------------------------------------------------"
echo "DNS A Record Update Tool (DigitalOcean)"
echo "------------------------------------------------------------------"

if ! command -v doctl &> /dev/null; then
    echo "Error: 'doctl' is not installed or not in your PATH."
    echo ""
    echo "This script requires the DigitalOcean CLI to automate DNS updates."
    echo "Please install it: https://docs.digitalocean.com/reference/doctl/how-to/install/"
    echo ""
    echo "Alternatively, you can manually add the record in your DNS provider's dashboard:"
    echo "  Type: A"
    echo "  Name: <subdomain> (e.g., 'dev')"
    echo "  Value: <your-server-ip>"
    exit 1
fi

echo "This script will add an 'A' record to your domain."
echo ""

read -p "Enter your root domain (e.g., example.com): " DOMAIN
if [ -z "$DOMAIN" ]; then
    echo "Domain cannot be empty."
    exit 1
fi

read -p "Enter the record name/subdomain (e.g., 'dev' or '@' for root): " RECORD_NAME
if [ -z "$RECORD_NAME" ]; then
    echo "Record name cannot be empty."
    exit 1
fi

read -p "Enter the IP address (e.g., 203.0.113.10): " IP_ADDRESS
if [ -z "$IP_ADDRESS" ]; then
    echo "IP address cannot be empty."
    exit 1
fi

echo ""
echo "Adding A record: $RECORD_NAME.$DOMAIN -> $IP_ADDRESS"
echo "Running: doctl compute domain records create $DOMAIN --record-type A --record-name $RECORD_NAME --record-data $IP_ADDRESS"
echo ""

read -p "Are you sure? (y/n): " CONFIRM
if [[ "$CONFIRM" != "y" ]]; then
    echo "Operation cancelled."
    exit 0
fi

doctl compute domain records create "$DOMAIN" --record-type A --record-name "$RECORD_NAME" --record-data "$IP_ADDRESS"

if [ $? -eq 0 ]; then
    echo ""
    echo "Success! DNS record added."
    echo "Note: DNS propagation may take some time."
else
    echo ""
    echo "Failed to add DNS record. Please check your inputs and doctl authentication."
fi
