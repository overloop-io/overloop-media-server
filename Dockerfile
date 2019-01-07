FROM ubuntu:16.04

MAINTAINER Lynckia

WORKDIR /opt

# Download latest version of the code and install dependencies
RUN  apt-get update && apt-get install -y git wget curl

COPY .nvmrc package.json /opt/licode/

COPY scripts/installUbuntuDeps.sh scripts/installErizo.sh scripts/checkNvm.sh scripts/libnice-014.patch0 /opt/licode/scripts/

WORKDIR /opt/licode/scripts

RUN ./installUbuntuDeps.sh --cleanup --fast --enable-gpl

WORKDIR /opt/licode

COPY erizo/ /opt/licode/erizo/
COPY erizo_controller/ /opt/licode/erizo_controller/
COPY erizoAPI/ /opt/licode/erizoAPI/
COPY spine/ /opt/licode/spine/
COPY .eslintrc .eslintignore /opt/licode/
COPY scripts/rtp_media_config_default.js /opt/licode/scripts/
RUN ./scripts/installErizo.sh -dfeacs

COPY nuve/ /opt/licode/nuve
RUN ./nuve/installNuve.sh

COPY . /opt/licode

RUN mkdir /opt/licode/.git

# Clone and install licode
WORKDIR /opt/licode/scripts

RUN ./installBasicExample.sh

WORKDIR /opt

ENTRYPOINT ["./licode/extras/docker/initDockerLicode.sh"]
