{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { nixpkgs, fenix, ... }:
    let
      system = "x86_64-linux";
      pkgs   = nixpkgs.legacyPackages.${system}.extend fenix.overlays.default;
      # builtins.path dereferences the symlink ~/dev-shells -> /mnt/host/dev-shells
      dev-shells-src = builtins.path {
        name = "dev-shells";
        path = /home/dev/dev-shells;
      };
    in {
      devShells.${system}.default = pkgs.mkShell {
        # Pick the language shells this project needs:
        inputsFrom = [
          (import "${dev-shells-src}/shells/rust-stable.nix"   { inherit pkgs; })
          (import "${dev-shells-src}/shells/python.nix" { inherit pkgs; })
          # (import "${dev-shells-src}/shells/sage.nix"   { inherit pkgs; })
          # (import "${dev-shells-src}/shells/node.nix"   { inherit pkgs; })
        ];

        # Project-specific tools not covered by the shared shells:
        packages = with pkgs; [
          # git  (already in base image, listed here for explicitness if needed)
        ];
      };
    };
}
