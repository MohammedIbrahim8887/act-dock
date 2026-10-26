FROM ubuntu:24.04
ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip git zstd rpm fakeroot file xvfb xauth patchelf imagemagick nsis libgtk-3-0t64 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2 && rm -rf /var/lib/apt/lists/*
COPY --from=oven/bun:1.3.14 /usr/local/bin/bun /usr/local/bin/bun
RUN printf 'precedence ::ffff:0:0/96  100\n' >> /etc/gai.conf
ENV PATH="/root/.bun/bin:/root/.hutch/bin:$PATH"
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends squashfs-tools desktop-file-utils && rm -rf /var/lib/apt/lists/*
