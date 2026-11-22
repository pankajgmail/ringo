#!/usr/bin/env bash
# Deploys the Ringo stack, passing the Google client secret from Parameter Store.
#   STAGE=dev GOOGLE_CLIENT_ID=123-abc.apps.googleusercontent.com npm run deploy -w @ringo/infra
#   STAGE=prod GOOGLE_CLIENT_ID=… DOMAIN=example.com npm run deploy -w @ringo/infra
set -euo pipefail
: "${STAGE:?set STAGE (dev or prod)}" "${GOOGLE_CLIENT_ID:?set GOOGLE_CLIENT_ID}"
[[ "$GOOGLE_CLIENT_ID" == *.apps.googleusercontent.com ]] || { echo "GOOGLE_CLIENT_ID should end in .apps.googleusercontent.com" >&2; exit 1; }
cd "$(dirname "$0")/.."
account="$(jq -r .context.account cdk.json)"
region="$(jq -r .context.region cdk.json)"
current="$(aws sts get-caller-identity --query Account --output text)"
if [[ "$current" != "$account" ]]; then
  echo "Signed in to AWS account $current, but Ringo deploys to $account (infra/cdk.json). Sign in to the Ringo project first." >&2
  exit 1
fi

secret="$(aws ssm get-parameter --region "$region" --name "/ringo/$STAGE/google-client-secret" \
  --with-decryption --query Parameter.Value --output text)"

# Build the web app. Without a custom domain it is served from the same CloudFront host as the API.
pool_client="$(aws cloudformation describe-stacks --region "$region" --stack-name "Ringo-$STAGE" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text 2>/dev/null || true)"
if [[ -n "$pool_client" && "$pool_client" != "None" ]]; then
  api_url="same-origin"; [[ -n "${DOMAIN:-}" ]] && api_url="https://api.$DOMAIN"
  ( cd ../apps/mobile && rm -rf dist && \
    EXPO_PUBLIC_API_URL="$api_url" \
    EXPO_PUBLIC_COGNITO_DOMAIN="https://ringo-$STAGE-$account.auth.$region.amazoncognito.com" \
    EXPO_PUBLIC_COGNITO_CLIENT_ID="$pool_client" EXPO_PUBLIC_DEV_USER="" \
    npx expo export --platform web )
else
  echo "First deploy: skipping the web app (needs the Cognito client ID). Run this script again afterwards." >&2
fi

npx cdk deploy "Ringo-$STAGE" -c stage="$STAGE" -c googleClientId="$GOOGLE_CLIENT_ID" \
  ${DOMAIN:+-c domainName="$DOMAIN"} --parameters "GoogleClientSecret=$secret" "$@"
