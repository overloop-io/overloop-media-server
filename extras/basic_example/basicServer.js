/*global require, __dirname, console*/
'use strict';
var express = require('express'),
    bodyParser = require('body-parser'),
    errorhandler = require('errorhandler'),
    morgan = require('morgan'),
    N = require('./nuve'),
    fs = require('fs'),
    https = require('https'),
    config = require('./../../licode_config');
const aws = require('aws-sdk');
const ffmpeg = require('fluent-ffmpeg');
const stream = require('stream');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

const roomIdToVideo = {};

var options = {
    key: fs.readFileSync('../../cert/key.pem').toString(),
    cert: fs.readFileSync('../../cert/cert.pem').toString()
};

if (config.erizoController.sslCaCerts) {
    options.ca = [];
    for (var ca in config.erizoController.sslCaCerts) {
        options.ca.push(fs.readFileSync(config.erizoController.sslCaCerts[ca]).toString());
    }
}

var app = express();

// app.configure ya no existe
app.use(errorhandler({
    dumpExceptions: true,
    showStack: true
}));
app.use(morgan('dev'));
app.use(express.static(__dirname + '/public'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});


//app.set('views', __dirname + '/../views/');
//disable layout
//app.set("view options", {layout: false});

N.API.init(config.nuve.superserviceID, config.nuve.superserviceKey, 'http://localhost:3000/');

var getOrCreateRoom = function (name, type = 'erizo', mediaConfiguration = 'default',
                                callback = function() {}) {
    return new Promise((resolve, reject) => {
      N.API.getRooms(function (roomlist){
          var theRoom = '';
          var rooms = JSON.parse(roomlist);
          for (var room of rooms) {
              if (room.name === name &&
                  room.data &&
                  room.data.basicExampleRoom){

                  theRoom = room._id;
                  callback(theRoom);
                  resolve(theRoom);
                  return;
              }
          }
          let extra = {data: {basicExampleRoom: true}, mediaConfiguration: mediaConfiguration};
          if (type === 'p2p') extra.p2p = true;

          N.API.createRoom(name, function (roomID) {
              theRoom = roomID._id;
              console.log('Creating room', roomID);
              console.log(roomID.controller);
              callback(theRoom);
              resolve(theRoom);
          }, function(err) {
            reject(err);
          }, extra);
      });
    });
};

var deleteRoomsIfEmpty = function (theRooms, callback) {
    if (theRooms.length === 0){
        callback(true);
        return;
    }
    var theRoomId = theRooms.pop()._id;
    N.API.getUsers(theRoomId, function(userlist) {
        var users = JSON.parse(userlist);
        if (Object.keys(users).length === 0){
            N.API.deleteRoom(theRoomId, function(){
                deleteRoomsIfEmpty(theRooms, callback);
            });
        } else {
            deleteRoomsIfEmpty(theRooms, callback);
        }
    }, function (error, status) {
        console.log('Error getting user list for room ', theRoomId, 'reason: ', error);
        switch (status) {
            case 404:
                deleteRoomsIfEmpty(theRooms, callback);
                break;
            case 503:
                N.API.deleteRoom(theRoomId, function(){
                    deleteRoomsIfEmpty(theRooms, callback);
                });
                break;
        }
    });
};

app.post('/streams/:id', async function(req, res, next) {
  try {
    if (
      req.params &&
      req.params.id &&
      req.body &&
      req.body.data &&
      req.body.data.token
    ) {
      const { id } = req.params;
      const { token } = req.body.data;
      console.log(id, token, process.env.API_URL);
      console.log(`Request to add callback for ${id}`)
      const response = await fetch(`${process.env.API_URL}/videos/${id}`, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'x-token': token
        }
      })
      if (response.status !== 200) {
        console.log('Video check failed: ', response.status, await response.text());
        return res.status(404).send('Unknown video')
      }
      const {
        data: video,
      } = await response.json()
      const {
        uid,
        userType,
      } = jwt.decode(token);
      // if (video.playerType !== 'LIVE' || video.liveStreamStatus !== 'READY') {
      //   return res.status(400).json({
      //     error: `Video type is invalid. Expected (LIVE, READY) found (${video.playerType}, ${video.liveStreamStatus})`
      //   })
      // }

      N.API.createRoom(id, function (room) {
        console.log('Creating room', room);
        roomIdToVideo[room._id] = {
          room,
          videoId: id,
          token,
        };
        N.API.createToken(room._id, `${userType}:${uid}`, 'presenter', function(room_token) {
          console.log('Token created', room_token);
          res.json({
            data: {
              token: room_token,
            },
          });
        }, function(error) {
          console.log('Error creating token', error);
          res.status(401).send('No Erizo Controller found');
        });
      });
    } else {
      res.status(404).send('Missing Param')
    }
  } catch (e) {
    next(e)
  }
    // console.log('Creating token. Request body: ',req.body);
    //
    // let username = req.body.username;
    // let role = req.body.role;
    //
    // let room = defaultRoomName, type, roomId, mediaConfiguration;
    //
    // if (req.body.room) room = req.body.room;
    // if (req.body.type) type = req.body.type;
    // if (req.body.roomId) roomId = req.body.roomId;
    // if (req.body.mediaConfiguration) mediaConfiguration = req.body.mediaConfiguration;
    //
    // let createToken = function (roomId) {
    //   N.API.createToken(roomId, username, role, function(token) {
    //       console.log('Token created', token);
    //       res.send(token);
    //   }, function(error) {
    //       console.log('Error creating token', error);
    //       res.status(401).send('No Erizo Controller found');
    //   });
    // };
    //
    // if (roomId) {
    //   createToken(roomId);
    // } else {
    //   getOrCreateRoom(room, type, mediaConfiguration, createToken);
    // }

});

