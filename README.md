# 5e.tools

Visit the [main site](https://5e.tools/index.html) or go to the unofficial GitHub [mirror](index.html).

[Join the 5etools Discord here!](https://discord.gg/5etools)

## Help and Support

Please see [our wiki](https://wiki.tercept.net/) for FAQs, installation guides, supported integrations, and more.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

This project is licensed under the terms of the MIT license.

## Personal Campaign Hub login

For username/password login without GitHub OAuth, follow
[the local login guide](docs/hub/local-login.md). Create users with
`npm run hub:user -- --username dennis`, then start the Hub with both
`compose.hub.yml` and `compose.hub.local.yml`.

To expose the full Hub through Cloudflare Tunnel, add `compose.hub.tunnel.yml` last
and follow [the tunnel guide](docs/hub/cloudflare-tunnel.md) for the hostname,
connector token and Cloudflare route (`http://edge:8080`).

For a single-file Portainer deployment, use `compose.hub.portainer.yml` and
[the Portainer setup guide](docs/hub/portainer.md). It contains the complete personal
Hub and tunnel stack, using prepared app images and absolute Docker-host file paths.
