{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    flake-parts.url = "github:hercules-ci/flake-parts";
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    devshell = {
      url = "github:numtide/devshell";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # Only evaluated by checks.home-manager; nothing a consumer imports needs it.
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        inputs.devshell.flakeModule
        inputs.treefmt-nix.flakeModule
      ];

      # Each module defaults its package to this flake's build, so importing
      # one works without also applying the overlay.
      flake.nixosModules = {
        engine =
          { lib, pkgs, ... }:
          let
            own = inputs.self.packages.${pkgs.stdenv.hostPlatform.system};
          in
          {
            imports = [ ./nix/modules/nixos.nix ];
            services.streamline-engine.package = lib.mkDefault own.engine;
            services.streamline-player-web.package = lib.mkDefault own.web;
            programs.streamline-player.package = lib.mkDefault own.streamline-player;
          };
        default = inputs.self.nixosModules.engine;
      };

      flake.homeModules = {
        engine =
          { lib, pkgs, ... }:
          let
            own = inputs.self.packages.${pkgs.stdenv.hostPlatform.system};
          in
          {
            imports = [ ./nix/modules/home-manager.nix ];
            services.streamline-engine.package = lib.mkDefault own.engine;
            services.streamline-player-web.package = lib.mkDefault own.web;
            programs.streamline-player.package = lib.mkDefault own.streamline-player;
          };
        default = inputs.self.homeModules.engine;
      };

      # The flake's own builds, so a consumer gets the pinned toolchains rather
      # than whatever its nixpkgs carries.
      flake.overlays.default = final: _prev: {
        streamline-engine = inputs.self.packages.${final.stdenv.hostPlatform.system}.engine;
        streamline-player = inputs.self.packages.${final.stdenv.hostPlatform.system}.streamline-player;
        streamline-player-web = inputs.self.packages.${final.stdenv.hostPlatform.system}.web;
      };

      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      perSystem =
        {
          config,
          pkgs,
          lib,
          system,
          self',
          ...
        }:
        let
          rust = pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml;
          nodejs = pkgs.callPackage ./nix/tools/node.nix { };
          pnpm = pkgs.callPackage ./nix/tools/pnpm.nix { };
          biome = pkgs.callPackage ./nix/tools/biome.nix { };
          ruff = pkgs.callPackage ./nix/tools/ruff.nix { };
          nixfmt = pkgs.callPackage ./nix/tools/nixfmt.nix { };
          statix = pkgs.callPackage ./nix/tools/statix.nix { };
          deadnix = pkgs.callPackage ./nix/tools/deadnix.nix { };
          python3 = pkgs.callPackage ./nix/tools/python.nix { };
          desktop = import ./nix/packages/libs.nix { inherit pkgs lib; };
          mingwCc = pkgs.pkgsCross.mingwW64.stdenv.cc;
          mingwPthreads = pkgs.pkgsCross.mingwW64.windows.pthreads;

          android = pkgs.androidenv.composeAndroidPackages {
            # The system image is API 36; Tauri's Android template compiles against 37.
            platformVersions = [
              "36"
              "37.0"
            ];
            buildToolsVersions = [
              "36.0.0"
              "37.0.0"
            ];
            includeNDK = true;
            ndkVersions = [ "29.0.14206865" ];
            includeCmake = false;
            includeEmulator = true;
            includeSystemImages = true;
            systemImageTypes = [ "android-tv" ];
            abiVersions = [ "x86_64" ];
          };
          # The devshell's toolchain minus rust-src and the cross targets. With
          # rust-src present, rustc maps std's /rustc/<hash> panic locations
          # onto that local copy, and every binary then references the whole
          # multi-GB toolchain at runtime.
          rustBuild = rust.override {
            extensions = [ ];
            targets = [ ];
          };
          rustPlatform = pkgs.makeRustPlatform {
            cargo = rustBuild;
            rustc = rustBuild;
          };
          web = pkgs.callPackage ./nix/packages/web.nix { inherit nodejs pnpm; };
          engine = pkgs.callPackage ./nix/packages/engine.nix { inherit rustPlatform; };

          # `task lint:rust` and `task test:rust` over the whole workspace, on the
          # engine's derivation so the vendored crates are reused. src-tauri is a
          # member, so the desktop libraries come too, and tauri's
          # generate_context! needs the frontend dir to exist.
          workspaceCheck =
            name: command:
            engine.overrideAttrs (old: {
              pname = "streamline-workspace-${name}";
              src = (pkgs.callPackage ./nix/packages/source.nix { }).app;
              nativeBuildInputs = old.nativeBuildInputs ++ [
                # The sandbox has no CA bundle, and the app's HTTP client refuses to start without one.
                pkgs.cacert
                pkgs.pkg-config
                pkgs.ffmpeg-full
                pkgs.dovi-tool
              ];
              buildInputs = desktop.libs ++ desktop.gstPlugins;
              buildPhase = ''
                runHook preBuild
                mkdir -p build
                ${command}
                runHook postBuild
              '';
              doCheck = false;
              installPhase = "touch $out";
              dontFixup = true;
            });
          androidSdk = android.androidsdk;
          androidHome = "${androidSdk}/libexec/android-sdk";
        in
        {
          _module.args.pkgs = import inputs.nixpkgs {
            inherit system;
            overlays = [ (import inputs.rust-overlay) ];
            config = {
              android_sdk.accept_license = true;
              allowUnfree = true;
            };
          };

          # numtide's shell is a bare `derivation` that only symlinks its
          # profile, without preferLocalBuild. A machine with remote builders
          # would ship the whole closure (the Android SDK included) to one just
          # to make that link.
          devShells = lib.mapAttrs (
            _: shell:
            lib.mkForce (
              derivation (
                shell.devshell.shell.drvAttrs
                // {
                  preferLocalBuild = true;
                  allowSubstitutes = false;
                }
              )
            )
          ) config.devshells;

          packages = {
            inherit engine web;
            streamline-player = pkgs.callPackage ./nix/packages/app.nix {
              inherit
                rustPlatform
                nodejs
                pnpm
                desktop
                web
                ;
            };
            default = self'.packages.streamline-player;
          };

          # `nix fmt`, `treefmt` in the devshell and checks.treefmt, each formatter at its pinned
          # version.
          treefmt = {
            projectRootFile = "flake.nix";
            programs.nixfmt = {
              enable = true;
              package = nixfmt;
            };
            programs.rustfmt = {
              enable = true;
              package = rust;
            };
            programs.ruff-format = {
              enable = true;
              package = ruff;
            };
            # Not programs.biome: it hands biome a config generated from its own settings, in
            # place of biome.json. biome.json's files.includes decides what is formatted.
            settings.formatter.biome = {
              command = lib.getExe biome;
              options = [
                "format"
                "--write"
                "--no-errors-on-unmatched"
                "--vcs-enabled=false"
              ];
              includes = [
                "*.ts"
                "*.js"
                "*.mjs"
                "*.svelte"
                "*.json"
                "*.css"
              ];
            };
          };

          checks = {
            build-engine = self'.packages.engine;
            build-web = self'.packages.web;
            build-streamline-player = self'.packages.streamline-player;

            # The launcher must carry what the devshell computes by hand: without
            # these the webview finds no codecs and no TLS.
            app-wrapped = pkgs.runCommandLocal "check-app-wrapped" { } ''
              launcher=${lib.getExe self'.packages.streamline-player}
              grep -q 'GST_PLUGIN_SYSTEM_PATH_1_0.*gst-libav' "$launcher" || { echo "launcher has no gst-libav on GST_PLUGIN_SYSTEM_PATH_1_0"; exit 1; }
              grep -q 'GIO_EXTRA_MODULES.*glib-networking' "$launcher" || { echo "launcher sets no glib-networking GIO_EXTRA_MODULES"; exit 1; }
              touch $out
            '';

            nixos = pkgs.testers.runNixOSTest {
              imports = [ ./nix/checks/nixos.nix ];
              node.specialArgs.engineModule = inputs.self.nixosModules.engine;
            };

            # The home-manager module shares options.nix and common.nix with
            # the NixOS one; building its activation catches a unit that no
            # longer evaluates.
            home-manager =
              (inputs.home-manager.lib.homeManagerConfiguration {
                inherit pkgs;
                modules = [
                  inputs.self.homeModules.engine
                  {
                    home = {
                      username = "viewer";
                      homeDirectory = "/home/viewer";
                      stateVersion = "26.05";
                    };
                    services.streamline-engine = {
                      enable = true;
                      secretFile = "/home/viewer/.config/streamline-engine/secret";
                    };
                    services.streamline-player-web.enable = true;
                    programs.streamline-player.enable = true;
                  }
                ];
              }).activationPackage;

            # Runtime closures must not carry the build toolchain: a rustc with
            # rust-src maps std's panic locations onto its own store path.
            closures-without-toolchain =
              pkgs.runCommandLocal "check-closures-without-toolchain"
                {
                  closure = pkgs.closureInfo {
                    rootPaths = [
                      self'.packages.engine
                      self'.packages.streamline-player
                    ];
                  };
                }
                ''
                  if grep -E -- '-rust-(default|std|src)-' "$closure/store-paths"; then
                    echo "a package's runtime closure holds the Rust toolchain"
                    exit 1
                  fi
                  touch $out
                '';

            engine-tools = pkgs.runCommandLocal "check-engine-tools" { } ''
              for tool in ffmpeg ffprobe dovi_tool; do
                test -x ${engine.tools}/bin/$tool || { echo "engine tools lack $tool"; exit 1; }
              done
              # nixpkgs' default ffmpeg builds with neither, and the engine then tonemaps on
              # the CPU and its intro job fails.
              ffmpeg=${engine.tools}/bin/ffmpeg
              # Into variables first: `grep -q` leaves at its first match, and under pipefail an
              # ffmpeg still writing to the closed pipe fails the whole test.
              filters=$($ffmpeg -hide_banner -filters)
              muxers=$($ffmpeg -hide_banner -muxers)
              grep -qw libplacebo <<< "$filters" || { echo "ffmpeg has no libplacebo filter"; exit 1; }
              grep -qw chromaprint <<< "$muxers" || { echo "ffmpeg has no chromaprint muxer"; exit 1; }
              touch $out
            '';

            biome-lint = pkgs.runCommandLocal "check-biome-lint" { nativeBuildInputs = [ biome ]; } ''
              cd ${./.}
              biome lint --vcs-enabled=false --error-on-warnings .
              touch $out
            '';

            nix-lint =
              pkgs.runCommandLocal "check-nix-lint"
                {
                  nativeBuildInputs = [
                    statix
                    deadnix
                  ];
                }
                ''
                  cd ${./.}
                  statix check .
                  deadnix --fail .
                  touch $out
                '';

            ruff-lint = pkgs.runCommandLocal "check-ruff-lint" { nativeBuildInputs = [ ruff ]; } ''
              cd ${./.}
              ruff check --no-cache dev
              touch $out
            '';

            clippy = workspaceCheck "clippy" "cargo clippy --workspace --all-targets -- -D warnings";
            cargo-test = workspaceCheck "test" "cargo test --workspace";

            # Enters the shell from an empty environment: a terminal that never
            # loaded direnv is where missing search paths show up.
            devshell-env = pkgs.runCommandLocal "check-devshell-env" { } ''
              env -i HOME=$TMPDIR PATH=${pkgs.coreutils}/bin ${self'.devShells.default}/entrypoint \
                ${pkgs.bash}/bin/bash ${./nix/checks/devshell-env.sh}
              touch $out
            '';
          };

          devshells = {
            default = {
              packages = with pkgs; [
                rust
                cargo-tauri
                nodejs
                pnpm
                stdenv.cc
                pkg-config
                go-task
                biome
                ruff
                nixfmt
                statix
                deadnix
                config.treefmt.build.wrapper
                typescript-language-server
                playwright-mcp
                jq
                git-cliff
                python3
                ffmpeg-full
                dovi-tool
                mingwCc
              ];
              env = desktop.env ++ [
                {
                  name = "PLAYWRIGHT_BROWSERS_PATH";
                  value = pkgs.playwright-driver.browsers;
                }
                {
                  name = "PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS";
                  value = true;
                }
                {
                  name = "CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER";
                  value = "${mingwCc}/bin/x86_64-w64-mingw32-cc";
                }
                {
                  # Rust's windows-gnu std links libpthread.a, which the bare
                  # mingw compiler does not ship.
                  name = "CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS";
                  value = "-L native=${mingwPthreads}/lib";
                }
                # cc-rs takes the global CC above over its own target lookup, so
                # C dependencies (aws-lc-sys) would build for Linux; the
                # per-target names win over CC.
                {
                  name = "CC_x86_64_pc_windows_gnu";
                  value = "${mingwCc}/bin/x86_64-w64-mingw32-cc";
                }
                {
                  name = "CXX_x86_64_pc_windows_gnu";
                  value = "${mingwCc}/bin/x86_64-w64-mingw32-c++";
                }
                {
                  name = "AR_x86_64_pc_windows_gnu";
                  value = "${mingwCc}/bin/x86_64-w64-mingw32-ar";
                }
                {
                  name = "CFLAGS_x86_64_pc_windows_gnu";
                  value = "-I${mingwPthreads}/include";
                }
              ];
            };

          }
          # Separate from the default shell so direnv does not pull the multi-GB SDK
          # for desktop work. androidenv only builds the SDK for x86_64-linux.
          // lib.optionalAttrs (system == "x86_64-linux") {
            android = {
              packages = with pkgs; [
                rust
                cargo-tauri
                nodejs
                pnpm
                jdk17
                androidSdk
                jq
                go-task
              ];
              env = [
                {
                  name = "ANDROID_HOME";
                  value = androidHome;
                }
                {
                  name = "ANDROID_SDK_ROOT";
                  value = androidHome;
                }
                {
                  name = "NDK_HOME";
                  value = "${androidHome}/ndk/29.0.14206865";
                }
                {
                  name = "JAVA_HOME";
                  value = pkgs.jdk17.home;
                }
                {
                  # The streamline-tv AVD lives outside ~/.android.
                  name = "ANDROID_AVD_HOME";
                  eval = "$HOME/.config/.android/avd";
                }
                {
                  # AGP fetches aapt2 from Maven as a generic-linux binary; point it at the
                  # patched one from the SDK so the build does not depend on nix-ld.
                  name = "GRADLE_OPTS";
                  value = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${androidHome}/build-tools/36.0.0/aapt2";
                }
              ];
            };
          };
        };
    };
}
