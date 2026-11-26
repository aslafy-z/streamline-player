# The same bench on a rolling distribution, for the WebKitGTK and Mesa releases Ubuntu does not
# carry yet. It only runs what the Ubuntu image built: the bench app and the engine are binaries
# under /bench/out and the repository, linked against libraries Arch still provides.
# perf names functions through debuginfod: Arch ships no debug packages in its repositories.
FROM archlinux:latest
ARG NODE_VERSION=24.21.0

RUN pacman -Syu --noconfirm --needed \
	webkit2gtk-4.1 gtk3 mesa mesa-utils xorg-server-xvfb xorg-xwayland weston dbus \
	gst-plugins-base gst-plugins-good ffmpeg mpv python curl git procps-ng psmisc \
	perf debuginfod libcap xz \
	&& pacman -Scc --noconfirm

ENV PATH=/opt/node/bin:/usr/local/sbin:/usr/local/bin:/usr/bin
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
	| tar -xJ -C /opt && ln -s "/opt/node-v${NODE_VERSION}-linux-x64" /opt/node

# The file capabilities let the bench's own user sample another process, kernel side included
# (container.sh adds both to the container).
RUN cp /usr/bin/perf /usr/local/bin/perf && setcap cap_perfmon,cap_sys_ptrace=ep /usr/local/bin/perf

ENV DEBUGINFOD_URLS=https://debuginfod.archlinux.org
