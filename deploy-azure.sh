#!/bin/bash

# 🚀 PickTime - Azure Deployment Script
# Deploys PickTime to Azure App Service

set -e

echo "🔥 PickTime Azure Deployment Starting..."

# Configuration
RESOURCE_GROUP="picktime-rg"
APP_NAME="picktime-app"
LOCATION="West Europe"
APP_SERVICE_PLAN="picktime-plan"
MONGODB_CONNECTION_STRING=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    log_error "Azure CLI is not installed. Please install it first."
    exit 1
fi

# Login check
log_info "Checking Azure login status..."
if ! az account show &> /dev/null; then
    log_warn "Not logged into Azure. Please login first:"
    az login
fi

# Create resource group if it doesn't exist
log_info "Creating resource group '$RESOURCE_GROUP'..."
az group create \
    --name $RESOURCE_GROUP \
    --location "$LOCATION" \
    --output none

# Create App Service Plan if it doesn't exist
log_info "Creating App Service Plan '$APP_SERVICE_PLAN'..."
az appservice plan create \
    --name $APP_SERVICE_PLAN \
    --resource-group $RESOURCE_GROUP \
    --location "$LOCATION" \
    --sku B1 \
    --is-linux \
    --output none

# Create Web App
log_info "Creating Web App '$APP_NAME'..."
az webapp create \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --plan $APP_SERVICE_PLAN \
    --runtime "NODE:22-lts" \
    --output none

# Configure app settings
log_info "Configuring app settings..."

# Get MongoDB connection string (create if needed)
if [ -z "$MONGODB_CONNECTION_STRING" ]; then
    log_warn "MongoDB connection string not provided. You'll need to set it manually."
    MONGODB_CONNECTION_STRING="mongodb://localhost:27017/picktime"
fi

az webapp config appsettings set \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --settings \
        NODE_ENV=production \
        MONGODB_URI="$MONGODB_CONNECTION_STRING" \
        JWT_SECRET="$(openssl rand -base64 32)" \
        BASE_URL="https://$APP_NAME.azurewebsites.net" \
        ALLOWED_ORIGINS="https://$APP_NAME.azurewebsites.net" \
    --output none

# Deploy the application
log_info "Building and deploying application..."

# Install dependencies
npm install --production

# Create deployment zip
log_info "Creating deployment package..."
zip -r picktime-deploy.zip . \
    -x "*.git*" \
    -x "node_modules/*" \
    -x "*.log" \
    -x "deploy-azure.sh" \
    -x "README.md"

# Deploy to Azure
log_info "Deploying to Azure App Service..."
az webapp deployment source config-zip \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --src picktime-deploy.zip \
    --output none

# Clean up
rm picktime-deploy.zip

# Configure startup command
log_info "Configuring startup command..."
az webapp config set \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --startup-file "npm start" \
    --output none

# Enable logging
log_info "Enabling application logging..."
az webapp log config \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --application-logging filesystem \
    --level information \
    --output none

# Health check
log_info "Performing health check..."
sleep 30
HEALTH_URL="https://$APP_NAME.azurewebsites.net/api/health"
if curl -s "$HEALTH_URL" | grep -q "healthy"; then
    log_info "✅ Deployment successful! PickTime is running at:"
    echo ""
    echo "🌐 App URL: https://$APP_NAME.azurewebsites.net"
    echo "🔍 Health Check: $HEALTH_URL"
    echo ""
else
    log_error "❌ Health check failed. Please check the application logs:"
    echo "az webapp log tail --name $APP_NAME --resource-group $RESOURCE_GROUP"
fi

# Show helpful commands
echo ""
log_info "Useful commands:"
echo "• View logs: az webapp log tail --name $APP_NAME --resource-group $RESOURCE_GROUP"
echo "• Restart app: az webapp restart --name $APP_NAME --resource-group $RESOURCE_GROUP"
echo "• Update settings: az webapp config appsettings set --name $APP_NAME --resource-group $RESOURCE_GROUP --settings KEY=VALUE"
echo ""

log_info "🎉 PickTime deployment completed!"