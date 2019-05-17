# tpu-servers
This folder contains code and collateral for running the object and face detection servers using the Google edge Tensorflow Processing Unit (TPU). The Alarm Uploader can be configured to use these servers instead of GPU-based ones normally co-resident with the machine running ZoneMinder. 

The TPU-based object and face detection server, [detect_servers_tpu.py](./detect_servers_tpu.py), runs [TPU-based](https://cloud.google.com/edge-tpu/) Tensorflow Lite inference engines using the [Google Coral](https://coral.withgoogle.com/) Python APIs and employs [zerorpc](http://www.zerorpc.io/) to communicate with the Alarm Uploader. One of the benefits of using zerorpc is that the object detection server can easily be run on another machine, apart from the machine running ZoneMinder (in this case a [Coral Dev Board](https://coral.withgoogle.com/products/dev-board/)). The object detection can optionally skip inference on consecutive ZoneMinder Alarm frames to minimize processing time which obviously assumes the same object is in every frame. The server is run as a Linux service using systemd.

Images are sent to the object detection as an array of strings, in the following form.
```javascript
['path_to_image_1','path_to_image_2','path_to_image_n']
```

Object detection results are returned as json, an example is shown below.
```json
[ { "image": "/nvr/zoneminder/events/PlayroomDoor/19/04/04/04/30/00/00506-capture.jpg",
    "labels": 
     [ { "name": "person",
         "id": 0,
         "score": 0.98046875,
         "box": 
          { "xmin": 898.4868621826172,
            "xmax": 1328.2035827636719,
            "ymax": 944.9342751502991,
            "ymin": 288.86380434036255 } } ] },
  { "image": "/nvr/zoneminder/events/PlayroomDoor/19/04/04/04/30/00/00509-capture.jpg",
    "labels": 
     [ { "name": "person",
         "id": 0,
         "score": 0.83984375,
         "box": 
          { "xmin": 1090.408058166504,
            "xmax": 1447.4291610717773,
            "ymax": 846.3531160354614,
            "ymin": 290.5584239959717 } } ] },
  { "image": "/nvr/zoneminder/events/PlayroomDoor/19/04/04/04/30/00/00515-capture.jpg",
    "labels": [] } ]
```

The object detection results then in turn can be sent to the face detector, an example of the face detection results returned is shown below.
```json
[ {"image": "/nvr/zoneminder/events/PlayroomDoor/19/04/04/04/30/00/00506-capture.jpg",
    "labels": 
     [ { "box": 
          { "xmin": 898.4868621826172,
            "xmax": 1328.2035827636719,
            "ymax": 944.9342751502991,
            "ymin": 288.86380434036255 },
         "name": "person",
         "face": "lindo_st_angel",
         "score": 0.98046875,
         "id": 0 } ] },
  { "image": "/nvr/zoneminder/events/PlayroomDoor/19/04/04/04/30/00/00509-capture.jpg",
    "labels": 
     [ { "box": 
          { "xmin": 1090.408058166504,
            "xmax": 1447.4291610717773,
            "ymax": 846.3531160354614,
            "ymin": 290.5584239959717 },
         "name": "person",
         "face": null,
         "score": 0.83984375,
         "id": 0 } ] } ]
```

# Installation
1. Using the [Get Started Guide](https://coral.withgoogle.com/tutorials/devboard/), flash the Dev Board with the latest software image from Google.

2. The Dev Board has a modest 8GB on-board eMMC. You need to insert a MicroSD card (at least 32 GB) into the Dev Board to have enough space to install the software in the next steps. The SD card should be auto-mounted so on power-up and reboots the board can operate unattended. I mounted the SD card at ```/media/mendel```. My corresponding ```/etc/fstab``` entry for the SD card is shown below.  

```bash
#/dev/mmcblk1 which is the sd card
UUID=ff2b8c97-7882-4967-bc94-e41ed07f3b83 /media/mendel ext4 defaults 0 2
```

3. Create a swap file.
```bash
$ cd /media/mendel

# Create a swapfile else you'll run out of memory compiling.
$ sudo mkdir swapfile
# Now let's increase the size of swap file.
$ sudo dd if=/dev/zero of=/swapfile bs=1M count=1024 oflag=append conv=notrunc
# Setup the file as a "swap file".
$ sudo mkswap /swapfile
# Enable swapping.
$ sudo swapon /swapfile
```

4. Install zerorpc.
```bash
# Install dependencies.
$ sudo apt install python3-dev libffi-dev

$ pip3 install zerorpc

# Test...
$ python3
>>> import zerorpc
>>> 
```

5. Install OpenCV.

NB: The Coral's main CPU is a Quad-core Cortex-A53 which uses an Armv8 microarchitecture and supports single-precision (32-bit, aka AArch32) and double-precision (64-bit, aka AArch64) floating-point data types and arithmetic as defined by the IEEE 754 floating-point standard. OpenCV can use [SIMD (NEON)](https://developer.arm.com/architectures/instruction-sets/simd-isas/neon) instructions to accelerate its computations which is enabled by the cmake options as shown below. For more information about floating point operations from Arm, see [Floating Point](https://developer.arm.com/architectures/instruction-sets/floating-point).

```bash
# Install basic dependencies.
$ sudo apt install python3-dev python3-pip python3-numpy \
build-essential cmake git libgtk2.0-dev pkg-config \
libavcodec-dev libavformat-dev libswscale-dev libtbb2 libtbb-dev \
libjpeg-dev libpng-dev libtiff-dev libdc1394-22-dev protobuf-compiler \
libgflags-dev libgoogle-glog-dev libblas-dev libhdf5-serial-dev \
liblmdb-dev libleveldb-dev liblapack-dev libsnappy-dev libprotobuf-dev \
libopenblas-dev libgtk2.0-dev libboost-dev libboost-all-dev \
libeigen3-dev libatlas-base-dev libne10-10 libne10-dev liblapacke-dev

# Install neon SIMD acceleration dependencies.
$ sudo apt install libneon27-dev libneon27-gnutls-dev

# Download source.
$ cd /media/mendel
$ wget -O opencv.zip https://github.com/opencv/opencv/archive/3.4.5.zip
$ unzip opencv.zip
$ wget -O opencv_contrib.zip https://github.com/opencv/opencv_contrib/archive/3.4.5.zip
$ unzip opencv_contrib.zip

# Configure OpenCV using cmake.
$ cd /media/mendel/opencv-3.4.5
$ mkdir build
$ cd build
# NB VFPv3 is not used in Armv8-A (AArch66)...don't set -DENABLE_VFPV3=ON.
$ cmake -D CMAKE_BUILD_TYPE=RELEASE -D ENABLE_NEON=ON -D ENABLE_TBB=ON \
-D ENABLE_IPP=ON -D WITH_OPENMP=ON -D WITH_CSTRIPES=OFF -D WITH_OPENCL=ON \
-D BUILD_TESTS=OFF -D INSTALL_PYTHON_EXAMPLES=OFF D BUILD_EXAMPLES=OFF \
-D CMAKE_INSTALL_PREFIX=/usr/local \
-D OPENCV_EXTRA_MODULES_PATH=/media/mendel/opencv_contrib-3.4.5/modules/ ..

# Compile and install. This takes a while...cross compile if impatient
$ make
$ sudo make install

# Rename binding.
$ cd /usr/local/lib/python3.5/dist-packages/cv2/python-3.5
$ sudo mv cv2.cpython-35m-aarch64-linux-gnu.so cv2.so

# Test...
$ python3
>>> import cv2
>>>  cv2.__version__
'3.4.5'
>>>
```

6. Install scikit-learn.
```bash
# Install
$ pip3 install scikit-learn

# Test...
$ python3
>>> import sklearn
>>>
```

7. Disable and remove swap.
```bash
$ cd /media/mendel
$ sudo swapoff /swapfile
$ sudo rm -i /swapfile
```

8. Copy *detect_server_tpu*, *config.json*, *encode_faces.py*, *train.py*, in this directory to ```/media/mendel/tpu-servers/``` on the Coral dev board. Create the ```tpu-servers``` directory if needed. 

9. Copy the face image dataset from [face-det-rec](./face-det-rec) to ```/media/mendel/tpu-servers/```. These are used to train the svm-based face classifier. 

10. Download the face embeddings dnn model *nn4.v2.t7* from [OpenFace](https://cmusatyalab.github.io/openface/models-and-accuracies/) to the ```/media/mendel/tpu-servers``` directory.

11. Download the tpu face recognition dnn model *MobileNet SSD v2 (Faces)* from [Google Coral](https://coral.withgoogle.com/models/) to the ```/media/mendel/tpu-servers``` directory.

12. Download both the *MobileNet SSD v2 (COCO)* tpu object detection dnn model and label file from [Google Coral](https://coral.withgoogle.com/models/) to the ```/media/mendel/tpu-servers``` directory.

13. Run the face encoder program, [encode_faces.py](./encode_faces.py), using the images copied aobve. This will create a pickle file containing the face embeddings used to train the svm-based face classifier.

14. Run the svm-based face classifier training program, [train.py](./train.py). This will create two pickle files - one for the svm model and one for the model labels.

15. Mount ZoneMinder's alarm image store on the Dev Board so the server can find the alarm images and process them. The store should be auto-mounted using ```sshfs``` at startup which is done by an entry in ```/etc/fstab```.
```bash
# Setup sshfs.
$ sudo apt-get install sshfs

# Create mount point.
$ sudo mkdir /mnt/nvr

# Setup SSH keys to enable auto login.
# See https://www.cyberciti.biz/faq/how-to-set-up-ssh-keys-on-linux-unix/
$ mkdir -p $HOME/.ssh
$ chmod 0700 $HOME/.ssh
# Create the key pair
$ ssh-keygen -t rsa
# Install the public key on the server hosting ZoneMinder.
$ ssh-copy-id -i $HOME/.ssh/id_rsa.pub lindo@192.168.1.4

# Edit /etc/fstab so that the store is automounted. Here's mine.
$ more /etc/fstab
...
lindo@192.168.1.4:/nvr /mnt/nvr fuse.sshfs auto,user,_netdev,reconnect,uid=1000,gid=1000,IdentityFile=/home/mendel/.ssh/id_rsa,idmap=user,allow_other 0 2

# Test mount the zm store. This will happen at boot from now on. 
$ sudo mount -a
$ ls /mnt/nvr
camera-share  lost+found  zoneminder
```

16. Edit the [config.json](./config.json) to suit your installation. The configuration parameters are documented in server code. Since the TPU detection servers and ZoneMinder are running on different machines make sure both are using the same TCP socket.

17. Use systemd to run the server as a Linux service. Edit [detect-tpu.service](./detect-tpu.service) to suit your configuration and copy the file to ```/lib/systemd/system/detect-tpu.service```. Then enable and start the service:
```bash
$ sudo systemctl enable detect-tpu.service && sudo systemctl start detect-tpu.service
```

18. Test the entire setup by editing ```detect_dervers_test.py``` with paths to test images and running that program.