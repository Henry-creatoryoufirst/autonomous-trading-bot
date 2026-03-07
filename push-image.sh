#!/bin/bash
# Manual Docker image push for STC client deployments
# Usage: ./push-image.sh [tag]
# Example: ./push-image.sh v11.2

TAG="${1:-latest}"
IMAGE="ghcr.io/henry-creatoryoufirst/stc-bot"

echo "Building STC bot image..."
docker build -t "${IMAGE}:${TAG}" -t "${IMAGE}:latest" .

echo ""
echo "Pushing ${IMAGE}:${TAG} and :latest..."
docker push "${IMAGE}:${TAG}"
docker push "${IMAGE}:latest"

echo ""
echo "Done. Clients on Railway will pick up the new image on next deploy."
echo "To force-redeploy all clients, use the Railway dashboard or API."
