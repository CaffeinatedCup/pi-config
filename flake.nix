{
  description = "pi coding agent config";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forSystems (pkgs: {
        default = pkgs.pi-coding-agent;
        pi = pkgs.pi-coding-agent;
      });

      apps = forSystems (pkgs: {
        default = {
          type = "app";
          program = "${pkgs.pi-coding-agent}/bin/pi";
        };
        pi = {
          type = "app";
          program = "${pkgs.pi-coding-agent}/bin/pi";
        };
      });

      homeManagerModules.default =
        { config, pkgs, ... }:
        {
          nixpkgs.overlays = [
            (final: prev: {
              pi-coding-agent = nixpkgs.legacyPackages.${prev.system}.pi-coding-agent;
            })
          ];
          programs.pi-coding-agent = {
            enable = true;
            # Set explicitly: nixpkgs.overlays inside a home-manager module is
            # ignored when the host sets home-manager.useGlobalPkgs = true.
            package = nixpkgs.legacyPackages.${pkgs.system}.pi-coding-agent;
            extraPackages = [ pkgs.nodejs ];
            configDir = "${config.home.homeDirectory}/pi-config";
          };
        };
    };
}
