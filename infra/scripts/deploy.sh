#!/usr/bin/env bash
# Deploys the Ringo stack, passing the Google client secret from Parameter Store.
#   STAGE=dev GOOGLE_CLIENT_ID=123-abc.apps.googleusercontent.com npm run deploy -w @ringo/infra
#   STAGE=prod GOOGLE_CLIENT_ID=… DOMAIN=example.com npm run deploy -w @ringo/infra
set -euo pipefail
: "${STAGE:?set STAGE (dev or prod)}" "${GOOGLE_CLIENT_ID:?set GOOGLE_CLIENT_ID}"
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

npx cdk deploy "Ringo-$STAGE" -c stage="$STAGE" -c googleClientId="$GOOGLE_CLIENT_ID" \
  ${DOMAIN:+-c domainName="$DOMAIN"} --parameters "GoogleClientSecret=$secret" "$@"
