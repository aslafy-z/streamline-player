# What a from-source WebKitGTK build needs, on top of the bench's reference image: the build
# dependencies of Ubuntu's own webkit2gtk package, so webkit.sh can configure the build the way
# the distribution does. Only packages are installed here: webkit.sh compiles in a container it
# pins to its own CPUs, which an image build cannot be.
FROM streamline-bench:noble

RUN sed -i 's/^Types: deb$/Types: deb deb-src/' /etc/apt/sources.list.d/ubuntu.sources \
	&& apt-get update \
	&& apt-get build-dep -y --no-install-recommends webkit2gtk \
	&& apt-get install -y --no-install-recommends cmake ninja-build ccache rsync patch dpkg-dev \
	&& rm -rf /var/lib/apt/lists/*
