# How To Deploy

## Prerequisites
You must know the Amazon Elastic Container Registry url that you are intending to use

## Deployment steps

Deploying the OMS to AWS is a three stage process:

1. Locally build the OMS docker image with the `docker build` command
2. Push the image up to the Amazon ECR with a tag
3. Run the `./build.sh` script with environment vairables:
  - `REGISTRY_HOST` being set to the url of the Amazon ECR you're using
  - `OMS_BUILD_TAG` being the tag that you pushed the image under
4. Upload the produce deploy.zip to EB
