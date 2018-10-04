[ -z "$REGISTRY_HOST" ] && echo "Need to set REGISTRY_HOST" && exit 1
[ -z "$OMS_BUILD_TAG" ] && echo "Need to set OMS_BUILD_TAG" && exit 1
envsubst '${REGISTRY_HOST},${OMS_BUILD_TAG}' < Dockerrun.aws.json.template > Dockerrun.aws.json
zip -r deployment.aws.zip Dockerrun.aws.json .ebextensions
rm Dockerrun.aws.json
