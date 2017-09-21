(function( global ) {
'use strict';

var MumeMap, MumeXmlParser, MumeMapDisplay, MumeMapData, MumeMapIndex, MumePathMachine,
    SpatialIndex,
    ROOM_PIXELS, MAP_DATA_PATH,
    SECT_UNDEFINED, SECT_INSIDE, SECT_CITY, SECT_FIELD, SECT_FOREST, SECT_HILLS,
    SECT_MOUNTAIN, SECT_WATER_SHALLOW, SECT_WATER, SECT_WATER_NOBOAT, SECT_UNDERWATER,
    SECT_ROAD, SECT_BRUSH, SECT_TUNNEL, SECT_CAVERN, SECT_DEATHTRAP, SECT_COUNT,
    forEachDeferred, mapKeys;

ROOM_PIXELS = 48;
SECT_UNDEFINED      =  0;
SECT_INSIDE         =  1;
SECT_CITY           =  2;
SECT_FIELD          =  3;
SECT_FOREST         =  4;
SECT_HILLS          =  5;
SECT_MOUNTAIN       =  6;
SECT_WATER_SHALLOW  =  7;
SECT_WATER          =  8;
SECT_WATER_NOBOAT   =  9;
SECT_UNDERWATER     = 10;
SECT_ROAD           = 11;
SECT_BRUSH          = 12;
SECT_TUNNEL         = 13;
SECT_CAVERN         = 14;
SECT_DEATHTRAP      = 15;
SECT_COUNT = SECT_DEATHTRAP;
MAP_DATA_PATH = "mapdata/v1/";

/* Provides a single Deferred that waits for all Deferreds in elems to be
 * completed. Each elem is expected to have a matching context from the
 * contexts Array, which is provided as a first arg to the actions. The
 * doneAction and failAction are called depending on the result of the
 * deferreds. Returns result or a new Deferred if not provided. Avoid providing
 * a long list of immediate (already resolved/rejected) elems as that
 * can lead to an infinite recursion error.
 */
forEachDeferred = function( elems, contexts, thisArg, doneAction, failAction, result )
{
    var currentElem, currentContext;

    if ( typeof result !== "object" )
        result = jQuery.Deferred();

    if ( doneAction == null )
        doneAction = function() {};

    if ( failAction == null )
        failAction = function() {};

    if ( elems.length === 0 )
        return result.resolve();

    currentElem = elems.pop();
    currentContext = contexts.pop();

    currentElem
        .done( forEachDeferred.actionWrapper.bind( thisArg, doneAction, currentContext ) )
        .fail( forEachDeferred.actionWrapper.bind( thisArg, failAction, currentContext ) )
        .always( forEachDeferred.bind( undefined, elems, contexts, thisArg,
            doneAction, failAction, result ) );

    return result;
};

/* Private helper. Calls action with this and prepended context arg as per spec
 * above.
 */
forEachDeferred.actionWrapper = function( action, currentContext )
{
    var args = [].slice.call( arguments, 2 );
    args.unshift( currentContext );
    action.apply( this, args );
};


/* Like map.keys(), but as an Array and IE-compatible.
 */
mapKeys = function( map )
{
    var keys;

    keys = [];
    map.forEach( function( value, key ) { keys.push( key ); } );
    return keys;
};




/* This is the "entry point" to this library for the rest of the code. */
MumeMap = function( containerElementName )
{
    this.mapData = new MumeMapData();
    this.mapIndex = new MumeMapIndex();
    this.display = new MumeMapDisplay( containerElementName, this.mapData );

    this.pathMachine = new MumePathMachine( this.mapData, this.mapIndex );
    this.processTag = this.pathMachine.processTag.bind( this.pathMachine );

    MumeMap.debugInstance = this;
};

MumeMap.prototype.load = function()
{
    this.mapData.load().done( function()
    {
        this.display.loadMap();
        $(this.pathMachine).on( MumePathMachine.SIG_MOVEMENT, this.onMovement.bind( this ) );
    }.bind( this ) );
};

MumeMap.prototype.onMovement = function( event, x, y )
{
    this.display.repositionHere( x, y ).done( function()
    {
        this.display.refresh();
    }.bind( this ) );
};






/* Analogy to MMapper2's path machine, although ours is a currently just a
 * naive room+desc exact search with no "path" to speak of.
 */
MumePathMachine = function( mapData, mapIndex )
{
    this.mapData = mapData;
    this.mapIndex = mapIndex;
    this.roomName = null;
};

MumePathMachine.SIG_MOVEMENT = "movement";

/* This receives an event from MumeXmlParser when it encounters a closing tag.
 * */
MumePathMachine.prototype.processTag = function( event, tag )
{
    console.log( "MumePathMachine processes tag " + tag.name );
    if ( tag.name === "name" )
        this.roomName = tag.text;
    else if ( tag.name === "description" )
    {
        if ( this.roomName )
        {
            this.enterRoom( this.roomName, tag.text );
            this.roomName = null;
        }
        else
        {
            throw "Bug: the MumePathMachine got a room description but no room name: " +
                tag.text.substr( 0, 50 ) + "...";
        }
    }
    else if ( tag.name === "room" )
    {
        this.roomName = null;
    }
};

/* Internal function called when we got a complete room. */
MumePathMachine.prototype.enterRoom = function( name, desc )
{
    this.mapIndex.findPosByNameDesc( name, desc )
        .done( function( coordinates )
        {
            $(this).triggerHandler( MumePathMachine.SIG_MOVEMENT, coordinates[0] );
        }.bind( this ) );
};




/* Queries and caches the server-hosted index of rooms.
 * For v1 format, that's a roomname+roomdesc => coords index, 2.4MB total,
 * split into 10kB JSON chunks.
 */
MumeMapIndex = function()
{
    this.cache = new Map();
    this.cachedChunks = new Set();
};

// This is a vast simplification of course...
MumeMapIndex.ANY_ANSI_ESCAPE = /\x1B\[[^A-Za-z]+[A-Za-z]/g;

/* Make sure none of this data contains colour (or other) escapes,
 * because we indexed on the plain text. Same thing for linebreaks. Also remove
 * any trailing whitespace, because MMapper seems to do so.
 */
MumeMapIndex.sanitizeString = function( text )
{
    return text
        .replace( MumeMapIndex.ANY_ANSI_ESCAPE, '' )
        .replace( /\r\n/g, "\n" )
        .replace( / +$/gm, "" );
};

/* Returns a hash of the name+desc that identifies the chunk of the name+desc
 * index we want from the server. This algorithm must be identical to what
 * MMapper uses for this version of the webmap format.
 */
MumeMapIndex.hashNameDesc = function( name, desc )
{
    var namedesc, blob, i, hash;

    name = MumeMapIndex.sanitizeString( name );
    desc = MumeMapIndex.sanitizeString( desc );
    namedesc = name + desc;

    // For maximum MD5 compatibility, converts namedesc into blob, discarding
    // all chars that are not plain ASCII.
    // String.replace(..., func) is probably faster, but I'm not sure we care.
    blob = "";
    for ( i = 0; i < namedesc.length;  ++i )
        if ( namedesc.charCodeAt( i ) < 128 )
            blob += namedesc.charAt( i );

    hash = SparkMD5.hash( blob );
    return hash;
};

MumeMapIndex.prototype.updateCache = function( json )
{
    var hash, oldSize, sizeIncrease, jsonSize;

    oldSize = this.cache.size;

    for ( hash in json )
        if ( json.hasOwnProperty( hash ) )
            this.cache.set( hash, json[ hash ] );

    sizeIncrease = this.cache.size - oldSize;
    jsonSize = Object.entries( json ).length;

    console.log( "MumeMapIndex: cached %d new entries (%d total)",
        sizeIncrease, this.cache.size, jsonSize );

    if ( sizeIncrease != jsonSize )
        console.error( "MumeMapIndex: stray index entries in %O?", json );
};

// Private helper for findPosByNameDesc().
MumeMapIndex.prototype.findPosByNameDescCached = function( name, desc, result, hash )
{
    var coordinates, roomInfo;

    coordinates = this.cache.get( hash );
    roomInfo = { name: name, desc: desc, hash: hash, };
    if ( coordinates === undefined )
    {
        console.log( "MumeMapIndex: unknown room %s (%O)", name, roomInfo );
        result.reject();
    }
    else
    {
        console.log( "MumeMapIndex: found %s (%O) in %O", name, roomInfo, coordinates );
        result.resolve( coordinates );
    }
    return result;
};

/* This may be asynchronous if the index chunk has not been downloaded yet, so
 * the result is a jQuery Deferred.
 */
MumeMapIndex.prototype.findPosByNameDesc = function( name, desc )
{
    var hash, chunk, result, url;

    hash = MumeMapIndex.hashNameDesc( name, desc );
    result = jQuery.Deferred();

    // Shortcut if we already have that index chunk in cache
    chunk = hash.substr( 0, 2 );
    if ( this.cachedChunks.has( chunk ) )
        return this.findPosByNameDescCached( name, desc, result, hash );

    console.log( "Downloading map index chunk " + chunk );
    url = MAP_DATA_PATH + "roomindex/" + chunk + ".json";
    jQuery.getJSON( url )
        .done( function( json )
        {
            this.cachedChunks.add( chunk );
            this.updateCache( json );
            this.findPosByNameDescCached( name, desc, result, hash );
        }.bind( this ) )
        .fail( function( jqxhr, textStatus, error )
        {
            console.error( "Loading map index chunk %s failed: %s, %O", url, textStatus, error );
            result.fail();
        } );

    return result;
};





/* Stores stuff in a x/y/z-indexed 3D array. The coordinates must be within the
 * minX/maxX/etc bounds of the metaData.
 */
SpatialIndex = function( metaData )
{
    this.metaData = metaData;

    // 3D array. Hopefully, JS' sparse arrays will make this memory-efficient.
    this.data = new Array( this.metaData.maxX - this.metaData.minX );
};

/* Private helper to get 0-based coordinates from whatever MM2 provided */
SpatialIndex.prototype.getZeroedCoordinates = function( x, y, z )
{
    return {
        x: x - this.metaData.minX,
        y: y - this.metaData.minY,
        z: z - this.metaData.minZ,
    };
};

/* Public. */
SpatialIndex.prototype.set = function( x, y, z, what )
{
    var zero;

    zero = this.getZeroedCoordinates( x, y, z );

    if ( this.data[ zero.x ] === undefined )
        this.data[ zero.x ] = new Array( this.metaData.maxY - this.metaData.minY );

    if ( this.data[ zero.x ][ zero.y ] === undefined )
        this.data[ zero.x ][ zero.y ] = [];

    this.data[ zero.x ][ zero.y ][ zero.z ] = what;
};

/* Public. */
SpatialIndex.prototype.get = function( x, y, z )
{
    var zero, what;

    zero = this.getZeroedCoordinates( x, y, z );

    if ( this.data[ zero.x ] !== undefined &&
            this.data[ zero.x ][ zero.y ] !== undefined &&
            this.data[ zero.x ][ zero.y ][ zero.z ] !== undefined )
    {
        return this.data[ zero.x ][ zero.y ][ zero.z ];
    }
    else
    {
        return null;
    }
};






/* Stores map data (an array of room structures, exposed as .data) and provides
 * an indexing feature. */
MumeMapData = function()
{
    this.cachedZones = new Set();
};

/* Publicly readable, guaranteed to hold REQUIRED_META_PROPS. */
MumeMapData.prototype.metaData = null;

/* Private in-memory room cache. */
MumeMapData.prototype.rooms = null;

/* These properties are expected to be found in the metadata file.
 */
MumeMapData.REQUIRED_META_PROPS = [
    "directions", "maxX", "maxY", "maxZ", "minX", "minY", "minZ", "roomsCount"
    ];

/* These properties should exist for all rooms loaded from an external
 * data source.
 */
MumeMapData.REQUIRED_ROOM_PROPS = [
    "name", "desc", "id", "x", "y", "z", "exits", /* There is more ... */
    ];

// Arda is split into JSON files that wide.
MumeMapData.ZONE_SIZE = 20;

/* Initiates loading the external JSON map data.
 * Returns a JQuery Deferred that can be used to execute further code once done.
 */
MumeMapData.prototype.load = function()
{
    var result;

    result = jQuery.Deferred();

    jQuery.getJSON( MAP_DATA_PATH + "arda.json" )
        .done( function( json )
        {
            console.log( "Map metadata loaded" );
            if ( ! this.setMetadata( json ) )
                result.reject();
            else
                result.resolve();
        }.bind( this ))
        .fail( function( jqxhr, textStatus, error )
        {
            console.error( "Loading metadata failed: %s, %O", textStatus, error );
            result.reject();
        });

    return result;
};

/* Private helper that checks the validity of json */
MumeMapData.prototype.setMetadata = function( json )
{
    var missing;

    missing = MumeMapData.REQUIRED_META_PROPS.filter( function( prop )
    {
        return !json.hasOwnProperty( prop );
    } );

    if ( missing.length !== 0 )
    {
        console.error( "Missing properties in loaded metadata: %O", missing );
        return false;
    }

    this.metaData = json;
    this.rooms = new SpatialIndex( json );

    return true;
};

/* Private helper that feeds the in-memory cache. */
MumeMapData.prototype.setCachedRoom = function( room )
{
    this.rooms.set( room.x, room.y, room.z, room );
};

/* Returns a room from the in-memory cache or null if not found. Does not
 * attempt to download the zone if it's missing from the cache.
 */
MumeMapData.prototype.getRoomAtCached = function( x, y, z )
{
    var room;

    room = this.rooms.get( x, y, z );

    if ( room != null )
    {
        /*console.log( "MumeMapData found room %s (%d) for coords %d,%d,%d",
            room.name, room.id, x, y, z );*/
        return room;
    }
    else
    {
        /*console.log( "MumeMapData did not find a room for coords %d,%d,%d",
            x, y, z );*/
        return null;
    }
};

/* Private. */
MumeMapData.prototype.getRoomResultAtCached = function( x, y, z, result )
{
    var room;

    room = this.getRoomAtCached( x, y, z );
    if ( room === null )
        return result.reject();
    else
        return result.resolve( room );
};

/* Private. Stores a freshly retrieved JSON zone into the in-memory cache. */
MumeMapData.prototype.cacheZone = function( zone, json )
{
    var missing, i, room, count;

    if ( !Array.isArray( json ) )
    {
        console.error( "Expected to find an Array for zone %s, got %O", zone, json );
        return false;
    }

    count = 0;
    for ( i = 0; i < json.length; ++i )
    {
        room = json[ i ];

        missing = MumeMapData.REQUIRED_ROOM_PROPS.filter( function( room2, prop )
        {
            return !room2.hasOwnProperty( prop );
        }.bind( this, room ) );

        if ( missing.length !== 0 )
        {
            console.error( "Missing properties %O in room #%d of zone %s", missing, i, zone );
            return false;
        }

        this.setCachedRoom( room );
        ++count;
    }

    console.log( "MumeMapData cached %d rooms for zone %s", count, zone );
    this.cachedZones.add( zone );
    return true;
};

/* Returns the x,y zone for that room's coords, or null if out of the map.
 */
MumeMapData.prototype.getRoomZone = function( x, y )
{
    var zoneX, zoneY, zone;

    if ( x < this.metaData.minX || x > this.metaData.maxX ||
            y < this.metaData.minY || y > this.metaData.maxY )
        return null;

    zoneX = x - ( x % MumeMapData.ZONE_SIZE );
    zoneY = y - ( y % MumeMapData.ZONE_SIZE );
    zone = zoneX + "," + zoneY;

    return zone;
};

/* Private. */
MumeMapData.prototype.downloadAndCacheZone = function( zone )
{
    var url, result;

    result = jQuery.Deferred();

    console.log( "Downloading map zone %s", zone );
    url = MAP_DATA_PATH + "zone/" + zone + ".json";
    jQuery.getJSON( url )
        .done( function( json )
        {
            this.cacheZone( zone, json );
            result.resolve();
        }.bind( this ) )
        .fail( function( jqXHR, textStatus, error )
        {
            if ( jqXHR.status === 404 )
                console.log( "Map zone %s does not exist: %s, %O", url, textStatus, error );
                // Not an error: zones without data simply don't get output
            else
                console.error( "Downloading map zone %s failed: %s, %O", url, textStatus, error );
            result.reject();
        } );

    return result;
};

/* Fetches a room from the cache or the server. Returns a jQuery Deferred. */
MumeMapData.prototype.getRoomAt = function( x, y, z )
{
    var zone, result;

    result = jQuery.Deferred();

    zone = this.getRoomZone( x, y );
    if ( zone === null )
        return result.reject();

    if ( this.cachedZones.has( zone ) )
        return this.getRoomResultAtCached( x, y, z, result );

    this.downloadAndCacheZone( zone )
        .done( function()
        {
            this.getRoomResultAtCached( x, y, z, result );
        }.bind( this ) );

    return result;
};

/* Fetches rooms at an Array of x/y/z coords from the cache or the server.
 * Returns arrays of rooms through a jQuery Deferred. The rooms are returned as
 * soon as they are available as notify()cations and as a summary in the final
 * resolve(). Rooms that do not exist are not part of the results.
 */
MumeMapData.prototype.getRoomsAt = function( coordinates )
{
    var zonesNotInCache, roomsInCache, roomsDownloaded, downloadDeferreds,
        result, url, i, coords, zone, room, downloadResult;

    result = jQuery.Deferred();
    downloadDeferreds = [];
    zonesNotInCache = new Map(); // zone => [ coords... ]
    roomsInCache = [];
    roomsDownloaded = [];

    // Sort coordinates into rooms in cache and rooms needing a download
    for ( i = 0; i < coordinates.length; ++i )
    {
        coords = coordinates[i];
        zone = this.getRoomZone( coords.x, coords.y );
        if ( zone === null )
            continue;

        if ( !this.cachedZones.has( zone ) )
        {
            if ( zonesNotInCache.has( zone ) )
                zonesNotInCache.get( zone ).push( coords );
            else
            {
                zonesNotInCache.set( zone, [ coords ] );

                console.log( "Downloading map zone %s for room %d,%d", zone, coords.x, coords.y );
                url = MAP_DATA_PATH + "zone/" + zone + ".json";
                downloadDeferreds.push( jQuery.getJSON( url ) );
            }
        }
        else
        {
            room = this.getRoomAtCached( coords.x, coords.y, coords.z );
            if ( room != null )
                roomsInCache.push( room );
        }
    }

    // Return cached rooms immediatly through a notify
    result.notify( roomsInCache );

    // Download the rest
    downloadResult = forEachDeferred( downloadDeferreds, mapKeys( zonesNotInCache ), this,
        // doneAction
        function( zone2, json )
        {
            var coordinates2, coords2, rooms2, room2, j;

            console.log( "Zone %s downloaded", zone2 );
            this.cacheZone( zone2, json );

            // Send the batch of freshly downloaded rooms
            coordinates2 = zonesNotInCache.get( zone2 );
            rooms2 = [];
            for ( j = 0; j < coordinates2.length; ++j )
            {
                coords2 = coordinates2[j];
                room2 = this.getRoomAtCached( coords2.x, coords2.y, coords2.z );
                if ( room2 != null )
                {
                    rooms2.push( room2 );
                    roomsDownloaded.push( room2 );
                }
            }
            result.notify( rooms2 );
        },
        // failAction
        function( zone2, jqXHR, textStatus, error )
        {
            if ( jqXHR.status === 404 )
                console.log( "Map zone %s does not exist: %s, %O", zone2, textStatus, error );
                // Not an error: zones without data simply don't get output
            else
                console.error( "Downloading map zone %s failed: %s, %O", zone2, textStatus, error );
        } );

    // Return a summary
    downloadResult.always( function() { result.resolve( roomsInCache.concat( roomsDownloaded ) ); } );

    return result;
};






/* Renders mapData into a DOM placeholder identified by containerElementName.
 */
MumeMapDisplay = function( containerElementName, mapData )
{
    this.mapData = mapData;
    this.containerElementName = containerElementName;
};

MumeMapDisplay.prototype.roomDisplays = null;

// PIXI elements
MumeMapDisplay.prototype.herePointer = null;
MumeMapDisplay.prototype.stage = null;
MumeMapDisplay.prototype.layer0 = null;
MumeMapDisplay.prototype.renderer = null;

/* Installs the viewport into the DOM and starts loading textures etc (assets).
 * The loading continues in background, after which buildMapDisplay() is
 * called. */
MumeMapDisplay.prototype.loadMap = function()
{
    var stub;

    // We need the metaData to be loaded to init the SpatialIndex.
    this.roomDisplays = new SpatialIndex( this.mapData.metaData );

    // Set the Pixi viewport as the content of that new window
    this.stage = new PIXI.Container();
    this.renderer = PIXI.autoDetectRenderer( 800, 600 );
    this.renderer.backgroundColor = 0x6e6e6e;
    stub = document.getElementById( this.containerElementName );
    stub.parentElement.replaceChild( this.renderer.view, stub );
    this.renderer.view.id = this.containerElementName;

    // Start loading assets
    PIXI.loader.add( MumeMapDisplay.getAllAssetPaths() );
    PIXI.loader.load( this.buildMapDisplay.bind( this ) );

    return;
};

/* Called when all assets are available. Constructs the graphical structure
 * (layers etc) used for rendering and throw all that at the rendering layer
 * (Pixi lib). */
MumeMapDisplay.prototype.buildMapDisplay = function()
{
    var map;

    // Everything belongs to the map, so we can move it around to emulate
    // moving the viewport
    map = new PIXI.Container();

    // Add the rooms to a base layer (later we'll need more layers)
    this.layer0 = new PIXI.Container();
    map.addChild( this.layer0 );

    // Add the current room yellow square
    this.herePointer = MumeMapDisplay.buildHerePointer();
    this.herePointer.visible = false;
    map.addChild( this.herePointer );

    // And set the stage
    this.stage.addChild( map );
    this.refresh();

    return;
};

MumeMapDisplay.getSectorAssetPath = function( sector )
{
    return "resources/pixmaps/terrain" + sector + ".png";
};

MumeMapDisplay.getAllAssetPaths = function()
{
    var i, paths = [];
    for ( i = SECT_UNDEFINED; i < SECT_COUNT; ++i )
        paths.push( MumeMapDisplay.getSectorAssetPath( i ) );
    return paths;
};

/* Returns the graphical structure for a single room for rendering (base
 * texture, walls, flags etc). */
MumeMapDisplay.buildRoomDisplay = function( room )
{
    var display, sector, borders, imgPath;

    display = new PIXI.Container();

    // load a PNG as background (sector type)
    imgPath = MumeMapDisplay.getSectorAssetPath( room.sector );
    sector = new PIXI.Sprite( PIXI.loader.resources[ imgPath ].texture );
    sector.height = sector.width = ROOM_PIXELS; // Just in case we got a wrong PNG here
    display.addChild( sector );

    // Draw the borders
    borders = new PIXI.Graphics();
    borders.lineStyle( 2, 0x000000, 1 );

    [   // direction MD entry, start coords, end coords
        [ "north", 0, 0, ROOM_PIXELS, 0 ],
        [ "east",  ROOM_PIXELS, 0, ROOM_PIXELS, ROOM_PIXELS ],
        [ "south", ROOM_PIXELS, ROOM_PIXELS, 0, ROOM_PIXELS ],
        [ "west",  0, ROOM_PIXELS, 0, 0 ]
    ].forEach( function( border )
    {
        // XXX: room["dir"] syntax may break some Javascript engine
        // optimizations, test it (with a complete map) and refactor if
        // needed.
        if ( typeof room[ border[0] ] !== "number" )
        {
            borders.moveTo( border[1], border[2] );
            borders.lineTo( border[3], border[4] );
        }
    } );
    display.addChild( borders );

    // Position the room display in its layer
    display.position = new PIXI.Point( room.x * ROOM_PIXELS, room.y * ROOM_PIXELS );
    /*console.log( "MumeMapDisplay added room %s (%d,%d) in PIXI at %O",
        room.name, room.x, room.y, display.getGlobalPosition() );*/

    display.cacheAsBitmap = true;
    return display;
};

/* Returns the graphical structure for the yellow square that shows the current
 * position to the player. */
MumeMapDisplay.buildHerePointer = function()
{
    var square, size, offset;

    size = ROOM_PIXELS * 1.4;
    offset = ( size - ROOM_PIXELS ) / 2;

    square = new PIXI.Graphics();
    square.lineStyle( 2, 0xFFFF00, 1 );
    square.drawRect( -offset, -offset, size, size );

    square.beginFill( 0x000000, 0.1 );
    square.drawRect( -offset, -offset, size, size );
    square.endFill();

    return square;
};

/* Repositions the HerePointer (yellow square), centers the view, and fetches
 * nearby rooms for Pixi. Does not refresh the view.
 */
MumeMapDisplay.prototype.repositionHere = function( x, y )
{
    var i, j, coordinates, result;

    this.herePointer.position = new PIXI.Point( x * ROOM_PIXELS, y * ROOM_PIXELS );
    this.herePointer.visible = true;

    // Scroll to make the herePointer visible
    var pointerGlobalPos = this.herePointer.toGlobal( new PIXI.Point( 0, 0 ) );
    this.stage.x = - pointerGlobalPos.x + 400;
    this.stage.y = - pointerGlobalPos.y + 300;
    console.log( "Recentering view to (r) %d,%d, (px) %d,%d", x, y, this.stage.x, this.stage.y );

    coordinates = [];
    for ( i = x - 20; i < x + 20; ++i )
        for ( j = y - 20; j < y + 20; ++j )
            if ( this.roomDisplays.get( i, j, -1 ) == null )
                coordinates.push( { x: i, y: j, z: -1 } );

    result = this.mapData.getRoomsAt( coordinates )
        .progress( function( rooms )
        {
            var k, display, room;
            for ( k = 0; k < rooms.length; ++k )
            {
                room = rooms[k];
                display = MumeMapDisplay.buildRoomDisplay( room );
                if ( this.roomDisplays.get( room.x, room.y, room.z ) == null )
                {
                    this.roomDisplays.set( room.x, room.y, room.z, display );
                    this.layer0.addChild( display );
                }
            }
        }.bind( this ) );

    return result;
};

MumeMapDisplay.prototype.refresh = function()
{
    this.renderer.render( this.stage );
};





/* Filters out the XML-like tags that MUME can send in "XML mode", and sends
 * them as events instead.
 *
 * Sample input:
 * <xml>XML mode is now on.
 * <prompt>!f- CW&gt;</prompt>f
 * You flee head over heels.
 * You flee north.
 * <movement dir=north/>
 * <room><name>A Flat Marsh</name>
 * <description>The few, low patches of tangled rushes add a clear tone to the otherwise sombre
 * colour of this flat marshland. Some puddles are scattered behind them, where
 * there are many pebbles of varying sizes. Most of these pebbles have been
 * covered by a thin layer of dark, green moss.
 * </description>A large green shrub grows in the middle of a large pool of mud.
 * </room><exits>Exits: north, east, south.
 * </exits>
 * <prompt>!%- CW&gt;</prompt>cha xml off
 * </xml>XML mode is now off.
 *
 * Matching event output:
 * { name: "prompt",      attr: "",          text: "!f- CW>" }
 * { name: "movement",    attr: "dir=north", text: "" }
 * { name: "name",        attr: "",          text: "A Flat Marsh" }
 * { name: "description", attr: "",          text: "The few... sombre\n...moss.\n" }
 * { name: "room",        attr: "",          text: "A large green...mud.\n" }
 * { name: "exits",       attr: "",          text: "Exits: north, east, south.\n" }
 * { name: "prompt",      attr: "",          text: "!%- CW>" }
 * { name: "xml",         attr: "",          text: "" }
 *
 * Tag hierarchy does not carry a lot of meaning and is not conveyed in the
 * events sent. The text of the XML is always empty as it would be useless but
 * grow huge over the course of the session.
 *
 * At the time of writing, MUME emits at most 1 attribute for tags encountered
 * during mortal sessions, and never quotes it.
 *
 * One registers to events by calling:
 * parser.on( MumeXmlParser.SIG_TAG_END, function( tag ) { /* Use tag.name etc here *./ } );
 */
MumeXmlParser = function( decaf )
{
    this.clear();
};

MumeXmlParser.SIG_TAG_END = "tagend";

MumeXmlParser.prototype.clear = function()
{
    this.tagStack = [];
    this.plainText = "";
};

MumeXmlParser.prototype.connected = MumeXmlParser.prototype.clear;

MumeXmlParser.prototype.topTag = function()
{
    if ( this.tagStack.length == 0 )
        return undefined;
    else
        return this.tagStack[ this.tagStack.length - 1 ];
};

MumeXmlParser.prototype.resetPlainText = function()
{
    var plainText;

    plainText = this.plainText;
    this.plainText = "";

    return plainText;
};

/* Matches a start or end tag and captures the following:
 * 1. any text preceeding the tag
 * 2. "/" if this is an end tag
 * 3. tag name
 * 4. any attributes
 * 5. "/" if this is a leaf tag (IOW, no end tag will follow).
 * 6. any text following the tag
 *
 * Pardon the write-only RE, JavaScript doesn't have /x.
 */
MumeXmlParser.TAG_RE = /([^<]*)<(\/?)(\w+)(?: ([^/>]+))?(\/?)>([^<]*)/g;

MumeXmlParser.decodeEntities = function( text )
{
    var decodedText;

    decodedText = text
        .replace( /&lt;/g, "<" )
        .replace( /&gt;/g, ">" )
        .replace( /&amp;/g, "&" );

    return decodedText;
};

/* Takes text with pseudo-XML as input, returns plain text and emits events.
 */
MumeXmlParser.prototype.filterInputText = function( input )
{
    var matches, isEnd, isLeaf, tagName, attr, textBefore, textAfter, matched;

    while ( ( matches = MumeXmlParser.TAG_RE.exec( input ) ) !== null )
    {
        textBefore = matches[1];
        isEnd      = matches[2];
        tagName    = matches[3];
        attr       = matches[4];
        isLeaf     = matches[5];
        textAfter  = matches[6];

        matched = true;

        if ( textBefore )
        {
            this.pushText( textBefore );
        }

        if ( isLeaf )
        {
            this.startTag( tagName, attr );
            this.endTag( tagName );
        }
        else if ( isEnd )
        {
            this.endTag( tagName );
        }
        else
        {
            this.startTag( tagName, attr );
        }

        if ( textAfter )
        {
            this.pushText( textAfter );
        }
    }

    if ( ! matched )
        return input;

    return this.resetPlainText();
};

MumeXmlParser.prototype.pushText = function( text )
{
    var topTag, error;

    text = MumeXmlParser.decodeEntities( text );
    topTag = this.topTag();

    if ( !topTag || topTag.name === "xml" )
    {
        this.plainText += text;
    }
    else if ( topTag.text.length > 4096 )
    {
        error = "Probable bug: run-away MumeXmlParser tag " + topTag.name +
            ", text: " + topTag.text.substr( 0, 50 );
        this.tagStack.pop();
        throw error;
    }
    else
    {
        this.plainText += text;
        topTag.text += text;
    }
};

MumeXmlParser.prototype.startTag = function( tagName, attr )
{
    this.tagStack.push( { name: tagName, attr: attr, text: "" } );

    if ( this.tagStack.length > 5 )
        throw "Bug: deeply nested MumeXmlParser tags: " +
            this.tagStack.join();

    return;
};

MumeXmlParser.prototype.endTag = function( tagName )
{
    var i, matchingTagIndex, error, topTag;

    // Find the uppermost tag in the stack which matches tagName
    for ( i = this.tagStack.length - 1; i >= 0; ++i )
    {
        if ( this.tagStack[i].name === tagName )
        {
            matchingTagIndex = i;
            break;
        }
    }

    // Perform some sanity checks
    if ( matchingTagIndex === undefined )
        throw "Bug: unmatched closing MumeXmlParser tag " + tagName;
    else if ( matchingTagIndex !== this.tagStack.length - 1 )
    {
        error = "Bug: closing MumeXmlParser tag " + tagName +
            " with the following other tags open: " +
            this.tagStack.slice( matchingTagIndex + 1 ).join();

        this.tagStack = [];
        throw error;
    }

    topTag = this.tagStack.pop();
    $(this).triggerHandler( MumeXmlParser.SIG_TAG_END, [ topTag, ] );
};

global.MumeMap       = MumeMap;
global.MumeXmlParser = MumeXmlParser;

})( this );
