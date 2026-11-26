# The bench's reference machine as an image: Ubuntu 24.04 with its own WebKitGTK and Mesa, the
# toolchains the repository pins, perf, and the debug symbols perf needs to name WebKitGTK's and
# Mesa's functions. Run without a GPU device (container.sh), every pixel is drawn by llvmpipe.
FROM ubuntu:24.04
ARG NODE_VERSION=24.21.0
ARG PNPM_VERSION=12.9.0
ARG RUST_VERSION=1.99.1
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
	ca-certificates curl git build-essential pkg-config python3 xz-utils file procps psmisc \
	libwebkit2gtk-4.1-dev libgtk-3-dev libgtk-4-dev libmpv-dev ffmpeg xvfb weston xwayland \
	mesa-utils libgl1-mesa-dri dbus-x11 x11-utils \
	linux-tools-generic gdb elfutils debuginfod ubuntu-dbgsym-keyring \
	&& rm -rf /var/lib/apt/lists/*

ENV PATH=/opt/node/bin:/opt/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
	| tar -xJ -C /opt && ln -s "/opt/node-v${NODE_VERSION}-linux-x64" /opt/node \
	&& npm install -g "pnpm@${PNPM_VERSION}"

ENV RUSTUP_HOME=/opt/rustup
RUN curl -fsSL https://sh.rustup.rs | CARGO_HOME=/opt/cargo sh -s -- -y --profile minimal \
	--default-toolchain "${RUST_VERSION}" --no-modify-path
# The repository's rust-toolchain.toml also asks for the cross targets: the bench needs none.
ENV RUSTUP_TOOLCHAIN=${RUST_VERSION}

# Ubuntu's perf wrapper refuses a kernel it was not built for; the binary itself is fine. The
# file capabilities let the bench's own user sample another process, kernel side included
# (container.sh adds both to the container).
RUN apt-get update && apt-get install -y --no-install-recommends libcap2-bin \
	&& rm -rf /var/lib/apt/lists/* \
	&& cp "$(ls /usr/lib/linux-tools-*/perf | head -1)" /usr/local/bin/perf \
	&& setcap cap_perfmon,cap_sys_ptrace=ep /usr/local/bin/perf

# Debug symbols, from ddebs. A package whose version ddebs does not carry is skipped: perf then
# falls back on debuginfod (DEBUGINFOD_URLS below) for that library.
RUN . /etc/os-release \
	&& printf 'deb http://ddebs.ubuntu.com %s main restricted universe multiverse\n' \
		"$VERSION_CODENAME" "$VERSION_CODENAME-updates" "$VERSION_CODENAME-proposed" \
		>/etc/apt/sources.list.d/ddebs.list \
	&& apt-get update \
	&& for p in libwebkit2gtk-4.1-0 libjavascriptcoregtk-4.1-0 mesa-libgallium libgl1-mesa-dri \
		libegl-mesa0 libglx-mesa0 libglib2.0-0t64 libgtk-3-0t64 libcairo2 libpixman-1-0 \
		libepoxy0 xvfb libc6; do \
		v=$(dpkg-query -W -f '${Version}' "$p" 2>/dev/null) || continue; \
		apt-get install -y --no-install-recommends "$p-dbgsym=$v" || echo "no dbgsym: $p $v"; \
	done \
	&& rm -rf /var/lib/apt/lists/*

ENV DEBUGINFOD_URLS=https://debuginfod.ubuntu.com
