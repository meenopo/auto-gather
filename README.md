# Auto-gather (legacy)

By: Cattalol

This is somewhat old (and currently outdated) Tera-Proxy / Tera-Toolbox **_QoL_** module for aiding the user in gathering those peksy, pesky, resource nodes.

You (as the user of this content) are solely responsible for your own actions and any consequences that result from your actions.

_No support / updates will be provided for this module (the code is provided "as-is")._ The code is (for the most part) fairly straightforward.

## Proxy compatibility:
- Last tested on Patch 87(?) on [Tera Toolbox](https://github.com/tera-toolbox/tera-toolbox) back in late 2019.
- Currently on Patch 93, none of the packets used in this module are validated by the server's [integrity check](https://github.com/tera-proxy/tera-proxy/tree/master/node_modules/tera-data/integrity)
    - However, since Caali/Salty has locked down the usage of non-whitelisted opcodes, you'll likely have to use [Tera-Proxy](https://github.com/tera-proxy) instead.
- You will need to update any changed packet protocols and their associated hooks to current patch.

## Usage:
- The module builds up its own local cache of resource locations, **_which are logged whenever you make visual contact_**.
  - This means you must fly around the area at least once (or twice) to build your initial list of nodes
  - This also means that the module will auto-log and auto-save newly spotted resource nodes as it moves you around the area.
  - The resources.json file uploaded contains a variety of node locations, but I have no idea if BHS has changed node spawn locations since Patch 87.
- Edit names.json to if you want the module to print recognizable names for the resources / zones.
  - This is **_not mandatory_**... the logs will just print "Currently 10 units of (Unknown ID) in inventory" rather than "Currently 10 units of Plain Stone in inventory"

## Commands (in the toolbox/proxy channel):
### autogather
- Enables / disables autogathering behaviour.
### autogather setid [number]
- Sets the currently resource ID to gather.

You can look up [the rest of the commands](https://github.com/CattaLol/auto-gather/blob/3b7ec927042d09c0f0c7809adf61ffca0f8188aa/index.js#L58) yourself.
