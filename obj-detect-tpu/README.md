# obj-detect-tpu
The TPU Object Detection Server, [obj_detect_server_tpu.py](./obj_detect_server_tpu.py), runs [TPU-based](https://cloud.google.com/edge-tpu/) Tensorflow Lite inference engines using the [Google Coral](https://coral.withgoogle.com/) Python APIs and employees [zerorpc](http://www.zerorpc.io/) to communicate with the Alarm Uploader. One of the benefits of using zerorpc is that the object detection server can easily be run on another machine, apart from the machine running ZoneMinder (in this case a [Coral Dev Board](https://coral.withgoogle.com/products/dev-board/)). The server can optionally skip inference on consecutive ZoneMinder Alarm frames to minimize processing time which obviously assumes the same object is in every frame. The TPU Object Detection Server is run as a Linux service using systemd.

# Installation
1. Using the [Get Started Guide](https://coral.withgoogle.com/tutorials/devboard/), flash the Dev Board with the latest software image from Google.

2. The Dev Board has a modest 8GB on-board eMMC. You need to insert a MicroSD card (at least 32 GB) into the Dev Board to have enough space to install the software in the next steps. The SD card should be auto-mounted so on power-up and reboots the board can operate unattended. I mountded the SD card at /media/mendel. My corresponding ```/etc/fstab``` entry for the SD card is shown below.  

```bash
#/dev/mmcblk1 which is the sd card
UUID=ff2b8c97-7882-4967-bc94-e41ed07f3b83 /media/mendel ext4 defaults 0 2
```

3. Install zerorpc.
```bash
$ pip3 install zerorpc

# Test...
$ python3
Python 3.5.3 (default, Sep 27 2018, 17:25:39) 
[GCC 6.3.0 20170516] on linux
Type "help", "copyright", "credits" or "license" for more information.
>>> import zerorpc
>>> 
```

4. Install dlib.
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

# Get the latest version of dlib from GitHub.
$ git clone https://github.com/davisking/dlib.git
# Build the main dlib library.
$ cd dlib
$ mkdir build; cd build; cmake ..; cmake --build .
# Build and install the Python extensions.
$ cd ..
$ python3 setup.py install
# Test...
$ python3
Python 3.5.3 (default, Sep 27 2018, 17:25:39) 
[GCC 6.3.0 20170516] on linux
Type "help", "copyright", "credits" or "license" for more information.
>>> import dlib
>>>

# Disable and remove swap.
$ sudo swapoff /swapfile
$ sudo rm -i /swapfile
```

5. Install openCV.
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

# Install dependencies.
$ sudo apt install python3-dev python3-pip python3-numpy

$ sudo apt install build-essential cmake git libgtk2.0-dev pkg-config libavcodec-dev libavformat-dev libswscale-dev  libtbb2 libtbb-dev libjpeg-dev libpng-dev libtiff-dev libdc1394-22-dev protobuf-compiler libgflags-dev libgoogle-glog-dev libblas-dev libhdf5-serial-dev liblmdb-dev libleveldb-dev liblapack-dev libsnappy-dev libprotobuf-dev libopenblas-dev libgtk2.0-dev libboost-dev libboost-all-dev libeigen3-dev libatlas-base-dev libne10-10 libne10-dev

$ pip3 install neon

$ sudo apt install libneon27-dev

$ sudo apt install libneon27-gnutls-dev

# Download source.
$ wget -O opencv.zip https://github.com/opencv/opencv/archive/3.4.5.zip
$ unzip opencv.zip

$ wget -O opencv_contrib.zip https://github.com/opencv/opencv_contrib/archive/3.4.5.zip
$ unzip opencv_contrib.zip

# Configure OpenCV using cmake. This takes a while...
$ cd ~/opencv-3.4.5

$ mkdir build

$ cd build

$ cmake -D CMAKE_BUILD_TYPE=RELEASE -D ENABLE_NEON=ON -D ENABLE_TBB=ON -D ENABLE_IPP=ON -D ENABLE_VFVP3=ON -D WITH_OPENMP=ON -D WITH_CSTRIPES=ON -D WITH_OPENCL=ON -D CMAKE_INSTALL_PREFIX=/usr/local -D OPENCV_EXTRA_MODULES_PATH=/media/mendel/opencv_contrib-3.4.0/modules/ ..

# Compile and install. This takes a while...
$ make
$ sudo make install

# Test...
$ python3
Python 3.5.3 (default, Sep 27 2018, 17:25:39) 
[GCC 6.3.0 20170516] on linux
Type "help", "copyright", "credits" or "license" for more information.
>>> import cv2
>>>

# Disable and remove swap.
$ sudo swapoff /swapfile
$ sudo rm -i /swapfile
```

6. Install face_recognition.
```bash
$ pip3 install face_recognition

# Test...
$ python3
Python 3.5.3 (default, Sep 27 2018, 17:25:39) 
[GCC 6.3.0 20170516] on linux
Type "help", "copyright", "credits" or "license" for more information.
>>> import face_recognition
>>> 
```

7. Copy obj-detect-tpu.py and config.json in this director to ```/media/mendel/obj-detect-tpu```.

8. Mount ZoneMinder's alarm image store on the Dev Board so obj-detect-tpu can find the alarm images and process them. The store neededs to be auto-mounted using ```sshfs``` at startup which is done by an entry in ```/etc/fstab```.
```bash
# Setup sshfs.
$ sudo apt-get install sshfs

# Create mount point.
$ mkdir /mnt/nvr

# Setup SSH keys to enable auto login.
# See https://www.cyberciti.biz/faq/how-to-set-up-ssh-keys-on-linux-unix/
$ mkdir -p $HOME/.ssh
$ chmod 0700 $HOME/.ssh
# Create the key pair
$ ssh-keygen -t rsa
# Install the public key on the server hosting ZoneMinder.
$ ssh-copy-id -i $HOME/.ssh/id_rsa.pub lindo@192.168.1.4

# Corresponsing /etc/fstab entry:
$ more /etc/fstab
...
lindo@192.168.1.4:/nvr /mnt/nvr fuse.sshfs auto,user,_netdev,reconnect,uid=1000,gid=1000,IdentityFile=/home/mendel/.ssh/id_rsa,idmap=user,allow_other 0 0

# Mount the zm store.
$ sudo mount lindo@192.168.1.4/nvr
```

8. Edit the [config.json](./config.json) to suit your installation. The configuration parameters are documented in obj_detect_server_tpu.py. Since the TPU object detection server and ZoneMinder are running on different machines make sure both are using the same TCP socket.

9. Use systemd to run the Object Detection Server as a Linux service. Edit [obj-detect-tpu.service](../scripts/obj-detect-tpu.service) to suit your configuration and copy the file to /etc/systemd/system. Then enable the service:
```bash
$ sudo systemctl enable obj-detect-tpu.service
```