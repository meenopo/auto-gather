const fs = require('fs');
const path = require('path');
const os = require('os');

const configJsonPath = path.resolve(__dirname,'config.json');
const namesJsonPath = path.resolve(__dirname, "names.json");
const dataJsonPath = path.resolve(__dirname, "resources.json");
const LOCATION_CHECK_TOLERANCE = 50;
const LOCATION_Z_OFFSET = 5;

const LOG_CONSOLE_ONLY = 0;
const LOG_COMMAND_ONLY = 1;
const LOG_ALL = 2;

/*
* @author: Cattalol
* @brief: A tera-proxy/tera-toolbox quality of life module to aid the player
*/
module.exports = function autogather(dispatch) {
	const command = dispatch.command || dispatch.require.command;
	
	const config = loadJson(configJsonPath);
	const namesJson = loadJson(namesJsonPath);
	let dataJson = loadJson(dataJsonPath);	
	
	if (config == undefined){
		logMessage(`[autogather] Failed to parse config.json, abort loading.`, LOG_CONSOLE_ONLY);
		return;
	}
	if (dataJson == undefined){
		logMessage(`[autogather] Failed to parse dataJson.json; initializing with empty node list.`, LOG_CONSOLE_ONLY);
		dataJson = {}
	}
		
	let seekPos = 0; // counter to track our cached node list.
	let currentZone;
	let currentZoneStr;
	let playerId;
	let gameId;
	
	let enabled = false;
	let damagedWhileEnabled = false;
	let currentGatherableId = -1; 
	let currentGatherableItemId = -1;
	let gatherableInInventory = 0;
	let currentGatherables = new Map();
	let currentChannel;
	let channelOnDeath;
	let justDied = false;
	let resumeOnTopoLoad = false;
	
	let playerTime = 0;
    let playerLocation = {x: 0, y: 0, z: 0};
	
	let damageDelayTimeout;
	let npcs = new Map();
	
	command.add('autogather', (arg1, arg2, arg3) => {
		if (arg1 != undefined){
			arg1 = arg1.toLowerCase();
		}
		let message;
		switch(arg1){
			case 'tp':
				if (isNumber(arg2) && validateAreaAndResource()){
					if (!(currentGatherableId in dataJson[currentZoneStr])){
						logMessage(`No spawn locations available for ${getResourceName(currentGatherableId)} in ${getZoneName(currentZoneStr)}`)
					}
					let index = Number(arg2);
					if (index < 0 || index > (dataJson[currentZoneStr][currentGatherableId].length - 1)){
						logMessage(`Invalid index specified.`)
						return;
					}
					logMessage(`Teleporting to index ${index}`)
					teleport(dataJson[currentZoneStr][currentGatherableId][index].location);
				}
				break;
			case 'safe':
				if (isNumber(arg2) && validateAreaAndResource()){
					let index = Math.min(Math.max(0, Number(arg2)), dataJson[currentZoneStr][currentGatherableId].length - 1);		
					dataJson[currentZoneStr][currentGatherableId][index].safe = true;
					saveJson(dataJson, dataJsonPath);
					logMessage(`Index ${index} of ${getResourceName(currentGatherableId)} has been set as safe`);
				}
				break;
			// mark the current (in the list) location as 'unsafe'.
			case 'unsafe':
				if (isNumber(arg2) && validateAreaAndResource()){
					let index = Math.min(Math.max(0, Number(arg2)), dataJson[currentZoneStr][currentGatherableId].length - 1);					
					dataJson[currentZoneStr][currentGatherableId][index].safe = false;
					saveJson(dataJson, dataJsonPath);
					logMessage(`Index ${index} of ${getResourceName(currentGatherableId)} has been set as unsafe`);
				}
				break;
			// resets the 'unsafe' status of all node locations in this area.
			case 'unsafereset':
				if (validateAreaAndResource()){
					for (let index = 0; index < dataJson[currentZoneStr][currentGatherableId].length; index++){
						dataJson[currentZoneStr][currentGatherableId][index].safe = true;			
					}
					sortLocations();
					saveJson(dataJson, dataJsonPath);
					logMessage(`Safety status of all ${getResourceName(currentGatherableId)} in ${getZoneName(currentZoneStr)} has been reset.`)
				}
				else{
					logMessage(`Nothing to reset.`)					
				}
				break;
			// removes the specified cached node in the list of locations of the currently selected resource.
			case 'delete':
				if (isNumber(arg2) && validateAreaAndResource()){
					let index = Number(arg2);
					if (index < 0 || index > (dataJson[currentZoneStr][currentGatherableId].length - 1)){
						logMessage(`Invalid index specified.`)
						return;
					}
					dataJson[currentZoneStr][currentGatherableId].splice(index, 1);
					saveJson(dataJson, dataJsonPath);
					if (index <= seekPos){
						seekPos--; // preserve the actual position.
					}
					seekPos = Math.max(0, seekPos);					
					logMessage(`Index ${index} of ${getResourceName(currentGatherableId)} has been removed.`)					
				}
				break;
			// sorts all locations.
			case 'sort':
				sortLocations();
				saveJson(dataJson, dataJsonPath);
				break;
			// resets the reference counter to 0.
			case 'reset':
				logMessage(`Reset seek position.`)
				seekPos = 0;
				break;
			// sets the reference counter to the specified index
			case 'seek':
				if (isNumber(arg2) && validateAreaAndResource()){
					seekPos = Number(arg2);
					logMessage(`Seek position set to ${seekPos}`)
				}
				else{
					logMessage(`Argument 2 must be a number. ${arg2} is not a number.`);
				}
				break;
			// sets the currently selected resource
			case 'setid':
				if (isNumber(arg2)){
					currentGatherableId = Number(arg2);
					currentGatherableItemId = getResourceItemId(arg2);
					logMessage(`Set to gather ${getResourceName(arg2)}`)
				}
				else{
					logMessage(`Argument 2 must be a number. ${arg2} is not a number.`);
				}
				break;
			// manually save the cached node list.
			case 'save':			
				saveJson(dataJson, dataJsonPath);
				break;
			// reloads the node list from file.
			case 'reload':
				dataJson = loadJson(dataJsonPath);
				break;
			case 'print':
				let ZoneOfInterest = arg2 in dataJson ? arg2 : currentZoneStr;
				let numNodeTypes = Object.keys(dataJson[ZoneOfInterest]).length
				if (numNodeTypes == 0){
					logMessage(`No data logged in ${getZoneName(ZoneOfInterest)}. Gather some data and come back later!`)
					return;
				}
				message = `${numNodeTypes} resource types recorded in ${getZoneName(ZoneOfInterest)}:\n\t`
				for (const nodeType of Object.keys(dataJson[ZoneOfInterest])){
					message += `${getResourceName(nodeType)}: ${dataJson[ZoneOfInterest][nodeType].length} locations.\n\t`
				}
				logMessage(message);
				break;
			case 'printunsafe':
				if (currentZoneStr in dataJson){
					message = `Unsafe spawn indices in ${getZoneName(currentZoneStr)}:\n\t`
					for (const nodeType of Object.keys(dataJson[currentZoneStr])){
						let unsafes = ``;
						let numUnsafe = 0;
						for (let index = 0; index < dataJson[currentZoneStr][nodeType].length; index++){
							if (!dataJson[currentZoneStr][nodeType][index].safe){
								if (numUnsafe > 0){
									unsafes += `,`
								}
								unsafes += ` ${index}`;
								numUnsafe++;
							}
						}					
						message += `${getResourceName(nodeType)}: ${numUnsafe} of ${dataJson[currentZoneStr][nodeType].length} are unsafe: ${unsafes} \n\t`;
					}
					logMessage(message);
				}
				break;
			default:
				enabled = !enabled;
				if (validateAreaAndResource()){
					if (enabled){
						damagedWhileEnabled = false;
						logMessage(`Begin auto-gathering id ${getResourceName(currentGatherableId)} in ${currentZone}`)
						if(!(currentGatherableId in dataJson[currentZoneStr])){
							logMessage(`No spawn locations of ${getResourceName(currentGatherableId)} were recorded in zone ${currentZone} thus far. Aborting.`)
							enabled = false;
							return;
						}					
						checkNodeLocation();
					}
					else{
						logMessage(`Stopping auto-gather.`)
					}
				}
				else{
					enabled = false;
				}
				break;
		}
	});
	
	
	dispatch.hook(`S_LOGIN`, 14, (event) => { processLogin(event) });
	dispatch.hook(`S_SPAWN_COLLECTION`, 4, (event) => {	processNodeSpawn(event) });
	dispatch.hook(`S_DESPAWN_COLLECTION`, 2, (event) => { processNodeDespawn(event) });
	dispatch.hook(`S_LOAD_TOPO`, 3, (event) => { processTopoLoad(event) });
	dispatch.hook(`S_SPAWN_ME`, 3, (event) => { processSpawnMe(event) });
	dispatch.hook(`S_CURRENT_CHANNEL`, 2, (event) => { processCurrentChannelUpdate(event) });
	dispatch.hook(`S_CREATURE_CHANGE_HP`, 6, (event) => { processHealthChange(event) });	
	dispatch.hook(`S_COLLECTION_PICKEND`, 2, (event) => { processFinishGathering(event) });
	dispatch.hook(`S_ITEMLIST`, dispatch.majorPatchVersion < 87 ? 2 : 3, (event) => { processInventory(event) });
	dispatch.hook(`S_SPAWN_NPC`, 11, (event) => { processNPCSpawn(event) });
	dispatch.hook(`S_NPC_LOCATION`, 3, (event) => { processNPCLocation(event) });
	dispatch.hook(`S_DESPAWN_NPC`, 3, (event) => { processNPCDespawn(event) });
	
	dispatch.hook(`C_PLAYER_LOCATION`, 5, (event) => { processClientPlayerLocation(event) });
	
	function processNPCSpawn(event){
        npcs.set(event.gameId, {
			gameId: event.gameId,
            templateId : event.templateId,
            relation : event.relation,
            huntingZoneId : event.huntingZoneId,
            loc: event.loc,
            name: event.name
        });
    }
	
	function processNPCLocation(event) {
		let npc = npcs.get(event.gameId);		
		if (npc){
			npcs.set(npc.gameId, {
				gameId: npc.gameId,
				templateId : npc.templateId,
				relation : npc.relation,
				huntingZoneId : npc.huntingZoneId,
				loc: event.dest,
				name: npc.name
			});
		}
	}
	
	function processNPCDespawn(event) {
		npcs.delete(event.gameId);
	}
	
	// Handles incoming inventory data. Reminder that (current BHS implementation) sends multiple S_ITEMLIST packets in succession whenever anything changes.
	function processInventory(event){
		// pocket inventory handling not supported atm.
		if (event.pocket != 0){
			return;
		}
		// Don't remember wtf this is
		if (event.container == 14){
			return;
		}		
		if (event.first){
			gatherableInInventory = 0;
		}
	    for (const item of event.items) {
			if (item.id == currentGatherableItemId){
				gatherableInInventory += item.amount;
			}
		}
	}
	
	// On login, update game & player IDs.
	function processLogin(event){
		playerId = event.playerId
		gameId = event.gameId
	}	
	
	// Cache nodes.
	function processNodeSpawn(event){
		processNode(event.id.toString(), event.loc)
        if (!event.extractor && event.id == currentGatherableId){
			currentGatherables.set(Number(event.gameId), {
				loc: event.loc
			})
		}
    }
	
	// Clear node from cache.
	function processNodeDespawn(event){
		currentGatherables.delete(Number(event.gameId));
	}
	
	// On map load, flush cached nodes and commit current location set to file.
	function processTopoLoad(event){
		currentGatherables.clear();
		currentZone = event.zone;
		if (event.zone != currentZone){
			seekPos = 0;		
			sortLocations();
			saveJson(dataJson, dataJsonPath);
		}		
		currentZoneStr = currentZone.toString();	
		if (!(currentZoneStr in dataJson)){
			dataJson[currentZoneStr] = {}
		}
	}
	
	function processSpawnMe(event){
		// restart gathering on load?
		if (resumeOnTopoLoad){
			// if we jsut died, go back to the last channel as appropriate.
			if(justDied){
				justDied = false;
				if (currentChannel != channelOnDeath){
					logMessage(`Revived! Changing back to channel ${channelOnDeath}`)			
					changeChannel(channelOnDeath);
					enabled = true;
				}
				else{
					enabled = true;
					logMessage(`Revived! Resuming gathering in ${config.seekDelay} seconds!`)
					setTimeout(checkNodeLocation, config.seekDelay);
				}
			}
			// good to go? leggo!
			else{
				resumeOnTopoLoad = false;
				setTimeout(checkNodeLocation, config.seekDelay);
			}
		}
	}
	
	function processCurrentChannelUpdate(event){
		currentChannel = event.channel;
	}
	
	// detect if we're taking damage. if we are, stop gathering. 
	// NOTE: prone to bugs and other weird behaviours (e.g. some random ranged mob attacks you while you've moved halfway across the map... but the projectile still
	// follows your fat ass wherever you are.
	function processHealthChange(event){
		if (event.target == gameId && event.diff < 0){
			logMessage('Taking damage!');
			if (enabled){				
				let npc = npcs.get(event.source);
				if (npc != undefined && distanceBetweenLocation(npc.loc, playerLocation) < 600){
					logMessage(`Took damage from mob!! Node index ${seekPos} marked as unsafe.`)
					dataJson[currentZoneStr][currentGatherableId][seekPos].safe = false;				
					saveJson(dataJson, dataJsonPath);					
					clearTimeout(damageDelayTimeout);
					enabled = false;					
					if (event.curHp == 0){
						logMessage(`Dead! Reviving in a bit.. `)
						resumeOnTopoLoad = true;
						justDied = true;
						setTimeout(reviveMe, config.reviveDelay);
					}
					else{
						damageDelayTimeout = setTimeout(attemptToResumeGathering, config.resumeDelay);
						damagedWhileEnabled = true;
					}
				}
				else{
					logMessage(`Took damage while gathering, from unknown / faraway source? Resuming in a bit.`)
					clearTimeout(damageDelayTimeout);
					damageDelayTimeout = setTimeout(attemptToResumeGathering, config.resumeDelay);
				}
			}
			else if (damagedWhileEnabled && event.curHp == 0){
				clearTimeout(damageDelayTimeout);
				logMessage(`You have died! Respawning in ${config.reviveDelay/1000} seconds!`);
				resumeOnTopoLoad = true;
				justDied = true;
				setTimeout(reviveMe, config.reviveDelay);
			}
			else{
				clearTimeout(damageDelayTimeout);
				damageDelayTimeout = setTimeout(attemptToResumeGathering, config.resumeDelay);
				logMessage(`Taking damage!`);
			}
		}
	}
	
	function processClientPlayerLocation(event) {
		if (!enabled){
			return;
		}
		
		let correctedTime = false;
		if (playerTime > event.time) {
			event.time = (playerTime + 75);
			correctedTime = true;
		}
		Object.assign(playerLocation, event.dest);		
		if (correctedTime){
			return true;
		}
	}
	
	function attemptToResumeGathering() {
		enabled = true;
		damagedWhileEnabled = false;
		logMessage(`Attempting to resume gathering (no dmg taken in the past bit)`);	
		checkNodeLocation(750);
	}
	
	function processFinishGathering(event){
		if (event.user == gameId && enabled){
			if (event.type == 0){
				logMessage(`Gathering interrupted!!`)
				enabled = false;
				return;
			}
			else{
				logMessage(`Unknown gathering interruption code ${event.type}`);
			}
			
			logMessage(`Node harvested! Moving to next position!`)
			if (event.fatigability < 20){
				logMessage(`Out of PP now!!`)
				enabled = false;
				return;
			}
			prepareToCheck(100);			
		}
	}
	
	// Check if location is already saved to file.
	function processNode(nodeType, nodeLoc){
		// if no entry exists (for this zone), create one.
		if (!(nodeType in dataJson[currentZoneStr])){
			dataJson[currentZoneStr][nodeType] = []
			
			let nodeData = {}
			nodeData["location"] = nodeLoc;
			nodeData["safe"] = true // for auto-gather.js' benefit for tracking which nodes are in aggro range of monsters.	
			dataJson[currentZoneStr][nodeType].push(nodeData);
		}
		else if (!locationInArray(nodeLoc, dataJson[currentZoneStr][nodeType])){
			let nodeData = {}
			nodeData["location"] = nodeLoc;
			nodeData["safe"] = true // for auto-gather.js' benefit for tracking which nodes are in aggro range of monsters.			
			dataJson[currentZoneStr][nodeType].push(nodeData);
		}
	}
	
	// Self explanatory...
	function reviveMe() {		
		channelOnDeath = currentChannel;
		logMessage(`Died in channel ${channelOnDeath} while gathering...`)
		dispatch.toServer(`C_REVIVE_NOW`, 2, {
			type: 0,
			id: 4294967295
		})
	}
	
	// Check if the location is already in the array.
	function locationInArray(loc, locArray){
		for (const existingLoc of locArray){
			if (locationsEqual(loc, existingLoc.location, true)){
				return true;
			}
		}
		return false;
	}
	
	/*
	When enabled, the code logic is executed in the chronological order:
		- check node location (ensure we have somewhere to teleport to, that the position is safe, and whether we need to switch channels because we've gone through the entire list)
		- move to node location (ditto).
		- wait until any falling movement is complete (borked spawn co-ordinates).
		- scan the location for the desired gatherable.
		- harvest the node if extant.
		- prepare to check the next node location.
	*/
	
	function checkNodeLocation(){
		if (!enabled){
			logMessage(`Disabled! Aborting!`)
			return;
		}
		logMessage(`Currently ${gatherableInInventory} of ${getResourceName(currentGatherableId)} in inventory`);
		if (!(currentGatherableId in dataJson[currentZoneStr]) || dataJson[currentZoneStr][currentGatherableId].length == 0){
			enabled = false;
			logMessage(`No nodes found for the type ${currentGatherableId} in zone ${currentZoneStr}`)
		}
		
		if (seekPos >= dataJson[currentZoneStr][currentGatherableId].length){
			logMessage(`All nodes in this channel checked!`)
			seekPos = 0;
			changeChannel(currentChannel + 1);
		}
		else{
			if (!dataJson[currentZoneStr][currentGatherableId][seekPos].safe){
				logMessage(`Position ${seekPos} of ${dataJson[currentZoneStr][currentGatherableId].length - 1} is unsafe. Skipping.`)
				seekPos++;
				checkNodeLocation();				
			}
			else{
				moveToNodeLocation();
			}
		}
	}
	
	function changeChannel(targetChannel){
		if (targetChannel == undefined){
			logMessage(`Invalid target channel! Aborting!`)
			return;
		}
		
		setTimeout(() => {
			dispatch.toServer('C_LIST_CHANNEL', 1 , {
				unk1: 1,
				zone: currentZone
			});
			dispatch.hookOnce('S_LIST_CHANNEL', 1, (event) => {
				if (targetChannel > event.channels.length){
					targetChannel = 1;
				}
				logMessage(`Prepare to change to channel ${targetChannel} of ${event.channels.length}`);
				resumeOnTopoLoad = true;
				
				setTimeout(() => {
					dispatch.toServer('C_SELECT_CHANNEL', 1, {
						unk: 1,
						zone: currentZone,
						channel: (targetChannel - 1) // :shrug: don't ask why :zzz:
					});
				}, 1000);
			});
		}, 1000);
	}
	
	function moveToNodeLocation(){
		logMessage(`Teleport to node position ${seekPos} of ${dataJson[currentZoneStr][currentGatherableId].length - 1}.`)
		teleport(dataJson[currentZoneStr][currentGatherableId][seekPos].location, 25);
		setTimeout(teleport, 500, dataJson[currentZoneStr][currentGatherableId][seekPos].location, 5);
		setTimeout(scanForNode, 1000);
	}
	
	function scanForNode(){
		let desiredNodeId;
		for (let [nodeId, node] of currentGatherables.entries()){
			if (!node){
				continue;
			}
			if (locationsEqual(node.loc, dataJson[currentZoneStr][currentGatherableId][seekPos].location)){				
				desiredNodeId = nodeId;
				break;
			}
		}
		
		if (desiredNodeId){
			logMessage(`${getResourceName(currentGatherableId)} found at position ${seekPos}! Begin gathering!`);		
			setTimeout(harvestNode, 250, desiredNodeId);
		}
		else{
			logMessage(`No node found at position ${seekPos}. Move to next position in ${config.seekDelay/1000} seconds!`)
			prepareToCheck(config.seekDelay);
		}
	}
	
	function prepareToCheck(delay){
		if (!enabled) {
			logMessage(`Prepare to check aborted`);
			return;
		}
		seekPos++;
		setTimeout(checkNodeLocation, delay);		
	}
	
	function harvestNode(nodeId){
		dispatch.toServer(`C_COLLECTION_PICKSTART`, 2, {
			gameId : nodeId
		});	
	}
	
	function teleport(newLoc, randomXY = 0) {
		if (!locationValid(newLoc)){
			return false;
		}
		let currTime = getSystemUpTime()
		// Our method of calculating the system uptime (that the game uses) is approximate at best - ensure we do not send a packet with a timestamp earlier than the last packet (aka time travel into the past) - instant S_EXIT code 16 if we do :MonkaWorry:
		if (currTime < playerTime) {
			currTime = playerTime + 50;
		}
		
		playerTime = currTime;		
		let direction = getDirection(newLoc, playerLocation);

		let modLoc = {};
		Object.assign(modLoc, newLoc);
		if (randomXY > 0){
			modLoc.x = getRandom(modLoc.x, randomXY);
			modLoc.y = getRandom(modLoc.y, randomXY);
			modLoc.z = modLoc.z + LOCATION_Z_OFFSET; // :thenk:
		}		
		Object.assign(playerLocation, modLoc);
		dispatch.toServer('C_PLAYER_LOCATION', 5, {
			loc: modLoc,
			w: direction,
			lookdirection: direction,
			dest: modLoc,
			type: 7,
			jumpDistance: 0,
			inShuttle: false,
			time: playerTime
		});
	}
	
	function getSystemUpTime() {
		// Clientless
		//return Date.now() - timeOffset;
		// In-client.
		return os.uptime() * 1000 + new Date().getMilliseconds() + 150;
	}
	
	function getDirection(newLoc, oldLoc){
		return Math.atan2((newLoc.y - oldLoc.y), (newLoc.x - oldLoc.x));
	}
	
	function locationValid(loc){
		if (loc.x == undefined || loc.y == undefined || loc.z == undefined){
			logMessage(`Invalid location!`)
			return false;
		}
		return true;
	}
	
	function locationsEqual(locA, locB, compareZ = false) {
		if (!locA || !locB){
			logMessage(`Attempted to compare invalid location!`)
			return false;
		}
		if (Math.abs(locA.x - locB.x) > LOCATION_CHECK_TOLERANCE || Math.abs(locA.y - locB.y) > LOCATION_CHECK_TOLERANCE){
			return false;
		}
		if (compareZ && Math.abs(locA.z - locB.z) > LOCATION_CHECK_TOLERANCE){
			return false
		}
		return true;
	}
	
	function sortLocations(){
		if (Object.keys(dataJson[currentZoneStr]).length == 0){
			logMessage(`No resources in ${getZoneName(currentZoneStr)} to sort.`, true)
			return;
		}
		if (!(currentGatherableId in dataJson[currentZoneStr]) || dataJson[currentZoneStr][currentGatherableId].length == 0){
			logMessage(`No locations of ${getResourceName(currentGatherableId)} in ${getZoneName(currentZoneStr)} to sort.`, true)
			return;
		}
		dataJson[currentZoneStr][currentGatherableId].sort(compareLocation);
		logMessage(`Sorted locations of ${getResourceName(currentGatherableId)} in ${getZoneName(currentZoneStr)}`)
	}
	
	// TERA's actual-to-map coordinates are inverted, so this will essentially sort from SW to NE (more specifically, W -> E, one row at a time from S to N).
	function compareLocation(locA, locB){
		if (locA.location.x < locB.location.x){
			return -1; 
		}
		if (locA.location.x > locB.location.x){
			return 1; 
		}
		if (locA.location.y < locB.location.y){
			return -1; 
		}
		if (locA.location.y > locB.location.y){
			return 1; 
		}
		if (locA.location.safe < locB.location.safe){
			return -1; 
		}
		if (locA.location.safe > locB.location.safe){
			return 1; 
		}		
		return 0
	}
	
	function distanceBetweenLocation(locA, locB){
		return Math.sqrt(Math.pow((locA.x - locB.x), 2) + Math.pow((locA.y - locB.y), 2));
	}
	
	function isNumber(value) {
		return !isNaN(parseFloat(value)) && !isNaN(value - 0) 
	}
	
	function locToString(loc){
		return `{ "x": ${loc.x}, "y": ${loc.y}, "z": ${loc.z}`
	}
	
	function validateAreaAndResource() {
		if (currentGatherableId == -1){
			logMessage(`Set a gatherable resource first.`);
			return false;
		}
		
		if (!(currentZoneStr in dataJson)){
			logMessage(`No data found for ${getZoneName(currentZoneStr)}.`)
			return false;
		}
		if (!(currentGatherableId in dataJson[currentZoneStr])){
			logMessage(`No spawn locations available for ${getResourceName(currentGatherableId)} in ${getZoneName(currentZoneStr)}`)
			return false;
		}
		return true;		
	}
	
	function getResourceName(resourceID){
		return (resourceID in namesJson.gatherables) ? namesJson.gatherables[resourceID].name + ` (id ${resourceID})`: resourceID + ' (unknown ID)';
	}
	
	function getResourceItemId(resourceID){
		return (resourceID in namesJson.gatherables) ? namesJson.gatherables[resourceID].itemId : -1;		
	}
	
	function getZoneName(zoneID){
		return (zoneID in namesJson.zones) ? namesJson.zones[zoneID] + ` (id ${zoneID})` : zoneID + ' (unknown ZoneID)';		
	}
	
	function getRandom(base, variance){
		return base + (Math.random() * 2 * variance) - variance;
	}
	
	function loadJson(filePath){
		try {
			let data = JSON.parse(fs.readFileSync(filePath, "utf8"));
			if (!data){
				logMessage(`Error loading JSON at ${filePath}`, LOG_CONSOLE_ONLY)				
			}
			else{
				logMessage(`Loaded data from JSON at ${filePath}`, LOG_CONSOLE_ONLY)
			}
			return data ? data : {};
		}
		catch (err) {
			logMessage(`Error loading JSON at ${filePath}!`, LOG_CONSOLE_ONLY)
			return {}
		}
	}
	
	function saveJson(data, path) {
		fs.writeFile(path, JSON.stringify(data, null, '\t'), 'utf8', function (err) {
			if (!err){
				logMessage(`The JSON at ${path} has been successfully updated.`, LOG_CONSOLE_ONLY)
			}
			else{
				logMessage(`Error writing to ${path}!`, LOG_CONSOLE_ONLY)
			}
		});
	}
	
	function logMessage(message, logState = LOG_COMMAND_ONLY){
		switch(logState){
			case LOG_COMMAND_ONLY:
				command.message(message);
				break;
			case LOG_CONSOLE_ONLY:
				console.log(message);
				break;
			case LOG_ALL:
				command.message(message);
				console.log(message);
				break;
			default:
				console.log(message);
				break;
		}
	}
}
