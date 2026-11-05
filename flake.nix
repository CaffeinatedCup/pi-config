{
  description = "pi coding agent config";
  outputs = { self }: {
    homeManagerModules.default =
      { config, pkgs, ... }:
      {
        programs.pi-coding-agent = {
          enable = true;
          extraPackages = [ pkgs.nodejs ];
          configDir = "${config.home.homeDirectory}/pi-config";
        };
      };
  };
}
