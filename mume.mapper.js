(function( global ) {
'use strict';

var MumeMap, MumeXmlParser, MumeMapDisplay, MumeMapData, MumeMapIndex, MumePathMachine;

var ROOM_PIXELS = 48,
    SECT_UNDEFINED      =  0,
    SECT_INSIDE         =  1,
    SECT_CITY           =  2,
    SECT_FIELD          =  3,
    SECT_FOREST         =  4,
    SECT_HILLS          =  5,
    SECT_MOUNTAIN       =  6,
    SECT_WATER_SHALLOW  =  7,
    SECT_WATER          =  8,
    SECT_WATER_NOBOAT   =  9,
    SECT_UNDERWATER     = 10,
    SECT_ROAD           = 11,
    SECT_BRUSH          = 12,
    SECT_TUNNEL         = 13,
    SECT_CAVERN         = 14,
    SECT_DEATHTRAP      = 15,
    SECT_COUNT = SECT_DEATHTRAP;

var MAP_DATA_PATH = "mapdata/v1/";





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
    var map = this;

    this.mapData.load().done( function()
    {
        map.display.loadMap();
    } );

    $(this.pathMachine).on( MumePathMachine.SIG_MOVEMENT, this.onMovement.bind( this ) );
};

MumeMap.prototype.onMovement = function( event, rooms_x, rooms_y )
{
    this.display.repositionHere( rooms_x, rooms_y );
    this.display.refresh();
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
    this.mapIndex.findPosByNameDesc( name, desc );
};




/* Queries and caches the server-hosted index of rooms.
 * For v1 format, that's a roomname+roomdesc => position index, 2.4MB total,
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
 * because we indexed on the plain text. Same thing for linebreaks.
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
    var positions, roomInfo;

    positions = this.cache.get( hash );
    roomInfo = { name: name, desc: desc, hash: hash, };
    if ( positions === undefined )
    {
        console.log( "MumeMapIndex: unknown room %s (%O)", name, roomInfo );
        result.fail();
    }
    else
    {
        console.log( "MumeMapIndex: resolved %s (%O) to %O", name, roomInfo, positions );
        result.resolve( positions );
    }
    return result;
};

/* This may be asynchronous if the index chunk has not been downloaded yet, so
 * the result is a jQuery Deferred.
 */
MumeMapIndex.prototype.findPosByNameDesc = function( name, desc )
{
    var hash, chunk, result, cache;

    hash = MumeMapIndex.hashNameDesc( name, desc );
    result = jQuery.Deferred();

    // Shortcut if we already have that index chunk in cache
    if ( this.cachedChunks.has( hash ) )
        return this.findPosByNameDescCached( name, desc, result, hash );

    chunk = hash.substr( 0, 2 );
    jQuery.getJSON( MAP_DATA_PATH + "roomindex/" + chunk + ".json" )
        .done( function( json )
        {
            console.log( "Map index chunk " + chunk + " downloaded" );
            this.cachedChunks.add( chunk );
            this.updateCache( json );
            this.findPosByNameDescCached( name, desc, result, hash );
        }.bind( this ) )
        .fail( function( jqxhr, textStatus, error )
        {
            var err = textStatus + ", " + error;
            console.log( "Loading metadata failed: " + err );
            result.fail();
        }.bind( this ) );

    return result;
};





/* Stores map data (an array of room structures, exposed as .data) and provides
 * an indexing feature. */
MumeMapData = function()
{
};

MumeMapData.prototype.metaData = null;

// These properties should exist for all rooms loaded from an external
// data source.
MumeMapData.REQUIRED_PROPS = [
    "directions", "maxX", "maxY", "maxZ", "minX", "minY", "minZ", "roomsCount"
    ];

// Initiates loading the external JSON map data.
// Returns a JQuery future that can be used to execute further code once done.
MumeMapData.prototype.load = function()
{
    var map = this;

    return jQuery.getJSON( MAP_DATA_PATH + "arda.json" )
        .done( function( json )
        {
            map.metaData = json;
            console.log( "Map metadata loaded" );
        })
        .fail( function( jqxhr, textStatus, error )
        {
            var err = textStatus + ", " + error;
            console.log( "Loading metadata failed: " + err );
        });
};






// Returns a simple distance useful to determine what to include on the map and
// what to filter out
var displayFilterDistance = function( x1, y1, x2, y2 )
{
    return Math.abs( x2 - x1 ) + Math.abs( y2 - y1 );
};

/* Renders mapData into a DOM placeholder identified by containerElementName.
 */
MumeMapDisplay = function( containerElementName, mapData )
{
    this.mapData = mapData;
    this.containerElementName = containerElementName;

    // PIXI elements
    this.herePointer = null;
    this.stage = null;
    this.layer0 = null;
    this.renderer = null;
};

/* Installs the viewport into the DOM and starts loading textures etc (assets).
 * The loading continues in background, after which buildMapDisplay() is
 * called. */
MumeMapDisplay.prototype.loadMap = function()
{
    var stub;

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
    //this.repositionHere( this.mapData.data[0].x, this.mapData.data[0].y );
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

MumeMapDisplay.prototype.repositionHere = function( rooms_x, rooms_y )
{
    this.herePointer.position = new PIXI.Point( rooms_x * ROOM_PIXELS, rooms_y * ROOM_PIXELS );

    // XXX This will need to be optimized to avoid going through that whole
    // array on every move...
    var layer0 = this.layer0;
    var roomsAdded = 0;
    var minX = null, maxX = null, minY = null, maxY = null;
    this.mapData.data.forEach( function( room )
    {
        if ( !room.inPixi && displayFilterDistance( rooms_x, rooms_y, room.x, room.y ) < 60 )
        {
            layer0.addChild( MumeMapDisplay.buildRoomDisplay( room ) );
            room.inPixi = true;
            ++roomsAdded;
            minX = Math.min( minX, room.x );
            maxX = Math.max( maxX, room.x );
            minY = Math.min( minY, room.y );
            maxY = Math.max( maxY, room.y );
        }
    } );

    if ( roomsAdded != 0 )
        console.log( "Added " + roomsAdded + " rooms to PIXI, area (r) "+minX+","+minY+"-"+maxX+","+maxY );
    console.log( "Recentered pointer to (r) " + rooms_x + "," + rooms_y );

    // Scroll to make the herePointer visible
    var pointerGlobalPos = this.herePointer.toGlobal( new PIXI.Point( 0, 0 ) );
    this.stage.x = - pointerGlobalPos.x + 400;
    this.stage.y = - pointerGlobalPos.y + 300;
    console.log( "Scrolled to (px) " + this.stage.x + "," + this.stage.y );

    return;
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
