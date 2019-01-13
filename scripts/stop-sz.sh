#!/bin/bash
# Script to shut down smart-zoneminder.
# Copyright (c) 2018, 2019 Lindo St. Angel

# Stop object detection server.
/usr/bin/pkill -f "/home/lindo/.virtualenvs/od/bin/python3 \
/home/lindo/develop/smart-zoneminder/obj-detect/obj_detect_server.py"

# Stop alarm frame uploder.
/usr/bin/pkill -f "/usr/local/bin/node \
/home/lindo/develop/smart-zoneminder/zm-s3-upload/zm-s3-upload.js"