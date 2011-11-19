#!/bin/bash

redis-server &
node app.js --port=80 &
