var MumeMap, MumeXmlParser, MumeMapDisplay, MumeMapData, MumePathMachine;

(function() {
'use strict';

var hardcodedMapData,
    ROOM_PIXELS = 48,
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





MumeMap = function( containerElementName )
{
    this.mapData = new MumeMapData();
    this.display = new MumeMapDisplay( containerElementName, this.mapData );

    this.pathMachine = new MumePathMachine( this.mapData );
    this.processTag = this.pathMachine.processTag.bind( this.pathMachine );
}

MumeMap.prototype.load = function()
{
    this.mapData.load();
    this.display.loadMap();

    this.pathMachine.on( "movement", this.display.repositionHere.bind( this.display ) );
}




/* Analogy to MMapper2's path machine, although ours is a currently just a
 * naive room+desc exact search with no "path" to speak of.
 */
MumePathMachine = function( mapData )
{
    this.mapData = mapData;

    this.roomName = null;

    contra.emitter( this, { async: true } );
}

/* This receives an event from MumeXmlParser when it encounters a closing tag.
 * */
MumePathMachine.prototype.processTag = function ( tag )
{
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
            throw "Bug: the MumePathMachine got a room description but no room name: "
                + tag.text.substr( 0, 50 ) + "...";
        }
    }
    else if ( tag.name === "room" )
    {
        this.roomName = null;
    }
}

/* Internal function called when we got a complete room. */
MumePathMachine.prototype.enterRoom = function( name, desc )
{
    var room, roomIds;

    roomIds = this.mapData.findRoomIdsByNameDesc( name, desc );
    if ( roomIds !== undefined )
    {
        room = this.mapData.data[roomIds[0]];
        this.emit( "movement", room.x, room.y );
    }
    else
    {
        console.log( "Unknown room: " + name );
    }
}





/* Stores map data (an array of room structures, exposed as .data) and provides
 * an indexing feature. */
MumeMapData = function()
{
    this.data = hardcodedMapData;
    this.descIndex = null;
}

// These properties should exist for all rooms loaded from an external
// data source.
MumeMapData.REQUIRED_PROPS = [
    "x", "y", "z", "north", "east", "south", "west", "up", "down",
    "sector", "mobflags", "loadflags", "light", "ridable", "name", "desc" ];

MumeMapData.prototype.load = function()
{
    this.indexRooms();
}

// Uses the JS builtin hash to index rooms.
// Should be fast, but memory-hungry. We might load only a pre-computed
// hash of the room to save memory later. To be tested.
MumeMapData.prototype.indexRooms = function()
{
    this.descIndex = {};

    var i;
    for ( i = 0; i < this.data.length; ++i )
    {
        var key, room;
        room = this.data[i];
        key = room.name + "\n" + room.desc;
        if ( this.descIndex[key] === undefined )
            this.descIndex[key] = [ i ];
        else
            this.descIndex[key].push( i );
    }
}

