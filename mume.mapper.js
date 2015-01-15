var MumeMap, MumeXmlParser, MumeMapDisplay, MumeMapData;

(function() {
'use strict';

var hardcodedMapData,
    ROOM_PIXELS = 48,
    // Indexes into mapData entries (using an array because it may be more
    // efficient to store the whole map).
    MD_X         =  0,
    MD_Y         =  1,
    MD_Z         =  2,
    MD_NORTH     =  3,
    MD_EAST      =  4,
    MD_SOUTH     =  5,
    MD_WEST      =  6,
    MD_UP        =  7,
    MD_DOWN      =  8,
    MD_SECTOR    =  9,
    MD_MOBFLAGS  = 10,
    MD_LOADFLAGS = 11,
    MD_LIGHT     = 12,
    MD_RIDABLE   = 13,
    MD_NAME      = 14,
    MD_DESC      = 15,
    SECT_UNDEFINED      =  0, // Only for MM2 compatibility...
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
    SECT_DEATHTRAP      = 15, // in MUME it's actually a flag
    SECT_COUNT = SECT_DEATHTRAP;





MumeMap = function( containerElementName )
{
    this.mapData = new MumeMapData();
    this.display = new MumeMapDisplay( containerElementName, this.mapData );
}

MumeMap.prototype.load = function()
{
    this.mapData.load();
    this.display.loadMap();
}

/* Not used currently - update, reenable and hook it to some GUI element to
 * open the map window.
openMapWindow = function()
{
    var mapWindow;

    // Open a new window and make really sure it's blank
    mapWindow = window.open( "map.html", "mume-map", "dialog,minimizable,width=820,height=620" );
    if ( mapWindow === null )
    {
        alert( "Your browser refused to open the map window, you have to allow it "
            +"somewhere near the top right corner of your screen. Look for a "
            +"notification about blocking popups." );
        return;
    }
    console.log( "mapWindow state: ", mapWindow.document.readyState );
    globalMapWindow = mapWindow; // Hack until I objectify this
    if ( mapWindow.document.readyState === "complete" )
        loadMap();
    else
        mapWindow.addEventListener( "load", loadMap );
}
*/





MumeMapData = function()
{
    this.data = hardcodedMapData;
    this.descIndex = null;
}

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
        key = room[MD_NAME] + "\n" + room[MD_DESC];
        this.descIndex[key] = i;
    }
}

// Returns ID or undefined
MumeMapData.prototype.findRoomByNameDesc = function( name, desc )
{
    var num;
    num = this.descIndex[name + "\n" + desc];
    return num;
}

hardcodedMapData = [
    /* 0 */ [
        5, 5, 0, null, 1, null, null, null, null,
        SECT_CITY, 0, 0, null, null,
        "Fortune's Delving",
        "A largely ceremonial hall, it was the first mineshaft that led down to what is\n"
        +"now the second level of this Dwarven city. Dwarves hustle and bustle up and\n"
        +"down the great staircase at whose top you now stand. Guards stand watch by the\n"
        +"stairs, scowling at non-Dwarves, and a large sign is etched into the stone\n"
        +"above them. It has been a long time since the eyes of Men or Elves have been\n"
        +"welcome in the strongholds of the Dwarves, and this place is no exception."
    ],
    /* 1 */ [
        6, 5, 0, null, null, null, 1, null, null,
        SECT_INSIDE, 0, 0, null, null,
        "Trader's Way",
        "This wide way has been modelled as an avenue, in the style of Elves and Men. To\n"
        +"the sides are shops selling all sorts of goods, bustling with Dwarves and the\n"
        +"occasional Man or Elf. Between the shops bright outdoor scenes are painted and\n"
        +"weary travellers may rest on benches along the way. On the ceiling high above\n"
        +"can be seen a bright blue sky dotted with puffy white clouds. This part of the\n"
        +"way is particularly busy, as it intersects the main path from the outside to\n"
        +"the deeper parts of the Dwarven caves."
    ]
];





MumeMapDisplay = function( containerElementName, mapData )
{
    this.mapData = mapData;
    this.containerElementName = containerElementName;
    this.herePointer = null;
}

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
    this.repositionHere( this.mapData.data[0][MD_X], this.mapData.data[0][MD_Y] );
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

MumeMapDisplay.buildRoomDisplay = function( room )
{
    var display, sector, borders;

    display = new PIXI.DisplayObjectContainer();

    // load a PNG as background (sector type)
    sector = PIXI.Sprite.fromImage( MumeMapDisplay.getSectorAssetPath( room[MD_SECTOR] ) );
    sector.height = sector.width = ROOM_PIXELS; // Just in case we got a wrong PNG here
    display.addChild( sector );

    // Draw the borders
    borders = new PIXI.Graphics();
    borders.lineStyle( 2, 0x000000, 1 );

    [   // direction MD entry, start coords, end coords
        [ MD_NORTH, 0, 0, ROOM_PIXELS, 0 ],
        [ MD_EAST,  ROOM_PIXELS, 0, ROOM_PIXELS, ROOM_PIXELS ],
        [ MD_SOUTH, ROOM_PIXELS, ROOM_PIXELS, 0, ROOM_PIXELS ],
        [ MD_WEST,  0, ROOM_PIXELS, 0, 0 ]
    ].forEach( function( border )
    {
        if ( typeof room[ border[0] ] !== "number" )
        {
            borders.moveTo( border[1], border[2] );
            borders.lineTo( border[3], border[4] );
        }
    } );
    display.addChild( borders );

    // Position the room display in its layer
    display.position = new PIXI.Point( room[MD_X] * ROOM_PIXELS, room[MD_Y] * ROOM_PIXELS );

    display.cacheAsBitmap = true;
    return display;
}

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
MumeXmlParser = function()
{
    this.tagStack = [];
    this.plainText = "";

    contra.emitter( this );
}

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
MumeXmlParser.prototype.filterInput = function( input )
{
    var matches, isEnd, isLeaf, tagName, attr, textBefore, textAfter;

    while ( ( matches = re.exec( input ) ) !== null )
    {
        textBefore = matches[1];
        isEnd      = matches[2];
        tagName    = matches[3];
        attr       = matches[4];
        isLeaf     = matches[5];
        textAfter  = matches[6];

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

    return MumeXmlParser.decodeEntities( this.resetPlainText() );
}

MumeXmlParser.prototype.pushText = function( text )
{
    var topTag, error;

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
    this.emit( 'tagend', topTag );
}

})();
