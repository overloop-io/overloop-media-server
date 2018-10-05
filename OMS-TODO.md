# OMS Status & TODO

## Current Status

### General
- Runs on AWS EB (Deployment instructions in OMS-AWS-DEPLOYMENT.md)
- Supports incomming video in 640x480 only
- Outputs video in 640x480 only (See TODO)
- Outputs video in HLS Event format. This lets supported players scrub through the live stream while it is still occuring. One such player that is easy to test with is here: https://video-dev.github.io/hls.js/demo/

### Local Development

To develop locally, I have been using a `.env` file with the required environment variables (`AWS_KEY_ID`, `AWS_SECRET_KEY`, `AWS_REGION`, `AWS_BUCKET`) and then building the docker image from the docker file and running it with `docker run --it --net=host --env-file=.env oms`

### Current Video Flow
When ingesting a video the current process is as follows:
1. User Browser sends video via WebRTC to OMS by going to the base url and pressing the 'toggle recording' button
2. Internally in licode, the OMS stream is sent via `Libav` (An ffmpeg fork) out to a path set in `./licode.js` which is populated in the Docker image from `./scripts/licode_default.js`. This is currently set to a URL pointing to the Node code such that a HTTP connection is established to stream the output
3. The BasicExample node server receives that stream on `/livestream/<recording id>.mkv` and pipes it into FFmpeg via the fluent-ffmpeg node package. This is set to again output all the files to the node server. Because it is outputting HLS, it creates a seperate PUT for each segment and one for the manifest. Whe the node code gets these calls it uploads the files to the S3 bucket.
4. Anyone can stream the HLS from the S3 bucket

## TODO

### Linking Together Everything

#### Receiving Client Tokens

This should be implemented in the `basic_example` node server. Ideally, we'd create a route that the clients can target their websocket at and would checkcredentials before forwarding the connection onto the underlying socket which would allow us to keep the servers self contained and just scale it using EB scaling.

#### Link A Recording to A Client Token

At some point in the process, the recording is given a unique identifier instead of having the name of the room or the user included. Because we need to be able to link a video to the correct recording stream, we should see if we can change this behaviour. My suggestion is that in `./erizo_controller/erizoController/models/Client.js` line 355 we can alter the way that the stream url is generated. I would be tempted to suggest that we send the videoID in as the `user` argument when creating a token such that we can pull it out here from `this.user`. Then, when the stream gets posted to the url which would now contain the video ID we can forward it to the FFmpeg output url, so that when the manifest is uploaded we can call the overloop API and update the video.

### Multple HLS Transcodes

This should just be as simple as adding more `.output()` calls to the `fluent-ffmpeg` call in `basic_example`. We may need to construct the HLS playlist file manually, but that is fairly simple.

### Support More Input Resolutions

To do this, I think the only bottle neck is in the C++ code  in `./erizo/src/ExternalOutput.cpp` lines 386 and 387. I haven't had time to experiment with changing this (Or even omiting it) and the effect that will have on the stream. To test it with the basic_example, the client resolution can be set in `./extras/basic_example/public/script.js` line 62 by modifying the array which is of the form `[minWidth, minHeight, maxWidth, maxHeight]`

### Restructuring

We should probably pull our code out of `basic_example` and into a different folder (or even repository) and include licode in as a dependency or in a build script if we can. This would likely involve creating a set of patches that we can run against the code from inside docker to add in the minor changes we need. Otherwise, we could reform our changes to be more generic so we can PR them to the main licode repository.
