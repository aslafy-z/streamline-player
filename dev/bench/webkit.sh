#!/usr/bin/env bash
# WebKitGTK from source, for the bench to run instead of the distribution's library:
# dev/bench/webkit.sh image|fetch <version>|build <version> <label> [--from <label>]|env <version> <label>|sh
#   image  builds the build image (container/webkit-build.Dockerfile, on streamline-bench:noble)
#   fetch  downloads webkitgtk-<version>.tar.xz and extracts it, pristine, to
#          /bench/webkit/src/<version>
#   build  builds the label "stock" from the pristine source, and any other label from a copy
#          of another label's work tree, source and build (--from, default stock), with
#          dev/bench/webkit-patches/<version>/<label>/*.patch applied on top in name order: only
#          what the patches touch is compiled, ccache answers for the rest. It installs to
#          /bench/webkit/install/<version>-<label> and records the patches (name and SHA-256)
#          and the configuration it was built with. Run again, it says which case it is in:
#            up to date    same patches, same configuration: nothing runs
#            incremental   the patches changed: the ones that differ are reverted and applied
#                          again, ninja rebuilds what they touch
#            resuming      the last build did not finish: ninja carries on
#            new           no work tree yet
#   env    prints the environment that makes a process load that build (one VAR=value per line)
#   sh     a shell in the build container
# Called on the host, each subcommand but env runs in its own container: BENCH_WEBKIT_CPUS
# logical CPUs (default 8-11) and BENCH_WEBKIT_JOBS compile jobs (default 4). Both are low on
# purpose, to keep the machine quiet and off the CPUs the bench is measured on (0,2,4,6); the
# stock build takes hours that way. Raise them when noise does not matter:
#   BENCH_WEBKIT_CPUS=8-15 BENCH_WEBKIT_JOBS=8 dev/bench/webkit.sh build 2.52.6 stock
# Everything lives under BENCH_CACHE (default ~/.cache/streamline-bench), mounted at /bench:
# webkit/src, webkit/work/<version>-<label> (src, build, applied patches, the "built" record),
# webkit/install, webkit/ccache, webkit/logs (one log per build). A work tree can be removed
# once its label is installed; the label then starts from a copy again.
# The install prefix is compiled into the library (it starts WebKitWebProcess from there), so a
# build only runs where the cache is mounted at /bench, as in the bench container.
set -eu
export LC_ALL=C
here=$(cd "$(dirname "$0")" && pwd)
cache=${BENCH_CACHE:-$HOME/.cache/streamline-bench}
image=${BENCH_WEBKIT_IMAGE:-streamline-bench:webkit-build}
engine=${BENCH_ENGINE:-docker}
cpus=${BENCH_WEBKIT_CPUS:-8-11}
jobs=${BENCH_WEBKIT_JOBS:-4}
root=/bench/webkit
# Every label is mounted here in the build container: a copied build tree keeps its absolute
# paths, and ccache sees the same paths whatever the label.
wk=/wk

die() {
	echo "webkit.sh: $*" >&2
	exit 1
}