// This is a vast simplification of course...
MumeMapData.ANY_ANSI_ESCAPE = /\x1B\[[^A-Za-z]+[A-Za-z]/g;

// Make sure none of this data contains colour (or other) escapes,
// because we indexed on the plain text. Same thing for linebreaks.
MumeMapData.sanitizeString = function( text )
{
    return text
        .replace( MumeMapData.ANY_ANSI_ESCAPE, '' )
        .replace( /\r\n/g, "\n" );
}

// Returns an array of possible IDs or undefined
MumeMapData.prototype.findRoomIdsByNameDesc = function( name, desc )
{
    var rooms;

    name = MumeMapData.sanitizeString( name );
    desc = MumeMapData.sanitizeString( desc );

    rooms = this.descIndex[name + "\n" + desc];
    return rooms;
}

// TODO: this should be loaded from some external JSON source, same format
// (with a sanity check).
hardcodedMapData = [
    /* 0 */ {
        x: 5, y: 5, z: 0,
        north: null, east: 1, south: null, west: null, up: null, down: null,
        sector: 2 /* SECT_CITY */, mobflags: 0, loadflags: 0, light: null, RIDEABLE: null,
        name: "Fortune's Delving",
        desc:
        "A largely ceremonial hall, it was the first mineshaft that led down to what is\n"
        +"now the second level of this Dwarven city. Dwarves hustle and bustle up and\n"
        +"down the great staircase at whose top you now stand. Guards stand watch by the\n"
        +"stairs, scowling at non-Dwarves, and a large sign is etched into the stone\n"
        +"above them. It has been a long time since the eyes of Men or Elves have been\n"
        +"welcome in the strongholds of the Dwarves, and this place is no exception.\n"
    },
    /* 1 */ {
        x: 6, y: 5, z: 0,
        north: null, east: null, south: null, west: 1, up: null, down: null,
        sector: 1 /* SECT_INSIDE */, mobflags: 0, loadflags: 0, light: null, RIDEABLE: null,
        name: "Trader's Way",
        desc:
        "This wide way has been modelled as an avenue, in the style of Elves and Men. To\n"
        +"the sides are shops selling all sorts of goods, bustling with Dwarves and the\n"
        +"occasional Man or Elf. Between the shops bright outdoor scenes are painted and\n"
        +"weary travellers may rest on benches along the way. On the ceiling high above\n"
        +"can be seen a bright blue sky dotted with puffy white clouds. This part of the\n"
        +"way is particularly busy, as it intersects the main path from the outside to\n"
        +"the deeper parts of the Dwarven caves.\n"
    }
];





/* Renders mapData into a DOM placeholder identified by containerElementName.
 */
MumeMapDisplay = function( containerElementName, mapData )
{
    this.mapData = mapData;
    this.containerElementName = containerElementName;
    this.herePointer = null;
}

/* Installs the viewport into the DOM and starts loading textures etc (assets).
 * The loading continues in background, after which buildMapDisplay() is
 * called. */
MumeMapDisplay.prototype.loadMap = function()
{
    var renderer, stage, animate, stub, loader;

    // Set the Pixi viewport as the content of that new window
    stage = new PIXI.Stage( 0x6e6e6e );
    animate = function() {
        requestAnimationFrame( animate );
        renderer.render( stage );
    };
    renderer = PIXI.autoDetectRenderer( 800, 600 );
    stub = document.getElementById( this.containerElementName );
    stub.parentElement.replaceChild( renderer.view, stub );
    renderer.view.id = this.containerElementName;
    requestAnimationFrame( animate );

    // Start loading assets
    loader = new PIXI.AssetLoader( MumeMapDisplay.getAllAssetPaths() );
    loader.onComplete = this.buildMapDisplay.bind( this, stage );
    loader.load();

    return;
}

/* Called when all assets are available. Constructs the graphical structure
 * (layers etc) used for rendering and throw all that at the rendering layer
 * (Pixi lib). */
MumeMapDisplay.prototype.buildMapDisplay = function( stage )
{
    var map, layer0;

    // Everything belongs to the map, so we can move it around to emulate
    // moving the viewport
    map = new PIXI.DisplayObjectContainer();

    // Add the rooms to a base layer (later we'll need more layers)
    layer0 = new PIXI.DisplayObjectContainer();
    this.mapData.data.forEach( function( room )
    {
        layer0.addChild( MumeMapDisplay.buildRoomDisplay( room ) );
    } );
    map.addChild( layer0 );

    // Add the current room yellow square
    this.herePointer = MumeMapDisplay.buildHerePointer();
    this.repositionHere( this.mapData.data[0].x, this.mapData.data[0].y );
    map.addChild( this.herePointer );

    // And set the stage
    stage.addChild( map );

    return;
}

MumeMapDisplay.getSectorAssetPath = function( sector )
{
    return "resources/pixmaps/terrain" + sector + ".png";
}

MumeMapDisplay.getAllAssetPaths = function()
{
    var i, paths = [];
    for ( i = SECT_UNDEFINED; i < SECT_COUNT; ++i )
        paths.push( MumeMapDisplay.getSectorAssetPath( i ) );
    return paths;
}

/* Returns the graphical structure for a single room for rendering (base
 * texture, walls, flags etc). */
MumeMapDisplay.buildRoomDisplay = function( room )
{
    var display, sector, borders;

    display = new PIXI.DisplayObjectContainer();

    // load a PNG as background (sector type)
    sector = PIXI.Sprite.fromImage( MumeMapDisplay.getSectorAssetPath( room.sector ) );
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
}

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
}

MumeMapDisplay.prototype.repositionHere = function( rooms_x, rooms_y )
{
    this.herePointer.position = new PIXI.Point( rooms_x * ROOM_PIXELS, rooms_y * ROOM_PIXELS );

    return;
}





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
 * parser.on( "tagend", function( tag ) { /* Use tag.name etc here *./ } );
 */
MumeXmlParser = function( decaf )
{
    this.clear();

    /* NB: async events may end up delivered non-sequentially, whereas order
     * matters for tags. If our subscriber (MumePathMachine) takes too much
     * time processing, we may have to add an intermediate step that
     * reassembles the room before delivering asynchronously to the path
     * machine.
     */
    contra.emitter( this, { async: false, throws: false } );
}

MumeXmlParser.prototype.clear = function()
{
    this.tagStack = [];
    this.plainText = "";
}

MumeXmlParser.prototype.connected = MumeXmlParser.prototype.clear;

MumeXmlParser.prototype.topTag = function()
{
    if ( this.tagStack.length == 0 )
        return undefined;
    else
        return this.tagStack[ this.tagStack.length - 1 ];
}

MumeXmlParser.prototype.resetPlainText = function()
{
    var plainText;

    plainText = this.plainText;
    this.plainText = "";

    return plainText;
}

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
}

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
}

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
        error = "Probable bug: run-away MumeXmlParser tag " + topTag.name
            + ", text: " + topTag.text.substr( 0, 50 );
        this.tagStack.pop();
        throw error;
    }
    else
    {
        this.plainText += text;
        topTag.text += text;
    }
}

MumeXmlParser.prototype.startTag = function( tagName, attr )
{
    this.tagStack.push( { name: tagName, attr: attr, text: "" } );

    if ( this.tagStack.length > 5 )
        throw "Bug: deeply nested MumeXmlParser tags: "
            + this.tagStack.join();

    return;
}

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
        error = "Bug: closing MumeXmlParser tag " + tagName
            + " with the following other tags open: "
            + this.tagStack.slice( matchingTagIndex + 1 ).join();

        this.tagStack = [];
        throw error;
    }

    topTag = this.tagStack.pop();
    this.emit( "tagend", topTag );
}

DecafMUD.plugins.TextInputFilter.mumexml = MumeXmlParser;

})();