let streams = 0;
setInterval(() => console.log(`Active stream count: ${streams}`), 5000);
app.use('/livestream/:filename', function(req, res, next) {
  const roomId = req.params.filename.split('.')[0]
  const {
    token,
    videoId,
  } = roomIdToVideo[roomId];
  ffmpeg(req)
    .inputOptions([
      // '-v debug',
      '-fflags +genpts',
    ])
    .outputOptions([
      // '-vcodec copy',
      // '-acodec copy',
      // '-hls_segment_type fmp4',
      '-hls_time 5',
      '-hls_playlist_type event',
      '-max_muxing_queue_size 10240',
    ])
    .output(`http://localhost:3001/s3/${videoId}/master.m3u8`)
    .on('start', () => {
      console.log('FFMpeg starting')
      streams ++;
      fetch(`${process.env.API_URL}/videos/${videoId}`, {
        method: 'PUT',
        body: JSON.stringify({
          data: {
            contentState: 'READY',
            contentUrl: `${process.env.PLAYOUT_URL}/${videoId}/master.m3u8`,
            liveStreamStatus: 'STARTED',
          }
        }),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'x-token': token
        }
      }).then(response => {
        if (response.status !== 200) {
          response.text().then(text => console.log('Failed to set the live stream status:', response.status, text))
        }
      })
    })
    .on('codecData', data => console.log('FFMpeg codec data: ', data))
    .on('stderr', line => console.error(`STDERROR: ${line}`))
    .on('progress', (progress) => console.log(`FFMpeg progress - frames: ${progress.frames}`))
    .on('error', (err) => console.log(`FFMpeg error: ${err.message}`))
    .on('end', () => {
      console.log('FFMpeg end')
      streams --;
      fetch(`${process.env.API_URL}/videos/${videoId}`, {
        method: 'PUT',
        body: JSON.stringify({
          data: {
            liveStreamStatus: 'ENDED',
            audience: {
              audienceType: 'PRIVATE',
            },
          },
        }),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'x-token': token
        }
      })
    })
    .run();
  req.on('end', function() {
    console.log('Connection end.');
  });
  req.on('close', function() {
    // Patch in support for the end event, as it isn't emitted?
    console.log('Connection closed.');
    req.emit('end');
  });
});

const s3 = new aws.S3({
  accessKeyId: process.env.AWS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_KEY,
  region: process.env.AWS_REGION,
});

function uploadFromStream(filename, contentType) {
  const pass = new stream.PassThrough();
  const promise = new Promise((resolve, reject) => {
    var params = {Bucket: process.env.AWS_BUCKET, Body: pass, Key: filename, ContentType: contentType };
    s3.upload(params, function(err, data) {
      if (err) {
        return reject(err);
      }
      resolve(data);
    });
  });
  return {
    stream: pass,
    promise: promise,
  };
}

app.use('/s3', function (req, res) {
  const address = req.path.substring(1);
  console.log('POST file to s3: ', address);
  const upload = uploadFromStream(address, address.endsWith('.ts') ? 'video/MP2T' : 'application/x-mpegURL');
  req.pipe(upload.stream)
  upload.promise.then(function() {
    res.sendStatus(200);
  })
});

app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, DELETE');
    res.header('Access-Control-Allow-Headers', 'origin, content-type');
    if (req.method === 'OPTIONS') {
        res.send(200);
    } else {
        next();
    }
});

app.get('/stats', async function(req, res) {
  const rooms = JSON.parse(await new Promise(N.API.getRooms));
  const data = await Promise.all(rooms.map(async ({ name, _id }) => {
    const users = JSON.parse(await new Promise(res => N.API.getUsers(_id, res)));
    return {
      id: name,
      users,
    };
  }));
  res.json(data);
})

console.log('BasicExample started');
app.listen(3001);