check_version() {
	[[ ${1:-} =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version: x.y.z, got '${1:-}'"
}

check_label() {
	[[ ${1:-} =~ ^[a-z0-9][a-z0-9._-]*$ ]] || die "label: [a-z0-9._-]+, got '${1:-}'"
}

# Runs this script again in the build container: enter <name> [docker run options…] -- <args…>
enter() {
	local name=$1 opts=()
	shift
	while [ "$1" != -- ]; do
		opts+=("$1")
		shift
	done
	shift
	mkdir -p "$cache/home" "$cache/webkit"
	exec "$engine" run --rm --init --name "$name" --cpuset-cpus "$cpus" \
		--user "$(id -u):$(id -g)" -e HOME=/bench/home -e BENCH_WEBKIT_INSIDE=1 \
		-e BENCH_WEBKIT_JOBS="$jobs" -v "$cache:/bench" -v "$here:$here:ro" \
		"${opts[@]}" "$image" "$@"
}

fetch() {
	local v=$1 tar=$root/src/webkitgtk-$1.tar.xz url=https://webkitgtk.org/releases/webkitgtk-$1.tar.xz
	[ ! -d "$root/src/$v" ] || {
		echo "$root/src/$v is already there"
		return 0
	}
	mkdir -p "$root/src"
	if [ ! -f "$tar" ]; then
		curl -fL --retry 3 -o "$tar.part" "$url"
		mv "$tar.part" "$tar"
	fi
	# The checksum comes from the same server: it catches a broken download, nothing more.
	local sum
	sum=$(curl -fsSL "$url.sums" | awk '$1 == "sha256sum:" { print $2 }') || sum=
	if [ -n "$sum" ]; then
		echo "$sum  $tar" | sha256sum -c - || die "$tar does not match $url.sums"
	else
		echo "no checksum at $url.sums: the archive is not verified" >&2
	fi
	rm -rf "$root/src/$v.tmp"
	mkdir "$root/src/$v.tmp"
	tar -xJf "$tar" -C "$root/src/$v.tmp" --strip-components=1 --no-same-owner
	mv "$root/src/$v.tmp" "$root/src/$v"
	echo "$root/src/$v"
}

# Ubuntu's own build (debian/rules of webkit2gtk 2.52.6-0ubuntu0.24.04.2) with what the bench
# does not load turned off. The compiler, its flags and everything on the rendering path are
# Ubuntu's: clang, -O2, frame pointers, -g1, bmalloc, Skia, GBM, both windowing targets.
cmake_args() {
	local flags ldflags
	flags="-g1 -O2 -fno-omit-frame-pointer -mno-omit-leaf-frame-pointer -fstack-protector-strong"
	flags="$flags -fstack-clash-protection -Wformat -Werror=format-security -fcf-protection"
	flags="$flags -D_FORTIFY_SOURCE=3 -DNDEBUG -DG_DISABLE_CAST_CHECKS"
	ldflags="-Wl,-Bsymbolic-functions -Wl,-z,relro -Wl,-z,now -Wl,--reduce-memory-overheads"
	args=(
		-GNinja -DPORT=GTK -DCMAKE_BUILD_TYPE=Release
		-DCMAKE_INSTALL_PREFIX="$1" -DCMAKE_INSTALL_LIBDIR=lib
		-DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++
		-DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_CXX_COMPILER_LAUNCHER=ccache
		"-DCMAKE_C_FLAGS=$flags" "-DCMAKE_CXX_FLAGS=$flags"
		-DCMAKE_C_FLAGS_RELEASE= -DCMAKE_CXX_FLAGS_RELEASE=
		"-DCMAKE_EXE_LINKER_FLAGS=$ldflags" "-DCMAKE_SHARED_LINKER_FLAGS=$ldflags"
		"-DCMAKE_MODULE_LINKER_FLAGS=$ldflags"
		-DUSE_GTK4=OFF -DDEBUG_FISSION=OFF -DUSER_AGENT_BRANDING=Ubuntu
		-DUSE_AVIF=OFF -DUSE_JPEGXL=OFF -DENABLE_SPEECH_SYNTHESIS=OFF -DUSE_LIBBACKTRACE=OFF
		# From here on, where this build leaves Ubuntu's.
		-DENABLE_DOCUMENTATION=OFF -DENABLE_INTROSPECTION=OFF -DENABLE_MINIBROWSER=OFF
		-DENABLE_WEBDRIVER=OFF -DENABLE_BUBBLEWRAP_SANDBOX=OFF -DENABLE_GAMEPAD=OFF
		-DUSE_SYSPROF_CAPTURE=OFF
	)
}

# What a build is made of, one line each: the configuration, the patches the work tree was
# copied with (base), and the label's own. $wk/built holds the record of the last finished build.
record() {
	local dir=$1 label=$2 p
	echo "configure ${args[*]}"
	[ ! -f $wk/base ] || cat $wk/base
	if [ -d "$dir" ]; then
		for p in "$dir"/*.patch; do
			[ ! -e "$p" ] || echo "patch $(sha256sum <"$p" | cut -d' ' -f1) $label/$(basename "$p")"
		done
	fi
}

# The work tree of a label that has none: a copy of another label's source and build, or the
# pristine source for stock. cp -a keeps the timestamps, which is what lets ninja skip
# everything that did not change.
seed() {
	local v=$1 from=$2 base=$root/work/$1-$2
	rm -rf $wk/seed
	mkdir $wk/seed
	if [ -n "$from" ]; then
		[ -f "$base/built" ] || die "no finished build of $v-$from to start from: webkit.sh build $v $from"
		echo "copying the work tree of $v-$from"
		cp -a "$base/src" "$base/build" $wk/seed/
		grep '^patch ' "$base/built" >$wk/seed/base || true
		mv $wk/seed/build $wk/build
		mv $wk/seed/base $wk/base
	else
		[ -d "$root/src/$v" ] || die "no source: webkit.sh fetch $v"
		echo "copying the pristine source"
		cp -a "$root/src/$v" $wk/seed/src
	fi
	mkdir $wk/applied
	mv $wk/seed/src $wk/src
	rmdir $wk/seed
}

# Brings the source to the label's patch set. $wk/applied holds a copy of each patch as it was
# applied: the ones that are gone or changed, and every one after them, are reverted from that
# copy, then the current ones are applied. A patch that does not apply cleanly stops the build
# before it changes a file.
sync_patches() {
	local dir=$1 label=$2 want=() have=() k=0 i
	if [ -d "$dir" ]; then
		for i in "$dir"/*.patch; do
			[ ! -e "$i" ] || want+=("$i")
		done
	fi
	[ "$label" != stock ] || [ ${#want[@]} -eq 0 ] || die "the label stock takes no patch ($dir)"
	for i in $wk/applied/*.patch; do
		[ ! -e "$i" ] || have+=("$i")
	done
	while [ $k -lt ${#want[@]} ] && [ $k -lt ${#have[@]} ] \
		&& [ "$(basename "${want[$k]}")" = "$(basename "${have[$k]}")" ] \
		&& cmp -s "${want[$k]}" "${have[$k]}"; do
		k=$((k + 1))
	done
	for ((i = ${#have[@]} - 1; i >= k; i--)); do
		echo "reverting $(basename "${have[$i]}")"
		patch -d $wk/src -p1 -R -f -s --no-backup-if-mismatch <"${have[$i]}" \
			|| die "cannot revert $(basename "${have[$i]}"): remove the work tree of $label and build again"
		rm "${have[$i]}"
	done
	for ((i = k; i < ${#want[@]}; i++)); do
		echo "applying $(basename "${want[$i]}")"
		patch -d $wk/src -p1 -N -f -s --dry-run <"${want[$i]}" \
			|| die "$(basename "${want[$i]}") does not apply: nothing was changed by it"
		patch -d $wk/src -p1 -N -f -s --no-backup-if-mismatch <"${want[$i]}"
		cp "${want[$i]}" $wk/applied/
	done
}

configure() {
	local prefix=$1 old
	if [ -f $wk/build/build.ninja ] && [ "$(cat $wk/build/.bench-configure 2>/dev/null)" = "${args[*]}" ]; then
		echo "already configured"
		return 0
	fi
	mkdir -p $wk/build
	# A build tree copied from another label still caches that label's install directories:
	# without them CMake derives them again from the new prefix.
	old=$(sed -n 's/^CMAKE_INSTALL_PREFIX:[A-Z]*=//p' $wk/build/CMakeCache.txt 2>/dev/null || true)
	if [ -n "$old" ] && [ "$old" != "$prefix" ]; then
		sed -i "\|=$old\(/.*\)\?\$|d" $wk/build/CMakeCache.txt
	fi
	cmake -S $wk/src -B $wk/build "${args[@]}"
	if [ -n "$old" ] && [ "$old" != "$prefix" ] \
		&& grep -qE "$old(/|\"|\$)" $wk/build/build.ninja $wk/build/cmakeconfig.h; then
		die "the build tree still names $old: remove $wk/build and build again"
	fi
	printf '%s\n' "${args[*]}" >$wk/build/.bench-configure
}

build() {
	local v=$1 label=$2 from=$3 prefix=$root/install/$1-$2 dir=$here/webkit-patches/$1/$2
	local args t0 t1 t2 t3
	echo "webkit.sh build $v $label, $(nproc) CPUs, $BENCH_WEBKIT_JOBS jobs, $(date -Is)"
	export CCACHE_DIR=$root/ccache CCACHE_MAXSIZE=30G CCACHE_SLOPPINESS=time_macros WK_USE_CCACHE=NO
	cmake_args "$prefix"
	t0=$(date +%s)
	if [ ! -d $wk/src ]; then
		echo "$v-$label: new${from:+, from $v-$from}"
		seed "$v" "$from"
	elif [ ! -f $wk/built ]; then
		echo "$v-$label: resuming, the last build did not finish"
	elif [ "$(record "$dir" "$label")" = "$(cat $wk/built)" ] && [ -f "$prefix/bench-webkit.txt" ]; then
		echo "$v-$label: up to date, nothing to do ($prefix)"
		return 0
	else
		echo "$v-$label: incremental, the patches or the configuration changed"
	fi
	rm -f $wk/built
	sync_patches "$dir" "$label"
	configure "$prefix"
	t1=$(date +%s)
	ninja -C $wk/build -j "$BENCH_WEBKIT_JOBS"
	t2=$(date +%s)
	cmake --install $wk/build >$wk/install.log
	{
		echo "WebKitGTK $v, label $label, installed $(date -Is)"
		record "$dir" "$label"
	} >"$prefix/bench-webkit.txt"
	record "$dir" "$label" >$wk/built
	t3=$(date +%s)
	ccache -s | sed -n '1,4p'
	echo "source and configure $((t1 - t0)) s, build $((t2 - t1)) s, install $((t3 - t2)) s"
	echo "installed: $prefix"
}

# Bash reads a script as it runs it: everything sits in main so that editing this file during
# a build cannot change the build.
main() {
	local v label from prefix seen log
	if [ -n "${BENCH_WEBKIT_INSIDE:-}" ]; then
		set -o pipefail
		mkdir -p $root/logs
		case $1 in
		fetch)
			fetch "$2"
			;;
		build)
			log=$root/logs/$2-$3-$(date +%Y%m%d-%H%M%S).log
			echo "log: $log"
			build "$2" "$3" "${4:-}" 2>&1 | tee "$log"
			;;
		esac
		return 0
	fi

	case ${1:-} in
	image)
		"$engine" build -t "$image" -f "$here/container/webkit-build.Dockerfile" "$here/container"
		;;
	fetch)
		check_version "${2:-}"
		enter "streamline-webkit-fetch-$2" -- "$here/webkit.sh" fetch "$2"
		;;
	build)
		check_version "${2:-}"
		check_label "${3:-}"
		v=$2 label=$3 from=stock
		if [ "${4:-}" = --from ]; then
			check_label "${5:-}"
			from=$5
		elif [ -n "${4:-}" ]; then
			die "build <version> <label> [--from <label>]"
		fi
		[ "$label" != stock ] || from=
		[ "$from" != "$label" ] || die "--from names the label itself"
		mkdir -p "$cache/webkit/work/$v-$label"
		# The container's name keeps two builds of one label from running at once.
		enter "streamline-webkit-$v-$label" -v "$cache/webkit/work/$v-$label:$wk" -- \
			"$here/webkit.sh" build "$v" "$label" "$from"
		;;
	env)
		check_version "${2:-}"
		check_label "${3:-}"
		prefix=$root/install/$2-$3
		seen=$cache/webkit/install/$2-$3
		[ ! -d $root/install ] || seen=$prefix
		[ -e "$seen/lib/libwebkit2gtk-4.1.so.0" ] || echo "webkit.sh: no build at $seen yet" >&2
		# The library path is all it takes: the helper processes and the injected bundle are
		# found at the prefix compiled into the library, and they inherit this variable.
		echo "LD_LIBRARY_PATH=$prefix/lib"
		;;
	sh)
		enter "streamline-webkit-sh-$$" -it -- bash
		;;
	*)
		sed -n '2,/^set -eu/p' "$0" | sed '$d; s/^# \{0,1\}//'
		return 2
		;;
	esac
}

main "$@"
exit
